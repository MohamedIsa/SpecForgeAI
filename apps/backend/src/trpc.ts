import { initTRPC, TRPCError, type TRPCDefaultErrorShape } from "@trpc/server";
import { ZodError } from "zod";
import type { RequestLike, ReplyLike } from "./lib/http";
import { RateLimiter } from "./lib/rate-limiter";

export interface Context {
  req: RequestLike;
  res: ReplyLike;
  userId: string | null;
}

export interface AuthedContext extends Context {
  userId: string;
}

/**
 * tRPC's default behavior sets a ZodError-caused TRPCError's message to the
 * raw JSON-stringified issue list, which then leaks verbatim to API clients.
 * This reformats it to the first issue's human-readable message instead.
 */
export function formatZodValidationError({
  shape,
  error,
}: {
  shape: TRPCDefaultErrorShape;
  error: TRPCError;
}): TRPCDefaultErrorShape {
  if (error.cause instanceof ZodError) {
    const firstIssue = error.cause.issues[0];
    if (firstIssue) {
      return { ...shape, message: firstIssue.message };
    }
  }
  return shape;
}

const t = initTRPC.context<Context>().create({
  errorFormatter: formatZodValidationError,
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
  }
  return next({ ctx: { ...ctx, userId: ctx.userId } satisfies AuthedContext });
});

export const AUTH_RATE_LIMIT: { windowMs: number; max: number } = { windowMs: 60_000, max: 10 };
export const AI_RATE_LIMIT: { windowMs: number; max: number } = { windowMs: 60_000, max: 10 };

const authRateLimiter = new RateLimiter(AUTH_RATE_LIMIT);
const aiRateLimiter = new RateLimiter(AI_RATE_LIMIT);

/**
 * Base for unauthenticated procedures that are natural abuse targets —
 * credential stuffing against login, bot account creation against signup.
 * Capped per client IP (there is no userId yet). Independent of the blanket
 * HTTP-level limiter in app.ts: a single /trpc batch request can smuggle many
 * distinct procedure calls past a purely route-level limiter, since Fastify
 * sees it as one HTTP request. tRPC re-runs this middleware once per call
 * inside a batch, so it counts each one individually.
 */
export const authProcedure = publicProcedure.use(({ ctx, next }) => {
  authRateLimiter.consume(`ip:${ctx.req.ip}`);
  return next();
});

/**
 * Base for authenticated procedures that trigger a real DeepSeek API call —
 * the natural target for cost-exhaustion abuse. Capped per authenticated
 * user rather than per IP, since callers behind the same NAT/office IP must
 * not share one budget.
 */
export const aiProcedure = protectedProcedure.use(({ ctx, next }) => {
  aiRateLimiter.consume(`user:${ctx.userId}`);
  return next();
});

/** Test-only: clears all rate-limit state tracked by authProcedure /
 *  aiProcedure. Never called from production code. */
export function resetRateLimitersForTests(): void {
  authRateLimiter.reset();
  aiRateLimiter.reset();
}
