import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { pool } from "../db/pool";
import {
  createTicketInput,
  updateTicketStatusInput,
  updateTicketInput,
  getTicketDetailsInput,
  getProjectTicketsInput,
} from "../validation";
import { isMembershipRole, type MembershipRole } from "./project";

export type TicketType = "story" | "bug" | "task";
export type TicketPriority = "P0" | "P1" | "P2" | "P3";

export interface AcceptanceCriterion {
  given: string;
  when: string;
  then: string;
  checked: boolean;
}

interface TicketRow {
  id: string;
  project_id: string;
  status_id: string;
  key: string;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  story_points: number | null;
  assignee_id: string | null;
  acceptance_criteria: unknown;
  ai_dev_prompt: string | null;
  dependencies: string[];
  created_at: Date;
}

interface TicketWithAssigneeRow extends TicketRow {
  assignee_user_id: string | null;
  assignee_full_name: string | null;
  assignee_email: string | null;
}

export interface Ticket {
  id: string;
  projectId: string;
  statusId: string;
  key: string;
  title: string;
  description: string | null;
  type: TicketType;
  priority: TicketPriority;
  storyPoints: number | null;
  assigneeId: string | null;
  acceptanceCriteria: AcceptanceCriterion[];
  aiDevPrompt: string | null;
  dependencies: string[];
  createdAt: string;
}

export interface AssigneeSummary {
  id: string;
  fullName: string;
  email: string;
}

export interface TicketWithAssignee extends Ticket {
  assignee: AssigneeSummary | null;
}

export interface DependencySummary {
  id: string;
  key: string;
  title: string;
  statusId: string;
}

export interface TicketDetails extends TicketWithAssignee {
  dependencySummaries: DependencySummary[];
}

export interface CreateTicketResult {
  ticket: Ticket;
}

export interface UpdateTicketStatusResult {
  ticket: Ticket;
}

export interface UpdateTicketResult {
  ticket: Ticket;
}

const POSTGRES_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  );
}

function isTicketType(value: string): value is TicketType {
  return value === "story" || value === "bug" || value === "task";
}

function isTicketPriority(value: string): value is TicketPriority {
  return value === "P0" || value === "P1" || value === "P2" || value === "P3";
}

function isAcceptanceCriteria(value: unknown): value is AcceptanceCriterion[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { given?: unknown }).given === "string" &&
        typeof (item as { when?: unknown }).when === "string" &&
        typeof (item as { then?: unknown }).then === "string" &&
        typeof (item as { checked?: unknown }).checked === "boolean",
    )
  );
}

function toTicket(row: TicketRow): Ticket {
  if (!isTicketType(row.type)) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unknown ticket type" });
  }
  if (!isTicketPriority(row.priority)) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unknown ticket priority" });
  }
  if (!isAcceptanceCriteria(row.acceptance_criteria)) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Malformed acceptance criteria",
    });
  }
  return {
    id: row.id,
    projectId: row.project_id,
    statusId: row.status_id,
    key: row.key,
    title: row.title,
    description: row.description,
    type: row.type,
    priority: row.priority,
    storyPoints: row.story_points,
    assigneeId: row.assignee_id,
    acceptanceCriteria: row.acceptance_criteria,
    aiDevPrompt: row.ai_dev_prompt,
    dependencies: row.dependencies,
    createdAt: row.created_at.toISOString(),
  };
}

function toTicketWithAssignee(row: TicketWithAssigneeRow): TicketWithAssignee {
  const ticket = toTicket(row);
  const assignee =
    row.assignee_user_id && row.assignee_full_name && row.assignee_email
      ? { id: row.assignee_user_id, fullName: row.assignee_full_name, email: row.assignee_email }
      : null;
  return { ...ticket, assignee };
}

async function requireMembership(projectId: string, userId: string): Promise<MembershipRole> {
  const result = await pool.query<{ role: string }>(
    "SELECT role FROM project_memberships WHERE project_id = $1 AND user_id = $2",
    [projectId, userId],
  );
  const role = result.rows[0]?.role;
  if (!role || !isMembershipRole(role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this project" });
  }
  return role;
}

function requireEditorOrOwner(role: MembershipRole): void {
  if (role !== "owner" && role !== "editor") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to modify this project's tickets",
    });
  }
}

