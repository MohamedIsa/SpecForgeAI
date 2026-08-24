import { TRPCError } from "@trpc/server";

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

interface WindowState {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window request counter keyed by an arbitrary string (client IP or
 * user id). One instance is shared across every call to the procedure(s) it
 * guards — each `consume()` call is one attempt to use the resource, so this
 * is inherently batch-aware: a tRPC HTTP batch that bundles N calls to the
 * same rate-limited procedure runs the procedure resolver (and therefore
 * this middleware) N separate times, not once.
 */
export class RateLimiter {
  private readonly hits = new Map<string, WindowState>();
  private readonly options: RateLimitOptions;

  constructor(options: RateLimitOptions) {
    this.options = options;
  }

  /**
   * Records one attempt for `key`. Throws a TRPCError with code
   * TOO_MANY_REQUESTS (serialized as HTTP 429 by both the raw /trpc endpoint
   * and the REST wrappers in routes/docs-api.ts) once `key` has exceeded the
   * configured limit within the current window.
   */
  consume(key: string): void {
    const now = Date.now();
    const existing = this.hits.get(key);

    if (!existing || existing.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.options.windowMs });
      return;
    }

    if (existing.count >= this.options.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Too many requests — try again in ${retryAfterSeconds}s`,
      });
    }

    existing.count += 1;
  }

  /** Test-only: clears all tracked state. Never called from production code. */
  reset(): void {
    this.hits.clear();
  }
}
