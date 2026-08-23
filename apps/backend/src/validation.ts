import { z } from "zod";
import { backlogDraftSchema } from "./services/backlog-generator";

const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

export const signupInput = z.object({
  fullName: z.string().trim().min(1, "Full name is required").max(200),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export const loginInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required").max(200),
  rememberMe: z.boolean().optional().default(false),
});

export const createProjectInput = z.object({
  name: z.string().trim().min(1, "Project name is required").max(200),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      PROJECT_KEY_PATTERN,
      "Key must be 2-10 uppercase letters/numbers, starting with a letter",
    ),
  description: z.string().trim().max(2000).optional(),
  template: z.enum(["kanban", "scrum"]),
});

export const inviteMemberInput = z.object({
  projectId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  role: z.enum(["owner", "editor", "viewer"]),
});

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export const getProjectStatusesInput = z.object({
  projectId: z.string().uuid(),
});

export const createStatusInput = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1, "Status name is required").max(100),
  color: z.string().regex(HEX_COLOR_PATTERN, "Color must be a 6-digit hex code").optional(),
});

export const reorderStatusesInput = z.object({
  projectId: z.string().uuid(),
  orderedStatusIds: z
    .array(z.string().uuid())
    .min(1, "At least one status is required"),
});

export const deleteStatusInput = z.object({
  projectId: z.string().uuid(),
  statusId: z.string().uuid(),
});

const acceptanceCriterionSchema = z.object({
  given: z.string().trim().min(1, "Given is required").max(500),
  when: z.string().trim().min(1, "When is required").max(500),
  expectedResult: z.string().trim().min(1, "Expected result is required").max(500),
  checked: z.boolean(),
});

export const createTicketInput = z.object({
  projectId: z.string().uuid(),
  statusId: z.string().uuid(),
  title: z.string().trim().min(1, "Title is required").max(300),
  description: z.string().trim().max(5000).optional(),
  type: z.enum(["story", "bug", "task"]),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  storyPoints: z.number().int().min(0).max(100).optional(),
  assigneeId: z.string().uuid().optional(),
  acceptanceCriteria: z.array(acceptanceCriterionSchema).optional().default([]),
  aiDevPrompt: z.string().trim().max(10000).optional(),
  dependencies: z.array(z.string().uuid()).optional().default([]),
});

export const updateTicketStatusInput = z.object({
  projectId: z.string().uuid(),
  ticketId: z.string().uuid(),
  statusId: z.string().uuid(),
});

export const updateTicketInput = z.object({
  projectId: z.string().uuid(),
  ticketId: z.string().uuid(),
  title: z.string().trim().min(1, "Title is required").max(300).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
  storyPoints: z.number().int().min(0).max(100).nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
});

export const getTicketDetailsInput = z.object({
  projectId: z.string().uuid(),
  ticketId: z.string().uuid(),
});

export const getProjectTicketsInput = z.object({
  projectId: z.string().uuid(),
});

const techPreferenceField = z.string().trim().max(200).nullable().optional();

export const getBrdFilesInput = z.object({
  projectId: z.string().uuid(),
});

export const getTechPreferencesInput = z.object({
  projectId: z.string().uuid(),
});

export const saveTechPreferencesInput = z.object({
  projectId: z.string().uuid(),
  frontend: techPreferenceField,
  backend: techPreferenceField,
  database: techPreferenceField,
  infra: techPreferenceField,
});

export const startClarificationInput = z.object({
  projectId: z.string().uuid(),
});

export const getClarificationStateInput = z.object({
  projectId: z.string().uuid(),
});

export const sendClarificationMessageInput = z.object({
  projectId: z.string().uuid(),
  questionId: z.string().uuid(),
  answer: z.string().trim().min(1, "An answer is required").max(2000),
});

export const completeClarificationInput = z.object({
  projectId: z.string().uuid(),
});

export const generateBacklogInput = z.object({
  projectId: z.string().uuid(),
});

export const publishBacklogInput = backlogDraftSchema.extend({
  projectId: z.string().uuid(),
});
