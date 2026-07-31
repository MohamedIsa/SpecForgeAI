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
