import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../trpc";
import { getPool } from "../db/pool";
import { createDeepSeekClient } from "../services/ai";
import type OpenAI from "openai";
import { randomUUID } from "crypto";

const ticketTypeEnum = z.enum([
  "setup",
  "feature",
  "infra",
  "integration",
  "testing",
  "bugfix",
]);

const priorityEnum = z.enum(["P0", "P1", "P2", "P3"]);

const storyPointsEnum = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(5),
  z.literal(8),
]);

const ticketStatusEnum = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
]);

const ticketValidationSchema = z.object({
  id: z.string().min(1),
  epicId: z.string().min(1),
  title: z.string().min(1),
  type: ticketTypeEnum,
  priority: priorityEnum,
  storyPoints: storyPointsEnum,
  status: ticketStatusEnum.default("backlog"),
  dependencies: z.array(z.string()).default([]),
  description: z.string().default(""),
  acceptanceCriteria: z.array(z.string()).default([]),
  aiDevPrompt: z.string().default(""),
});

const aiCreateTicketSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  epicId: z.string().min(1),
  projectId: z.string().min(1),
});

function buildAiTicketPrompt(title: string, description: string): string {
  return `Analyze the following ticket title and description and generate the remaining ticket fields.

## Input
Title: ${title}
Description: ${description}

## Output Format
Return ONLY valid JSON (no markdown fences):

{
  "type": "setup" | "feature" | "infra" | "integration" | "testing" | "bugfix",
  "priority": "P0" | "P1" | "P2" | "P3",
  "storyPoints": 1 | 2 | 3 | 5 | 8,
  "dependencies": [],
  "acceptanceCriteria": [
    "Given ... When ... Then ...",
    "Given ... When ... Then ...",
    "Given ... When ... Then ..."
  ],
  "aiDevPrompt": "Detailed standalone developer prompt with file paths, type safety, and test expectations"
}

## Guidelines
- Choose the most appropriate type, priority, and story points based on the ticket description.
- Generate 3-5 Given/When/Then acceptance criteria.
- Write a detailed, standalone aiDevPrompt that a developer can implement in isolation.`;
};

function buildExtractPrompt(userPrompt: string): string {
  return `You are a technical project manager. Convert the following user request into a single structured ticket.

## Output Format
Return ONLY valid JSON without markdown fences:

{
  "id": "EPIC-N-TM",
  "epicId": "<will be filled later>",
  "title": "Ticket title",
  "type": "setup" | "feature" | "infra" | "integration" | "testing" | "bugfix",
  "priority": "P0" | "P1" | "P2" | "P3",
  "storyPoints": 1 | 2 | 3 | 5 | 8,
  "status": "backlog",
  "dependencies": [],
  "description": "Detailed description",
  "acceptanceCriteria": [
    "Given ... When ... Then ...",
    "Given ... When ... Then ...",
    "Given ... When ... Then ..."
  ],
  "aiDevPrompt": "A standalone developer implementation prompt"
}

## Requirements
- 3-5 Given/When/Then acceptance criteria
- The aiDevPrompt must be detailed and context-complete
- The description should include technical context
- Story points estimate based on complexity

## User Request
${userPrompt}`;
}

async function checkDependenciesDone(
  pool: ReturnType<typeof getPool>,
  ticketId: string,
): Promise<void> {
  const result = await pool.query(
    `SELECT dependencies FROM tickets WHERE id = $1`,
    [ticketId],
  );

  if (result.rows.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Ticket not found: ${ticketId}`,
    });
  }

  const row = result.rows[0] as Record<string, unknown>;
  const deps = (row["dependencies"] ?? []) as string[];

  if (deps.length === 0) return;

  const depResult = await pool.query(
    `SELECT id, status FROM tickets WHERE id = ANY($1)`,
    [deps],
  );

  const depStatuses = new Map<string, string>();
  for (const dep of depResult.rows as Array<Record<string, string>>) {
    depStatuses.set(dep["id"]!, dep["status"]!);
  }

  const notDone = deps.filter(
    (depId) => depStatuses.get(depId) !== "done",
  );

  if (notDone.length > 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Cannot transition ticket ${ticketId}: dependencies not done: ${notDone.join(", ")}`,
    });
  }
}

