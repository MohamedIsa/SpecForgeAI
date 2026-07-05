import OpenAI from "openai";
import type {
  TicketType,
  Priority,
  StoryPoints,
  TicketStatus,
} from "../db/schema";

export interface ExtractedTicket {
  id: string;
  epicId: string;
  title: string;
  type: TicketType;
  priority: Priority;
  storyPoints: StoryPoints;
  status: TicketStatus;
  dependencies: string[];
  description: string;
  acceptanceCriteria: string[];
  aiDevPrompt: string;
}

export interface ExtractedEpic {
  id: string;
  title: string;
  description: string;
  tickets: ExtractedTicket[];
}

export interface ValidationReport {
  targetStack: string | null;
  stackProvided: boolean;
  matchScore: number;
  compatibilityGaps: string[];
  recommendations: string[];
}

export interface ExtractionResult {
  epics: ExtractedEpic[];
  validationReport: ValidationReport;
}

function buildSystemPrompt(): string {
  return `You are a technical project manager and senior software architect. Your task is to analyze a Business Requirements Document (BRD) and extract a structured technical backlog.

## Output Format
Return ONLY valid JSON. Do not include markdown fences, explanations, or any text outside the JSON object. The JSON must conform to this structure:

{
  "epics": [
    {
      "id": "epic-0",
      "title": "Epic title",
      "description": "Epic description",
      "tickets": [
        {
          "id": "EPIC-0-T1",
          "epicId": "epic-0",
          "title": "Ticket title",
          "type": "setup" | "feature" | "infra" | "integration" | "testing" | "bugfix",
          "priority": "P0" | "P1" | "P2" | "P3",
          "storyPoints": 1 | 2 | 3 | 5 | 8,
          "status": "backlog",
          "dependencies": [],
          "description": "Detailed ticket description with technical context",
          "acceptanceCriteria": [
            "Given ... When ... Then ...",
            "Given ... When ... Then ...",
            "Given ... When ... Then ..."
          ],
          "aiDevPrompt": "A standalone, context-complete developer prompt. Include specific file paths, type safety requirements, test expectations, and implementation details. The prompt must be detailed enough that a developer can implement the ticket in isolation without reading other tickets."
        }
      ]
    }
  ],
  "validationReport": {
    "targetStack": "The user-provided tech stack string, or null if omitted",
    "stackProvided": true,
    "matchScore": 85,
    "compatibilityGaps": ["gap description"],
    "recommendations": ["recommendation"]
  }
}

## Guidelines
1. Group related tasks into coherent Epics (minimum 1 epic, typically 2-4).
2. Each ticket must have exactly 3-5 acceptance criteria in Given/When/Then format.
3. The aiDevPrompt must be a complete, standalone implementation brief. Include concrete file paths, type safety constraints, testing expectations, and enough context for isolated implementation.
4. Story points: 1 (trivial), 2 (small), 3 (medium), 5 (large), 8 (extra-large).
5. If a target tech stack is provided, validate the BRD against it. Identify gaps and compatibility issues. Do NOT recommend alternative stacks.
6. If no target tech stack is provided, analyze the requirements and recommend an appropriate stack based on the project's needs.
7. All ticket statuses must be "backlog".
8. Dependencies arrays should reference other ticket IDs that must be completed first.
9. Ticket IDs must follow the pattern EPIC-{epicIndex}-T{ticketIndex}.`;
}

function buildUserPrompt(
  brdText: string,
  targetTechStack: string | null,
): string {
  const stackInstruction =
    targetTechStack != null && targetTechStack !== ""
      ? `\n\nTarget Tech Stack: ${targetTechStack}\n\nValidate the BRD against this specific stack. Identify compatibility gaps. Do NOT recommend alternative stacks.`
      : "\n\nNo target tech stack was provided. Analyze the BRD requirements and recommend an appropriate technology stack.";

  return `Analyze the following Business Requirements Document and extract a structured technical backlog.

## BRD Content
${brdText}
${stackInstruction}`;
}

function parseResponse(raw: string): ExtractionResult {
  const trimmed = raw.trim();
  let json: unknown;

  try {
    json = JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);

    if (match != null) {
      try {
        json = JSON.parse(match[0]);
      } catch {
        throw new Error("Failed to parse DeepSeek response as JSON.");
      }
    } else {
      throw new Error("DeepSeek response does not contain valid JSON.");
    }
  }

  if (json == null || typeof json !== "object") {
    throw new Error("DeepSeek response is not a JSON object.");
  }

  return json as ExtractionResult;
}

const VALID_TICKET_TYPES: ReadonlySet<string> = new Set([
  "setup",
  "feature",
  "infra",
  "integration",
  "testing",
  "bugfix",
]);

const VALID_PRIORITIES: ReadonlySet<string> = new Set([
  "P0",
  "P1",
  "P2",
  "P3",
]);

const VALID_STORY_POINTS: ReadonlySet<number> = new Set([1, 2, 3, 5, 8]);

const GWT_REGEX =
  /^(?=.*\bgiven\b)(?=.*\bwhen\b)(?=.*\bthen\b).*$/is;