async function requireProjectMember(
  projectId: string,
  userId: string,
): Promise<void> {
  const result = await pool.query(
    "SELECT user_id FROM project_memberships WHERE project_id = $1 AND user_id = $2",
    [projectId, userId],
  );
  if (result.rowCount === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Assignee must be a member of this project" });
  }
}

export const ticketRouter = router({
  getProjectTickets: protectedProcedure
    .input(getProjectTicketsInput)
    .query(async ({ ctx, input }): Promise<TicketWithAssignee[]> => {
      await requireMembership(input.projectId, ctx.userId);

      const result = await pool.query<TicketWithAssigneeRow>(
        `SELECT t.*, u.id AS assignee_user_id, u.full_name AS assignee_full_name, u.email AS assignee_email
         FROM tickets t
         LEFT JOIN users u ON u.id = t.assignee_id
         WHERE t.project_id = $1
         ORDER BY t.created_at ASC`,
        [input.projectId],
      );
      return result.rows.map(toTicketWithAssignee);
    }),

  getTicketDetails: protectedProcedure
    .input(getTicketDetailsInput)
    .query(async ({ ctx, input }): Promise<TicketDetails> => {
      await requireMembership(input.projectId, ctx.userId);

      const result = await pool.query<TicketWithAssigneeRow>(
        `SELECT t.*, u.id AS assignee_user_id, u.full_name AS assignee_full_name, u.email AS assignee_email
         FROM tickets t
         LEFT JOIN users u ON u.id = t.assignee_id
         WHERE t.id = $1 AND t.project_id = $2`,
        [input.ticketId, input.projectId],
      );
      const row = result.rows[0];
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found in this project" });
      }
      const ticket = toTicketWithAssignee(row);

      let dependencySummaries: DependencySummary[] = [];
      if (ticket.dependencies.length > 0) {
        const depResult = await pool.query<{
          id: string;
          key: string;
          title: string;
          status_id: string;
        }>("SELECT id, key, title, status_id FROM tickets WHERE id = ANY($1::uuid[])", [
          ticket.dependencies,
        ]);
        dependencySummaries = depResult.rows.map((depRow) => ({
          id: depRow.id,
          key: depRow.key,
          title: depRow.title,
          statusId: depRow.status_id,
        }));
      }

      return { ...ticket, dependencySummaries };
    }),

  createTicket: protectedProcedure
    .input(createTicketInput)
    .mutation(async ({ ctx, input }): Promise<CreateTicketResult> => {
      const role = await requireMembership(input.projectId, ctx.userId);
      requireEditorOrOwner(role);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const statusResult = await client.query(
          "SELECT id FROM project_statuses WHERE id = $1 AND project_id = $2",
          [input.statusId, input.projectId],
        );
        if (statusResult.rowCount === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Status does not belong to this project",
          });
        }

        if (input.assigneeId) {
          await requireProjectMember(input.projectId, input.assigneeId);
        }

        const dependencies = input.dependencies ?? [];
        if (dependencies.length > 0) {
          const depResult = await client.query<{ id: string }>(
            "SELECT id FROM tickets WHERE project_id = $1 AND id = ANY($2::uuid[])",
            [input.projectId, dependencies],
          );
          const foundIds = new Set(depResult.rows.map((row) => row.id));
          if (foundIds.size !== new Set(dependencies).size) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "One or more dependencies do not belong to this project",
            });
          }
        }

        // Atomically reserves the next ticket number for this project; the
        // row-level lock taken by this UPDATE serializes concurrent
        // createTicket calls for the same project, preventing duplicate keys.
        const projectResult = await client.query<{ key: string; ticket_number: number }>(
          `UPDATE projects SET next_ticket_number = next_ticket_number + 1
           WHERE id = $1
           RETURNING key, next_ticket_number - 1 AS ticket_number`,
          [input.projectId],
        );
        const projectRow = projectResult.rows[0];
        if (!projectRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        }
        const ticketKey = `${projectRow.key}-${projectRow.ticket_number}`;

        let ticketRow: TicketRow;
        try {
          const inserted = await client.query<TicketRow>(
            `INSERT INTO tickets (
               project_id, status_id, key, title, description, type, priority,
               story_points, assignee_id, acceptance_criteria, ai_dev_prompt, dependencies
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
             RETURNING *`,
            [
              input.projectId,
              input.statusId,
              ticketKey,
              input.title,
              input.description ?? null,
              input.type,
              input.priority,
              input.storyPoints ?? null,
              input.assigneeId ?? null,
              JSON.stringify(input.acceptanceCriteria ?? []),
              input.aiDevPrompt ?? null,
              dependencies,
            ],
          );
          const row = inserted.rows[0];
          if (!row) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to create ticket",
            });
          }
          ticketRow = row;
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "A ticket with this key already exists in this project",
            });
          }
          throw err;
        }

        await client.query("COMMIT");
        return { ticket: toTicket(ticketRow) };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }),

  updateTicketStatus: protectedProcedure
    .input(updateTicketStatusInput)
    .mutation(async ({ ctx, input }): Promise<UpdateTicketStatusResult> => {
      const role = await requireMembership(input.projectId, ctx.userId);
      requireEditorOrOwner(role);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const ticketResult = await client.query<TicketRow>(
          "SELECT * FROM tickets WHERE id = $1 AND project_id = $2 FOR UPDATE",
          [input.ticketId, input.projectId],
        );
        const ticketRow = ticketResult.rows[0];
        if (!ticketRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found in this project" });
        }

        const statusResult = await client.query(
          "SELECT id FROM project_statuses WHERE id = $1 AND project_id = $2",
          [input.statusId, input.projectId],
        );
        if (statusResult.rowCount === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Status does not belong to this project",
          });
        }

        if (ticketRow.dependencies.length > 0) {
          const lastStatusResult = await client.query<{ id: string }>(
            "SELECT id FROM project_statuses WHERE project_id = $1 ORDER BY position DESC LIMIT 1",
            [input.projectId],
          );
          const lastStatusId = lastStatusResult.rows[0]?.id ?? null;
          const incompleteResult = await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM tickets
             WHERE id = ANY($1::uuid[]) AND status_id IS DISTINCT FROM $2`,
            [ticketRow.dependencies, lastStatusId],
          );
          const incompleteCount = Number(incompleteResult.rows[0]?.count ?? "0");
          if (incompleteCount > 0) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "This ticket has unfinished dependencies and cannot be moved yet",
            });
          }
        }

        const updated = await client.query<TicketRow>(
          "UPDATE tickets SET status_id = $1 WHERE id = $2 RETURNING *",
          [input.statusId, input.ticketId],
        );
        const updatedRow = updated.rows[0];
        if (!updatedRow) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update ticket status",
          });
        }

        await client.query("COMMIT");
        return { ticket: toTicket(updatedRow) };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }),

  updateTicket: protectedProcedure
    .input(updateTicketInput)
    .mutation(async ({ ctx, input }): Promise<UpdateTicketResult> => {
      const role = await requireMembership(input.projectId, ctx.userId);
      requireEditorOrOwner(role);

      if (input.assigneeId) {
        await requireProjectMember(input.projectId, input.assigneeId);
      }

      const setClauses: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      function addSet(column: string, value: unknown): void {
        setClauses.push(`${column} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }

      if (input.title !== undefined) addSet("title", input.title);
      if (input.description !== undefined) addSet("description", input.description);
      if (input.priority !== undefined) addSet("priority", input.priority);
      if (input.storyPoints !== undefined) addSet("story_points", input.storyPoints);
      if (input.assigneeId !== undefined) addSet("assignee_id", input.assigneeId);

      if (setClauses.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No fields provided to update" });
      }

      values.push(input.ticketId, input.projectId);
      const result = await pool.query<TicketRow>(
        `UPDATE tickets SET ${setClauses.join(", ")}
         WHERE id = $${paramIndex} AND project_id = $${paramIndex + 1}
         RETURNING *`,
        values,
      );
      const row = result.rows[0];
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found in this project" });
      }
      return { ticket: toTicket(row) };
    }),
});
