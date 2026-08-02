import { z } from "zod";

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
