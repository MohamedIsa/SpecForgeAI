import { initTRPC, TRPCError, type TRPCDefaultErrorShape } from "@trpc/server";
import { ZodError } from "zod";
import type { RequestLike, ReplyLike } from "./lib/http";

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
