import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { pool } from "../db/pool";
import { generateBacklogInput, publishBacklogInput } from "../validation";
import { getMembershipRole, canEditProject } from "../lib/project-access";
import { toTrpcAiError } from "../lib/ai-error-mapping";
import {
  loadProjectBrdText,
  loadTechPreferences,
  getLatestCompletedClarificationContext,
} from "./clarification";
import {
  requestBacklogGeneration,
  validateBacklogReferences,
  type GeneratedTicketDraft,
  type BacklogDraft,
} from "../services/backlog-generator";

async function requireEditor(projectId: string, userId: string): Promise<void> {
  const role = await getMembershipRole(projectId, userId);
  if (!role) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this project" });
  }
  if (!canEditProject(role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to generate a backlog for this project",
    });
  }
}

export interface BacklogTicketPreview extends GeneratedTicketDraft {
  /** A display-only preview of the ticket key it would receive on publish.
   *  Not reserved — the authoritative key is assigned inside the same
   *  transaction that creates the ticket, so a concurrent publish elsewhere
   *  in the project could shift this by the time the user actually clicks
   *  Publish. */
  previewKey: string;
  /** dependsOn resolved to preview keys, for rendering "Depends on CHK-101". */
  dependsOnPreviewKeys: string[];
}

export interface BacklogEpicPreview {
  title: string;
  tickets: BacklogTicketPreview[];
}

export interface BacklogSummary {
  epicCount: number;
  ticketCount: number;
  totalStoryPoints: number;
}

export interface GenerateBacklogResult {
  epics: BacklogEpicPreview[];
  summary: BacklogSummary;
}

function summarize(draft: BacklogDraft): BacklogSummary {
  const tickets = draft.epics.flatMap((epic) => epic.tickets);
  return {
    epicCount: draft.epics.length,
    ticketCount: tickets.length,
    totalStoryPoints: tickets.reduce((sum, ticket) => sum + ticket.storyPoints, 0),
  };
}

function withPreviewKeys(draft: BacklogDraft, projectKey: string, startNumber: number): BacklogEpicPreview[] {
  const previewKeyByRef = new Map<string, string>();
  let ticketNumber = startNumber;
  for (const epic of draft.epics) {
    for (const ticket of epic.tickets) {
      previewKeyByRef.set(ticket.ref, `${projectKey}-${ticketNumber}`);
      ticketNumber++;
    }
  }

  return draft.epics.map((epic) => ({
    title: epic.title,
    tickets: epic.tickets.map((ticket) => ({
      ...ticket,
      previewKey: previewKeyByRef.get(ticket.ref) ?? ticket.ref,
      dependsOnPreviewKeys: ticket.dependsOn.map((ref) => previewKeyByRef.get(ref) ?? ref),
    })),
  }));
}

export interface PublishBacklogResult {
  epicCount: number;
  ticketCount: number;
}

export const backlogRouter = router({
  generateBacklog: protectedProcedure
    .input(generateBacklogInput)
    .mutation(async ({ ctx, input }): Promise<GenerateBacklogResult> => {
      await requireEditor(input.projectId, ctx.userId);

      const clarificationContext = await getLatestCompletedClarificationContext(input.projectId);
      if (!clarificationContext) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Complete AI clarification before generating a backlog",
        });
      }

      const { combinedText } = await loadProjectBrdText(input.projectId);
      const techPreferences = await loadTechPreferences(input.projectId);

      let draft: BacklogDraft;
      try {
        draft = await requestBacklogGeneration({
          brdText: combinedText,
          clarificationContext,
          techPreferences,
        });
      } catch (error) {
        throw toTrpcAiError(error, "Backlog generation failed");
      }

      const projectResult = await pool.query<{ key: string; next_ticket_number: number }>(
        "SELECT key, next_ticket_number FROM projects WHERE id = $1",
        [input.projectId],
      );
      const project = projectResult.rows[0];
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      return {
        epics: withPreviewKeys(draft, project.key, project.next_ticket_number),
        summary: summarize(draft),
      };
    }),

  publishBacklogToBoard: protectedProcedure
    .input(publishBacklogInput)
    .mutation(async ({ ctx, input }): Promise<PublishBacklogResult> => {
      await requireEditor(input.projectId, ctx.userId);
      validateBacklogReferences(input);

      const allTickets = input.epics.flatMap((epic) => epic.tickets);
      const ticketCount = allTickets.length;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const statusResult = await client.query<{ id: string }>(
          "SELECT id FROM project_statuses WHERE project_id = $1 ORDER BY position ASC LIMIT 1",
          [input.projectId],
        );
        const firstStatusId = statusResult.rows[0]?.id;
        if (!firstStatusId) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "This project has no statuses to publish tickets into",
          });
        }

        // Atomically reserves ticket numbers for the whole backlog; the
        // row-level lock this UPDATE takes serializes concurrent publishes
        // for the same project, preventing duplicate keys.
        const projectResult = await client.query<{ key: string; start_number: number }>(
          `UPDATE projects SET next_ticket_number = next_ticket_number + $2
           WHERE id = $1
           RETURNING key, next_ticket_number - $2 AS start_number`,
          [input.projectId, ticketCount],
        );
        const project = projectResult.rows[0];
        if (!project) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        }

        const idByRef = new Map<string, string>();
        let ticketNumber = project.start_number;

        for (const epic of input.epics) {
          const epicResult = await client.query<{ id: string }>(
            `INSERT INTO epics (project_id, title, position)
             VALUES ($1, $2, (SELECT COALESCE(MAX(position), -1) + 1 FROM epics WHERE project_id = $1))
             RETURNING id`,
            [input.projectId, epic.title],
          );
          const epicId = epicResult.rows[0]?.id;
          if (!epicId) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create epic" });
          }

          for (const ticket of epic.tickets) {
            const key = `${project.key}-${ticketNumber}`;
            ticketNumber++;

            const acceptanceCriteria = ticket.acceptanceCriteria.map((criterion) => ({
              ...criterion,
              checked: false,
            }));

            const ticketResult = await client.query<{ id: string }>(
              `INSERT INTO tickets (
                 project_id, status_id, epic_id, key, title, type, priority,
                 story_points, acceptance_criteria, ai_dev_prompt, dependencies
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, '{}')
               RETURNING id`,
              [
                input.projectId,
                firstStatusId,
                epicId,
                key,
                ticket.title,
                ticket.type,
                ticket.priority,
                ticket.storyPoints,
                JSON.stringify(acceptanceCriteria),
                ticket.aiDevPrompt,
              ],
            );
            const ticketId = ticketResult.rows[0]?.id;
            if (!ticketId) {
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Failed to create ticket",
              });
            }
            idByRef.set(ticket.ref, ticketId);
          }
        }

        // Dependencies are only resolvable once every ticket has a real id,
        // so they are backfilled in a second pass over the same transaction.
        for (const ticket of allTickets) {
          if (ticket.dependsOn.length === 0) continue;
          const dependencyIds = ticket.dependsOn.map((ref) => idByRef.get(ref));
          const ticketId = idByRef.get(ticket.ref);
          if (!ticketId || dependencyIds.some((id) => !id)) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to resolve ticket dependencies",
            });
          }
          await client.query("UPDATE tickets SET dependencies = $1::uuid[] WHERE id = $2", [
            dependencyIds,
            ticketId,
          ]);
        }

        await client.query("COMMIT");
        return { epicCount: input.epics.length, ticketCount };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }),
});
