import { z } from "zod";

/**
 * DeepSeek client for the clarification engine.
 *
 * DeepSeek exposes an OpenAI-compatible `/chat/completions` endpoint, so this
 * talks to it with `fetch` rather than pulling in an SDK: it keeps the
 * dependency surface flat and makes every failure mode (timeout, non-2xx,
 * malformed JSON, schema drift) explicitly mappable and testable.
 */

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_TIMEOUT_MS = 60_000;

/** Guards against sending an enormous BRD and blowing the context window. */
export const MAX_BRD_CHARS = 60_000;
export const MAX_QUESTIONS = 8;
export const MIN_QUESTIONS = 1;

/** The AI provider could not be reached, timed out, or returned a server error. */
export class AiUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiUnavailableError";
  }
}

/** The provider replied, but not with output we can trust. */
export class AiResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiResponseError";
  }
}

/** The service is not configured (missing API key). */
export class AiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigurationError";
  }
}

export interface ClarificationQuestionDraft {
  ambiguity: string;
  prompt: string;
  quickReplies: string[];
}

export interface TechPreferenceContext {
  frontend: string | null;
  backend: string | null;
  database: string | null;
  infra: string | null;
}

/** Shape we ask DeepSeek to return, validated before it is trusted. */
const questionSchema = z.object({
  ambiguity: z.string().trim().min(1).max(200),
  question: z.string().trim().min(1).max(1000),
  quickReplies: z.array(z.string().trim().min(1).max(120)).max(6).optional().default([]),
});

const aiPayloadSchema = z.object({
  questions: z.array(questionSchema).min(MIN_QUESTIONS).max(MAX_QUESTIONS),
});

/** Minimal slice of the OpenAI-compatible completion envelope that we read. */
const completionEnvelopeSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
});

export function resolveApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new AiConfigurationError("DEEPSEEK_API_KEY environment variable is not set");
  }
  return key;
}

function resolveBaseUrl(): string {
  return process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL;
}

function resolveModel(): string {
  return process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;
}

export interface DeepSeekJsonRequestOptions {
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
  /** Injectable purely so tests can drive the transport without real network calls. */
  fetchImpl?: typeof fetch;
}

/**
 * Shared DeepSeek chat/completions plumbing: posts in JSON-object mode, then
 * unwraps and JSON-parses the model's message content. Every caller (the
 * clarification engine, the backlog generator) gets identical, once-tested
 * handling of timeouts, non-2xx responses and malformed envelopes; only the
 * prompts and the shape of the parsed content differ.
 */
export async function requestDeepSeekJson(options: DeepSeekJsonRequestOptions): Promise<unknown> {
  const apiKey = resolveApiKey();
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let response: Response;
  try {
    response = await doFetch(`${resolveBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: resolveModel(),
        messages: [
          { role: "system", content: options.systemPrompt },
          { role: "user", content: options.userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // Covers DNS failure, connection refused, and the abort signal firing.
    throw new AiUnavailableError("Could not reach the DeepSeek API", { cause: error });
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AiConfigurationError("The DeepSeek API rejected the configured API key");
    }
    throw new AiUnavailableError(`DeepSeek API returned HTTP ${response.status}`);
  }

  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch {
    throw new AiResponseError("DeepSeek returned a response that was not valid JSON");
  }

  const envelopeResult = completionEnvelopeSchema.safeParse(envelope);
  if (!envelopeResult.success) {
    throw new AiResponseError("DeepSeek returned an unexpected completion envelope");
  }

  const rawContent = envelopeResult.data.choices[0]?.message.content;
  if (!rawContent) {
    throw new AiResponseError("DeepSeek returned an empty completion");
  }

  try {
    return JSON.parse(rawContent);
  } catch {
    throw new AiResponseError("DeepSeek returned content that was not valid JSON");
  }
}

export function truncateBrdText(text: string): string {
  if (text.length <= MAX_BRD_CHARS) return text;
  return `${text.slice(0, MAX_BRD_CHARS)}\n\n[document truncated for analysis]`;
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
  "You are a senior technical lead reviewing a Business Requirements Document.",
  "Identify the specific ambiguities that would block an engineer from writing tickets,",
  "and ask targeted clarification questions that resolve them.",
  "Respond with JSON only, matching exactly:",
  '{"questions":[{"ambiguity":"short label","question":"the question to ask",',
  '"quickReplies":["option 1","option 2"]}]}',
  `Return between ${MIN_QUESTIONS} and ${MAX_QUESTIONS} questions, ordered by importance.`,
  "quickReplies must be short, selectable answers; use an empty array when free text is required.",
].join(" ");

export interface RequestQuestionsOptions {
  brdText: string;
  techPreferences: TechPreferenceContext;
  timeoutMs?: number;
  /** Injectable purely so tests can drive the transport without real network calls. */
  fetchImpl?: typeof fetch;
}

/**
 * Asks DeepSeek to analyse a BRD and return structured clarification questions.
 * Throws AiUnavailableError / AiResponseError / AiConfigurationError — never
 * returns partial or unvalidated content.
 */
export async function requestClarificationQuestions(
  options: RequestQuestionsOptions,
): Promise<ClarificationQuestionDraft[]> {
  const trimmedBrd = options.brdText.trim();
  if (!trimmedBrd) {
    throw new AiResponseError("Cannot analyse an empty BRD document");
  }

  const userPrompt = [
    "Business Requirements Document:",
    "---",
    truncateBrdText(trimmedBrd),
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

  const payload = aiPayloadSchema.safeParse(parsedContent);
  if (!payload.success) {
    throw new AiResponseError(
      "DeepSeek returned questions that did not match the expected schema",
    );
  }

  return payload.data.questions.map((question) => ({
    ambiguity: question.ambiguity,
    prompt: question.question,
    quickReplies: question.quickReplies,
  }));
}
