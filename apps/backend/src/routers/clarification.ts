import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import { router, protectedProcedure } from "../trpc";
import { pool } from "../db/pool";
import {
  startClarificationInput,
  getClarificationStateInput,
  sendClarificationMessageInput,
  completeClarificationInput,
} from "../validation";
import { getMembershipRole, canEditProject } from "../lib/project-access";
import { isBrdExtension, type BrdExtension } from "../lib/brd-constants";
import { extractBrdText, BrdTextExtractionError } from "../services/brd-text";
import {
  requestClarificationQuestions,
  AiUnavailableError,
  AiResponseError,
  AiConfigurationError,
  type ClarificationQuestionDraft,
  type TechPreferenceContext,
} from "../services/ai";

const POSTGRES_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  );
}

export type ClarificationStatus = "active" | "completed";
export type ClarificationRole = "ai" | "user";

interface SessionRow {
  id: string;
  project_id: string;
  status: string;
  compiled_context: string | null;
  created_at: Date;
  completed_at: Date | null;
}

interface QuestionRow {
  id: string;
  position: number;
  prompt: string;
  ambiguity: string;
  quick_replies: unknown;
  answer: string | null;
  resolved_at: Date | null;
}

interface MessageRow {
  id: string;
  role: string;
  content: string;
  question_id: string | null;
  created_at: Date;
}

export interface ClarificationQuestion {
  id: string;
  position: number;
  prompt: string;
  ambiguity: string;
  quickReplies: string[];
  answer: string | null;
  resolved: boolean;
}

export interface ClarificationMessage {
  id: string;
  role: ClarificationRole;
  content: string;
  questionId: string | null;
  createdAt: string;
}

export interface ClarificationSessionState {
  id: string;
  projectId: string;
  status: ClarificationStatus;
  compiledContext: string | null;
  createdAt: string;
  completedAt: string | null;
  questions: ClarificationQuestion[];
  messages: ClarificationMessage[];
  resolvedCount: number;
  totalCount: number;
  /** True only when every ambiguity is resolved — this gates the CTA. */
  allResolved: boolean;
}

export interface BrdDocumentPage {
  pageNumber: number;
  text: string;
}

export interface BrdDocumentView {
  fileId: string;
  fileName: string;
  extension: BrdExtension;
  pages: BrdDocumentPage[];
}

function toQuickReplies(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function isClarificationRole(value: string): value is ClarificationRole {
  return value === "ai" || value === "user";
}

function isClarificationStatus(value: string): value is ClarificationStatus {
  return value === "active" || value === "completed";
}

function toQuestion(row: QuestionRow): ClarificationQuestion {
  return {
    id: row.id,
    position: row.position,
    prompt: row.prompt,
    ambiguity: row.ambiguity,
    quickReplies: toQuickReplies(row.quick_replies),
    answer: row.answer,
    resolved: row.resolved_at !== null,
  };
}

function toMessage(row: MessageRow): ClarificationMessage {
  if (!isClarificationRole(row.role)) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Unknown clarification message role",
    });
  }
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    questionId: row.question_id,
    createdAt: row.created_at.toISOString(),
  };
}

async function requireMembership(projectId: string, userId: string): Promise<void> {
  const role = await getMembershipRole(projectId, userId);
  if (!role) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this project" });
  }
}

async function requireEditor(projectId: string, userId: string): Promise<void> {
  const role = await getMembershipRole(projectId, userId);
  if (!role) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this project" });
  }
  if (!canEditProject(role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to run clarification for this project",
    });
  }
}

/** Loads a full session state. Accepts a client so it can run inside a transaction. */
async function loadSessionState(
  executor: Pick<PoolClient, "query">,
  sessionRow: SessionRow,
): Promise<ClarificationSessionState> {
  if (!isClarificationStatus(sessionRow.status)) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Unknown clarification session status",
    });
  }

  const questionResult = await executor.query<QuestionRow>(
    `SELECT id, position, prompt, ambiguity, quick_replies, answer, resolved_at
     FROM clarification_questions
     WHERE session_id = $1
     ORDER BY position ASC`,
    [sessionRow.id],
  );
  const messageResult = await executor.query<MessageRow>(
    `SELECT id, role, content, question_id, created_at
     FROM clarification_messages
     WHERE session_id = $1
     ORDER BY seq ASC`,
    [sessionRow.id],
  );

  const questions = questionResult.rows.map(toQuestion);
  const resolvedCount = questions.filter((question) => question.resolved).length;

  return {
    id: sessionRow.id,
    projectId: sessionRow.project_id,
    status: sessionRow.status,
    compiledContext: sessionRow.compiled_context,
    createdAt: sessionRow.created_at.toISOString(),
    completedAt: sessionRow.completed_at ? sessionRow.completed_at.toISOString() : null,
    questions,
    messages: messageResult.rows.map(toMessage),
    resolvedCount,
    totalCount: questions.length,
    allResolved: questions.length > 0 && resolvedCount === questions.length,
  };
}

