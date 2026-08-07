import { z } from "zod";
import {
  requestDeepSeekJson,
  truncateBrdText,
  MAX_BRD_CHARS,
  AiResponseError,
  type TechPreferenceContext,
} from "./ai";

export type { TechPreferenceContext };
import type { TicketType, TicketPriority } from "../routers/ticket";

export const MAX_EPICS = 10;
export const MAX_TICKETS_PER_EPIC = 20;

export interface GeneratedAcceptanceCriterion {
  given: string;
  when: string;
  then: string;
}

export interface GeneratedTicketDraft {
  /** The model's local reference for this ticket (e.g. "T1"), used only to
   *  resolve dependsOn before real ticket ids exist. Never persisted. */
  ref: string;
  title: string;
  type: TicketType;
  priority: TicketPriority;
  storyPoints: number;
  acceptanceCriteria: GeneratedAcceptanceCriterion[];
  aiDevPrompt: string;
  dependsOn: string[];
}

export interface GeneratedEpicDraft {
  title: string;
  tickets: GeneratedTicketDraft[];
}

export interface BacklogDraft {
  epics: GeneratedEpicDraft[];
}

const acceptanceCriterionSchema = z.object({
  given: z.string().trim().min(1).max(500),
  when: z.string().trim().min(1).max(500),
  then: z.string().trim().min(1).max(500),
});

const ticketSchema = z.object({
  ref: z.string().trim().min(1).max(20),
  title: z.string().trim().min(1).max(200),
  type: z.enum(["story", "bug", "task"]),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  storyPoints: z.number().int().min(0).max(21),
  acceptanceCriteria: z.array(acceptanceCriterionSchema).min(1).max(10),
  aiDevPrompt: z.string().trim().min(1).max(4000),
  dependsOn: z.array(z.string().trim().min(1).max(20)).max(10).optional().default([]),
});

const epicSchema = z.object({
  title: z.string().trim().min(1).max(200),
  tickets: z.array(ticketSchema).min(1).max(MAX_TICKETS_PER_EPIC),
});

/**
 * The backlog draft shape, shared with the tRPC input validation for
 * `publishBacklogToBoard` (see validation.ts) — the client republishes
 * exactly the draft this function produced, so both sides trust one schema.
 */
export const backlogDraftSchema = z.object({
  epics: z.array(epicSchema).min(1).max(MAX_EPICS),
});

/**
 * Every ref must be unique across the whole backlog (not just within its
 * epic) and every dependsOn must point at a ref that actually exists and is
 * not the ticket itself — otherwise publishBacklogToBoard would have nothing
 * to resolve the dependency against.
 */
export function validateBacklogReferences(payload: z.infer<typeof backlogDraftSchema>): void {
  const allRefs = new Set<string>();
  for (const epic of payload.epics) {
    for (const ticket of epic.tickets) {
      if (allRefs.has(ticket.ref)) {
        throw new AiResponseError(`DeepSeek returned duplicate ticket reference "${ticket.ref}"`);
      }
      allRefs.add(ticket.ref);
    }
  }
  for (const epic of payload.epics) {
    for (const ticket of epic.tickets) {
      for (const dep of ticket.dependsOn) {
        if (dep === ticket.ref) {
          throw new AiResponseError(`Ticket "${ticket.ref}" cannot depend on itself`);
        }
        if (!allRefs.has(dep)) {
          throw new AiResponseError(
            `Ticket "${ticket.ref}" depends on unknown reference "${dep}"`,
          );
        }
      }
    }
  }
}

function describeTechPreferences(preferences: TechPreferenceContext): string {
  const entries = [
    ["Frontend", preferences.frontend],
    ["Backend", preferences.backend],
    ["Database", preferences.database],
    ["Infrastructure", preferences.infra],
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "");

  if (entries.length === 0) return "No preferred tech stack was supplied.";
  return entries.map(([label, value]) => `${label}: ${value}`).join("\n");
}

const SYSTEM_PROMPT = [
  "You are a senior technical lead turning a requirements document into an engineering backlog.",
  "Group the work into epics, and break each epic into implementation-ready tickets.",
  "Every ticket must have Given/When/Then acceptance criteria and a concrete AI Dev Prompt an",
  "engineer (or an AI pair programmer) could execute directly.",
  "Assign a `ref` to every ticket (e.g. \"T1\", \"T2\", unique across the whole backlog) and use",
  "`dependsOn` (an array of those refs) to record which tickets must be done first — omit it",
  "or leave it empty when a ticket has no dependencies.",
  "Respond with JSON only, matching exactly:",
  '{"epics":[{"title":"epic title","tickets":[{"ref":"T1","title":"ticket title",',
  '"type":"story|bug|task","priority":"P0|P1|P2|P3","storyPoints":1,',
  '"acceptanceCriteria":[{"given":"...","when":"...","then":"..."}],',
  '"aiDevPrompt":"...","dependsOn":["T2"]}]}]}',
  `Return between 1 and ${MAX_EPICS} epics, each with between 1 and ${MAX_TICKETS_PER_EPIC} tickets.`,
  "storyPoints must be a whole number using the Fibonacci-like scale 1, 2, 3, 5, 8, 13, 21.",
].join(" ");

export interface RequestBacklogOptions {
  brdText: string;
  clarificationContext: string;
  techPreferences: TechPreferenceContext;
  timeoutMs?: number;
  /** Injectable purely so tests can drive the transport without real network calls. */
  fetchImpl?: typeof fetch;
}

/**
 * Asks DeepSeek to turn a BRD, its resolved clarification context and the
 * preferred tech stack into a structured backlog of epics and tickets.
 * Throws AiUnavailableError / AiResponseError / AiConfigurationError — never
 * returns partial or unvalidated content.
 */
export async function requestBacklogGeneration(
  options: RequestBacklogOptions,
): Promise<BacklogDraft> {
  const trimmedBrd = options.brdText.trim();
  if (!trimmedBrd) {
    throw new AiResponseError("Cannot generate a backlog from an empty BRD document");
  }
  const trimmedContext = options.clarificationContext.trim();
  if (!trimmedContext) {
    throw new AiResponseError("Cannot generate a backlog without a resolved clarification context");
  }

  const userPrompt = [
    "Business Requirements Document:",
    "---",
    truncateBrdText(trimmedBrd),
    "---",
    "Resolved Clarification Context:",
    "---",
    trimmedContext.length > MAX_BRD_CHARS
      ? `${trimmedContext.slice(0, MAX_BRD_CHARS)}\n\n[context truncated for analysis]`
      : trimmedContext,
    "---",
    "Preferred tech stack:",
    describeTechPreferences(options.techPreferences),
  ].join("\n");

  const parsedContent = await requestDeepSeekJson({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });

  const payload = backlogDraftSchema.safeParse(parsedContent);
  if (!payload.success) {
    throw new AiResponseError("DeepSeek returned a backlog that did not match the expected schema");
  }

  validateBacklogReferences(payload.data);

  return payload.data;
}