async function extractTicketFromAI(
  aiClient: OpenAI,
  prompt: string,
  epicId: string,
): Promise<Record<string, unknown>> {
  const response = await aiClient.chat.completions.create({
    model: "deepseek-chat",
    messages: [
      { role: "system", content: buildExtractPrompt(prompt) },
    ],
    temperature: 0.3,
    max_tokens: 4096,
  });

  const rawContent = response.choices[0]?.message?.content;

  if (rawContent == null || rawContent === "") {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DeepSeek returned an empty response for ticket extraction.",
    });
  }

  const trimmed = rawContent.trim();
  let json: unknown;

  try {
    json = JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);

    if (match != null) {
      json = JSON.parse(match[0]);
    } else {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to parse extracted ticket JSON.",
      });
    }
  }

  const ticket = json as Record<string, unknown>;

  ticket["epicId"] = epicId;
  ticket["status"] = "backlog";

  return ticket;
}

export const backlogRouter = router({
  getBacklog: publicProcedure
    .input(
      z.object({
        epicId: z.string().optional(),
        projectId: z.string().optional(),
      }).default({}),
    )
    .query(async ({ input }) => {
      const pool = getPool();

      let epicQuery =
        "SELECT id, title, description, brd_upload_id, created_at FROM epics";
      const epicParams: string[] = [];
      const conditions: string[] = [];

      if (input.epicId != null && input.epicId !== "") {
        epicParams.push(input.epicId);
        conditions.push(`id = $${epicParams.length}`);
      }

      if (input.projectId != null && input.projectId !== "") {
        epicParams.push(input.projectId);
        conditions.push(`brd_upload_id = $${epicParams.length}`);
      }

      if (conditions.length > 0) {
        epicQuery += " WHERE " + conditions.join(" AND ");
      }

      epicQuery += " ORDER BY created_at ASC";

      const epicResult = await pool.query(epicQuery, epicParams);
      const epics = epicResult.rows as Array<Record<string, unknown>>;

      const result = [];

      for (const epic of epics) {
        const ticketResult = await pool.query(
          `SELECT id, epic_id, title, type, priority, story_points, status, dependencies, description, acceptance_criteria, ai_dev_prompt, created_at
           FROM tickets
           WHERE epic_id = $1
           ORDER BY created_at ASC`,
          [epic["id"]],
        );

        const tickets = (ticketResult.rows as Array<Record<string, unknown>>).map(
          (t) => ({
            id: t["id"],
            epicId: t["epic_id"],
            title: t["title"],
            type: t["type"],
            priority: t["priority"],
            storyPoints: t["story_points"],
            status: t["status"],
            dependencies: t["dependencies"] ?? [],
            description: t["description"] ?? "",
            acceptanceCriteria: t["acceptance_criteria"] ?? [],
            aiDevPrompt: t["ai_dev_prompt"] ?? "",
            createdAt: t["created_at"],
          }),
        );

        result.push({
          id: epic["id"],
          title: epic["title"],
          description: epic["description"] ?? "",
          createdAt: epic["created_at"],
          tickets,
        });
      }

      return result;
    }),

  updateTicketStatus: publicProcedure
    .input(
      z.object({
        ticketId: z.string().min(1),
        status: ticketStatusEnum,
      }),
    )
    .mutation(async ({ input }) => {
      const pool = getPool();

      if (input.status === "done") {
        await checkDependenciesDone(pool, input.ticketId);
      }

      const result = await pool.query(
        `UPDATE tickets SET status = $1 WHERE id = $2 RETURNING id, status`,
        [input.status, input.ticketId],
      );

      if (result.rows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Ticket not found: ${input.ticketId}`,
        });
      }
    }),

  createTicket: publicProcedure
    .input(aiCreateTicketSchema)
    .mutation(async ({ input }) => {
      const pool = getPool();
      const aiClient = createDeepSeekClient();

      const aiResponse = await aiClient.chat.completions.create({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: buildAiTicketPrompt(
              input.title,
              input.description,
            ),
          },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      });

      const rawContent = aiResponse.choices[0]?.message?.content;

      if (rawContent == null || rawContent === "") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "AI returned empty response for ticket generation.",
        });
      }

      let aiJson: unknown;

      try {
        aiJson = JSON.parse(rawContent.trim());
      } catch {
        const match = rawContent.trim().match(/\{[\s\S]*\}/);

        if (match != null) {
          aiJson = JSON.parse(match[0]);
        } else {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to parse AI ticket JSON.",
          });
        }
      }

      const generated = aiJson as Record<string, unknown>;
      const ticketId = `${input.projectId}-T${randomUUID().replace(/-/g, "").slice(0, 6)}`;

      const fullTicket = ticketValidationSchema.parse({
        id: ticketId,
        epicId: input.epicId,
        title: input.title,
        type: generated["type"] ?? "feature",
        priority: generated["priority"] ?? "P2",
        storyPoints: generated["storyPoints"] ?? 3,
        status: "backlog",
        dependencies: generated["dependencies"] ?? [],
        description: input.description,
        acceptanceCriteria: generated["acceptanceCriteria"] ?? [],
        aiDevPrompt: generated["aiDevPrompt"] ?? "",
      });

      try {
        await pool.query(
          `INSERT INTO tickets (id, epic_id, title, type, priority, story_points, status, dependencies, description, acceptance_criteria, ai_dev_prompt)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            fullTicket.id,
            fullTicket.epicId,
            fullTicket.title,
            fullTicket.type,
            fullTicket.priority,
            fullTicket.storyPoints,
            fullTicket.status,
            JSON.stringify(fullTicket.dependencies),
            fullTicket.description,
            JSON.stringify(fullTicket.acceptanceCriteria),
            fullTicket.aiDevPrompt,
          ],
        );
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes("violates foreign key")
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Epic not found: ${input.epicId}`,
          });
        }

        throw err;
      }

      return { id: fullTicket.id, title: fullTicket.title };
    }),

  extractTicketFromPrompt: publicProcedure
    .input(
      z.object({
        prompt: z.string().min(1),
        epicId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const pool = getPool();
      const aiClient = createDeepSeekClient();

      const rawTicket = await extractTicketFromAI(
        aiClient,
        input.prompt,
        input.epicId,
      );

      if (
        rawTicket["id"] == null ||
        typeof rawTicket["id"] !== "string" ||
        rawTicket["id"] === ""
      ) {
        rawTicket["id"] =
          input.epicId + "-T" + randomUUID().replace(/-/g, "").slice(0, 6);
      }

      const parsed = ticketValidationSchema.safeParse({
        ...rawTicket,
        epicId: input.epicId,
        status: "backlog",
      });

      if (!parsed.success) {
        const errors = parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");

        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `AI-generated ticket failed validation: ${errors}`,
        });
      }

      const ticket = parsed.data;

      await pool.query(
        `INSERT INTO tickets (id, epic_id, title, type, priority, story_points, status, dependencies, description, acceptance_criteria, ai_dev_prompt)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE
           SET title = $3, type = $4, priority = $5, story_points = $6,
               status = $7, dependencies = $8, description = $9,
               acceptance_criteria = $10, ai_dev_prompt = $11`,
        [
          ticket.id,
          ticket.epicId,
          ticket.title,
          ticket.type,
          ticket.priority,
          ticket.storyPoints,
          ticket.status,
          JSON.stringify(ticket.dependencies),
          ticket.description,
          JSON.stringify(ticket.acceptanceCriteria),
          ticket.aiDevPrompt,
        ],
      );

      return { id: ticket.id, title: ticket.title };
    }),
});