async function findActiveSession(
  executor: Pick<PoolClient, "query">,
  projectId: string,
): Promise<SessionRow | null> {
  const result = await executor.query<SessionRow>(
    `SELECT id, project_id, status, compiled_context, created_at, completed_at
     FROM clarification_sessions
     WHERE project_id = $1 AND status = 'active'`,
    [projectId],
  );
  return result.rows[0] ?? null;
}

async function findLatestSession(projectId: string): Promise<SessionRow | null> {
  const result = await pool.query<SessionRow>(
    `SELECT id, project_id, status, compiled_context, created_at, completed_at
     FROM clarification_sessions
     WHERE project_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [projectId],
  );
  return result.rows[0] ?? null;
}

interface BrdFileForAnalysis {
  id: string;
  file_name: string;
  extension: string;
  storage_path: string;
}

/**
 * Reads every stored BRD for the project into a viewer-friendly shape. A file
 * that fails to extract renders as a document with no readable pages rather
 * than failing the whole list — this is what the BRD viewer pane reads, and
 * one bad file should not blank out the others the user can still inspect.
 */
async function loadProjectBrdDocuments(projectId: string): Promise<BrdDocumentView[]> {
  const result = await pool.query<BrdFileForAnalysis>(
    `SELECT id, file_name, extension, storage_path
     FROM brd_files
     WHERE project_id = $1
     ORDER BY created_at ASC`,
    [projectId],
  );

  const documents: BrdDocumentView[] = [];
  for (const row of result.rows) {
    if (!isBrdExtension(row.extension)) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Stored BRD has an unknown extension",
      });
    }
    try {
      const extracted = await extractBrdText(row.storage_path, row.extension);
      documents.push({
        fileId: row.id,
        fileName: row.file_name,
        extension: row.extension,
        pages: extracted.pages.map((page) => ({
          pageNumber: page.pageNumber,
          text: page.text,
        })),
      });
    } catch (error) {
      if (error instanceof BrdTextExtractionError) {
        documents.push({
          fileId: row.id,
          fileName: row.file_name,
          extension: row.extension,
          pages: [{ pageNumber: 1, text: "" }],
        });
        continue;
      }
      throw error;
    }
  }
  return documents;
}

/**
 * Loads BRD text for the AI prompt. Unlike the viewer listing above, this
 * gate is strict: a BRD the model cannot read would otherwise produce
 * confidently wrong questions, so extraction failures and all-blank input
 * are surfaced rather than silently skipped.
 */
async function loadProjectBrdText(projectId: string): Promise<{
  combinedText: string;
  documents: BrdDocumentView[];
}> {
  const result = await pool.query<BrdFileForAnalysis>(
    `SELECT id, file_name, extension, storage_path
     FROM brd_files
     WHERE project_id = $1
     ORDER BY created_at ASC`,
    [projectId],
  );

  if (result.rows.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Upload at least one BRD document before starting clarification",
    });
  }

  const documents: BrdDocumentView[] = [];
  const sections: string[] = [];

  for (const row of result.rows) {
    if (!isBrdExtension(row.extension)) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Stored BRD has an unknown extension",
      });
    }
    try {
      const extracted = await extractBrdText(row.storage_path, row.extension);
      documents.push({
        fileId: row.id,
        fileName: row.file_name,
        extension: row.extension,
        pages: extracted.pages.map((page) => ({
          pageNumber: page.pageNumber,
          text: page.text,
        })),
      });
      // Only documents that actually yielded text contribute a section. The
      // `## filename` header would otherwise make an entirely blank BRD look
      // like readable content to the emptiness check below.
      if (extracted.text.trim()) {
        sections.push(`## ${row.file_name}\n${extracted.text.trim()}`);
      }
    } catch (error) {
      if (error instanceof BrdTextExtractionError) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Could not read text from "${row.file_name}". Re-upload it and try again.`,
        });
      }
      throw error;
    }
  }

  const combinedText = sections.join("\n\n").trim();
  if (!combinedText) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The uploaded BRD documents contain no readable text",
    });
  }

  return { combinedText, documents };
}

async function loadTechPreferences(projectId: string): Promise<TechPreferenceContext> {
  const result = await pool.query<TechPreferenceContext>(
    `SELECT frontend, backend, database, infra
     FROM project_tech_preferences
     WHERE project_id = $1`,
    [projectId],
  );
  return (
    result.rows[0] ?? { frontend: null, backend: null, database: null, infra: null }
  );
}

/** Maps AI-layer failures onto tRPC errors without leaking provider internals. */
function toTrpcAiError(error: unknown): TRPCError {
  if (error instanceof AiConfigurationError) {
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "The AI service is not configured. Contact an administrator.",
    });
  }
  if (error instanceof AiUnavailableError) {
    return new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "The AI service is unavailable right now. Please try again.",
    });
  }
  if (error instanceof AiResponseError) {
    return new TRPCError({
      code: "BAD_GATEWAY",
      message: "The AI service returned an unusable response. Please try again.",
    });
  }
  return error instanceof TRPCError
    ? error
    : new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Clarification failed" });
}

async function insertSessionWithQuestions(
  projectId: string,
  userId: string,
  drafts: ClarificationQuestionDraft[],
): Promise<SessionRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sessionResult = await client.query<SessionRow>(
      `INSERT INTO clarification_sessions (project_id, status, created_by)
       VALUES ($1, 'active', $2)
       RETURNING id, project_id, status, compiled_context, created_at, completed_at`,
      [projectId, userId],
    );
    const sessionRow = sessionResult.rows[0];
    if (!sessionRow) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create clarification session",
      });
    }

    for (let position = 0; position < drafts.length; position++) {
      const draft = drafts[position];
      if (!draft) continue;

      const questionResult = await client.query<{ id: string }>(
        `INSERT INTO clarification_questions
           (session_id, position, prompt, ambiguity, quick_replies)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING id`,
        [
          sessionRow.id,
          position,
          draft.prompt,
          draft.ambiguity,
          JSON.stringify(draft.quickReplies),
        ],
      );
      const questionId = questionResult.rows[0]?.id;
      if (!questionId) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create clarification question",
        });
      }

      await client.query(
        `INSERT INTO clarification_messages (session_id, question_id, role, content)
         VALUES ($1, $2, 'ai', $3)`,
        [sessionRow.id, questionId, draft.prompt],
      );
    }

    await client.query("COMMIT");
    return sessionRow;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Compiles the resolved Q&A into the specification context persisted on
 * completion. Deterministic on purpose: the CTA must not be able to fail
 * because of a second AI round-trip.
 */
export function compileSpecificationContext(
  questions: ClarificationQuestion[],
  preferences: TechPreferenceContext,
): string {
  const lines: string[] = ["# Compiled Specification Context", "", "## Resolved Ambiguities", ""];

  for (const question of questions) {
    lines.push(`### ${question.ambiguity}`);
    lines.push(`- Question: ${question.prompt}`);
    lines.push(`- Answer: ${question.answer ?? ""}`);
    lines.push("");
  }

  lines.push("## Preferred Tech Stack", "");
  const entries: Array<[string, string | null]> = [
    ["Frontend", preferences.frontend],
    ["Backend", preferences.backend],
    ["Database", preferences.database],
    ["Infrastructure", preferences.infra],
  ];
  const supplied = entries.filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "",
  );
  if (supplied.length === 0) {
    lines.push("No preferred tech stack was supplied.");
  } else {
    for (const [label, value] of supplied) lines.push(`- ${label}: ${value}`);
  }

  return lines.join("\n").trim();
}

