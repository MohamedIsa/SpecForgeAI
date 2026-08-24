import { z } from "zod";

/**
 * Secrets that show up verbatim in .env.example / README setup instructions
 * and are attractive-but-fatal to accidentally ship to production. Matched
 * case-insensitively so "Change-Me-In-Production" doesn't slip through.
 */
const PLACEHOLDER_JWT_SECRETS = new Set([
  "change-me-in-production",
  "changeme",
  "change-me",
  "secret",
  "your-secret-here",
  "insecure",
  "replace-this-with-a-real-secret-value",
]);

const envSchema = z.object({
  DATABASE_URL: z.string().trim().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters")
    .refine((value) => !PLACEHOLDER_JWT_SECRETS.has(value.trim().toLowerCase()), {
      message: "JWT_SECRET must not be a placeholder value — generate a real secret",
    }),
  DEEPSEEK_API_KEY: z.string().trim().min(1, "DEEPSEEK_API_KEY is required"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

/** Exported so tests can validate arbitrary env shapes without mutating the
 *  real process.env (which this module also parses eagerly at import). */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}

/**
 * Parsed once at import time so a misconfigured deployment fails at boot —
 * loudly, with every problem listed at once, before it ever accepts a
 * request — rather than surfacing as a confusing runtime error the first
 * time something touches the bad value.
 */
export const env: Env = parseEnv(process.env);
