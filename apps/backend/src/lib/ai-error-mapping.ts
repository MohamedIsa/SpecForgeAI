import { TRPCError } from "@trpc/server";
import { AiConfigurationError, AiUnavailableError, AiResponseError } from "../services/ai";

/**
 * Maps AI-layer failures onto tRPC errors without leaking provider internals.
 * Shared by every router that calls DeepSeek (clarification, backlog
 * generation) so the mapping only exists once.
 */
export function toTrpcAiError(error: unknown, fallbackMessage: string): TRPCError {
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
    : new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: fallbackMessage });
}