function validateTicket(ticket: unknown, index: number): void {
  const t = ticket as Record<string, unknown>;

  const requiredFields = [
    "id",
    "epicId",
    "title",
    "type",
    "priority",
    "storyPoints",
    "status",
    "dependencies",
    "description",
    "acceptanceCriteria",
    "aiDevPrompt",
  ];

  for (const field of requiredFields) {
    if (t[field] === undefined || t[field] === null) {
      throw new Error(
        `Ticket at index ${index} is missing required field "${field}".`,
      );
    }
  }

  if (!VALID_TICKET_TYPES.has(t["type"] as string)) {
    throw new Error(
      `Ticket at index ${index} has invalid type "${String(t["type"])}". Expected one of: ${[...VALID_TICKET_TYPES].join(", ")}.`,
    );
  }

  if (!VALID_PRIORITIES.has(t["priority"] as string)) {
    throw new Error(
      `Ticket at index ${index} has invalid priority "${String(t["priority"])}". Expected one of: ${[...VALID_PRIORITIES].join(", ")}.`,
    );
  }

  if (!VALID_STORY_POINTS.has(Number(t["storyPoints"]))) {
    throw new Error(
      `Ticket at index ${index} has invalid storyPoints "${String(t["storyPoints"])}". Expected one of: ${[...VALID_STORY_POINTS].join(", ")}.`,
    );
  }

  if (t["status"] !== "backlog") {
    throw new Error(
      `Ticket at index ${index} has status "${String(t["status"])}". All generated tickets must have status "backlog".`,
    );
  }

  if (!Array.isArray(t["dependencies"])) {
    throw new Error(
      `Ticket at index ${index} has non-array dependencies.`,
    );
  }

  if (!Array.isArray(t["acceptanceCriteria"])) {
    throw new Error(
      `Ticket at index ${index} has non-array acceptanceCriteria.`,
    );
  }

  const acs = t["acceptanceCriteria"] as unknown[];

  if (acs.length < 3) {
    throw new Error(
      `Ticket at index ${index} has fewer than 3 acceptance criteria.`,
    );
  }

  for (let i = 0; i < acs.length; i++) {
    const ac = String(acs[i] ?? "");

    if (!GWT_REGEX.test(ac)) {
      throw new Error(
        `Ticket at index ${index} acceptanceCriteria[${i}] does not follow Given/When/Then format: "${ac.slice(0, 80)}..."`,
      );
    }
  }

  if (
    typeof t["aiDevPrompt"] !== "string" ||
    (t["aiDevPrompt"] as string).length < 50
  ) {
    throw new Error(
      `Ticket at index ${index} has an insufficient aiDevPrompt.`,
    );
  }
}

function validateResult(result: ExtractionResult): void {
  if (!Array.isArray(result.epics) || result.epics.length === 0) {
    throw new Error("Extraction result must contain at least one epic.");
  }

  let ticketIndex = 0;

  for (const epic of result.epics) {
    if (typeof epic.id !== "string" || epic.id === "") {
      throw new Error("Epic is missing a valid id.");
    }

    if (!Array.isArray(epic.tickets)) {
      throw new Error(`Epic "${epic.id}" has no tickets array.`);
    }

    for (const ticket of epic.tickets) {
      validateTicket(ticket, ticketIndex);
      ticketIndex++;
    }
  }

  const vr = result.validationReport;

  if (vr == null || typeof vr !== "object") {
    throw new Error("Extraction result is missing a validationReport.");
  }

  if (typeof vr["stackProvided"] !== "boolean") {
    throw new Error(
      "validationReport.stackProvided must be a boolean.",
    );
  }

  if (typeof vr["matchScore"] !== "number") {
    throw new Error(
      "validationReport.matchScore must be a number (0-100).",
    );
  }

  const score = vr["matchScore"] as number;

  if (score < 0 || score > 100) {
    throw new Error(
      `validationReport.matchScore must be between 0 and 100, got ${score}.`,
    );
  }

  if (!Array.isArray(vr["compatibilityGaps"])) {
    throw new Error(
      "validationReport.compatibilityGaps must be an array.",
    );
  }

  if (!Array.isArray(vr["recommendations"])) {
    throw new Error(
      "validationReport.recommendations must be an array.",
    );
  }
}

export function createDeepSeekClient(): OpenAI {
  const baseURL =
    process.env["DEEPSEEK_BASE_URL"] ?? "https://api.deepseek.com";
  const apiKey = process.env["DEEPSEEK_API_KEY"];

  if (apiKey == null || apiKey === "") {
    throw new Error(
      "DEEPSEEK_API_KEY environment variable is required.",
    );
  }

  return new OpenAI({ baseURL, apiKey });
}

export interface ExtractBacklogOptions {
  brdText: string;
  targetTechStack?: string;
  model?: string;
}

export async function extractBacklog(
  client: OpenAI,
  options: ExtractBacklogOptions,
): Promise<ExtractionResult> {
  const model = options.model ?? "deepseek-chat";

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      {
        role: "user",
        content: buildUserPrompt(
          options.brdText,
          options.targetTechStack ?? null,
        ),
      },
    ],
    temperature: 0.3,
    max_tokens: 8192,
  });

  const rawContent = response.choices[0]?.message?.content;

  if (rawContent == null || rawContent === "") {
    throw new Error("DeepSeek returned an empty response.");
  }

  const result = parseResponse(rawContent);
  validateResult(result);

  return result;
}