export const clarificationRouter = router({
  getSessionState: protectedProcedure
    .input(getClarificationStateInput)
    .query(async ({ ctx, input }): Promise<ClarificationSessionState | null> => {
      await requireMembership(input.projectId, ctx.userId);

      const sessionRow = await findLatestSession(input.projectId);
      if (!sessionRow) return null;
      return loadSessionState(pool, sessionRow);
    }),

  getBrdDocuments: protectedProcedure
    .input(getClarificationStateInput)
    .query(async ({ ctx, input }): Promise<BrdDocumentView[]> => {
      await requireMembership(input.projectId, ctx.userId);
      return loadProjectBrdDocuments(input.projectId);
    }),

  startSession: protectedProcedure
    .input(startClarificationInput)
    .mutation(async ({ ctx, input }): Promise<ClarificationSessionState> => {
      await requireEditor(input.projectId, ctx.userId);

      // Reuse an in-flight session rather than burning another AI call.
      const existing = await findActiveSession(pool, input.projectId);
      if (existing) return loadSessionState(pool, existing);

      const { combinedText } = await loadProjectBrdText(input.projectId);
      const preferences = await loadTechPreferences(input.projectId);

      let drafts: ClarificationQuestionDraft[];
      try {
        drafts = await requestClarificationQuestions({
          brdText: combinedText,
          techPreferences: preferences,
        });
      } catch (error) {
        throw toTrpcAiError(error);
      }

      try {
        const sessionRow = await insertSessionWithQuestions(
          input.projectId,
          ctx.userId,
          drafts,
        );
        return loadSessionState(pool, sessionRow);
      } catch (error) {
        // The partial unique index means a concurrent startSession already won;
        // return that session instead of surfacing a raw constraint error.
        if (isUniqueViolation(error)) {
          const winner = await findActiveSession(pool, input.projectId);
          if (winner) return loadSessionState(pool, winner);
        }
        throw error;
      }
    }),

  sendMessage: protectedProcedure
    .input(sendClarificationMessageInput)
    .mutation(async ({ ctx, input }): Promise<ClarificationSessionState> => {
      await requireEditor(input.projectId, ctx.userId);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const sessionResult = await client.query<SessionRow>(
          `SELECT id, project_id, status, compiled_context, created_at, completed_at
           FROM clarification_sessions
           WHERE project_id = $1 AND status = 'active'
           FOR UPDATE`,
          [input.projectId],
        );
        const sessionRow = sessionResult.rows[0];
        if (!sessionRow) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "There is no active clarification session for this project",
          });
        }

        // Scoping the lookup by session_id is what stops a question id from
        // another project being answered through this project's session.
        const questionResult = await client.query<QuestionRow>(
          `SELECT id, position, prompt, ambiguity, quick_replies, answer, resolved_at
           FROM clarification_questions
           WHERE id = $1 AND session_id = $2
           FOR UPDATE`,
          [input.questionId, sessionRow.id],
        );
        const questionRow = questionResult.rows[0];
        if (!questionRow) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "That question does not belong to this clarification session",
          });
        }

        await client.query(
          `INSERT INTO clarification_messages (session_id, question_id, role, content)
           VALUES ($1, $2, 'user', $3)`,
          [sessionRow.id, questionRow.id, input.answer],
        );

        await client.query(
          `UPDATE clarification_questions
           SET answer = $1, resolved_at = COALESCE(resolved_at, now())
           WHERE id = $2`,
          [input.answer, questionRow.id],
        );

        const remaining = await client.query<{ id: string; prompt: string }>(
          `SELECT id, prompt
           FROM clarification_questions
           WHERE session_id = $1 AND resolved_at IS NULL
           ORDER BY position ASC
           LIMIT 1`,
          [sessionRow.id],
        );
        const nextQuestion = remaining.rows[0];

        await client.query(
          `INSERT INTO clarification_messages (session_id, question_id, role, content)
           VALUES ($1, $2, 'ai', $3)`,
          [
            sessionRow.id,
            nextQuestion?.id ?? null,
            nextQuestion
              ? `Noted. ${nextQuestion.prompt}`
              : "Thanks — every ambiguity is resolved. You can generate the backlog now.",
          ],
        );

        const state = await loadSessionState(client, sessionRow);
        await client.query("COMMIT");
        return state;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }),

  completeSession: protectedProcedure
    .input(completeClarificationInput)
    .mutation(async ({ ctx, input }): Promise<ClarificationSessionState> => {
      await requireEditor(input.projectId, ctx.userId);

      const preferences = await loadTechPreferences(input.projectId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const sessionResult = await client.query<SessionRow>(
          `SELECT id, project_id, status, compiled_context, created_at, completed_at
           FROM clarification_sessions
           WHERE project_id = $1 AND status = 'active'
           FOR UPDATE`,
          [input.projectId],
        );
        const sessionRow = sessionResult.rows[0];
        if (!sessionRow) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "There is no active clarification session for this project",
          });
        }

        const current = await loadSessionState(client, sessionRow);
        if (!current.allResolved) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Resolve every clarification question before generating the backlog",
          });
        }

        const compiledContext = compileSpecificationContext(current.questions, preferences);

        const updated = await client.query<SessionRow>(
          `UPDATE clarification_sessions
           SET status = 'completed', completed_at = now(), compiled_context = $1
           WHERE id = $2
           RETURNING id, project_id, status, compiled_context, created_at, completed_at`,
          [compiledContext, sessionRow.id],
        );
        const updatedRow = updated.rows[0];
        if (!updatedRow) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to complete the clarification session",
          });
        }

        const state = await loadSessionState(client, updatedRow);
        await client.query("COMMIT");
        return state;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }),
});
