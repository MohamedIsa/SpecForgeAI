import { describe, it, expect, vi, afterEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { RateLimiter } from "./rate-limiter";

afterEach(() => {
  vi.useRealTimers();
});

describe("RateLimiter", () => {
  it("allows up to `max` calls for a key within the window", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, max: 3 });
    expect(() => limiter.consume("client-a")).not.toThrow();
    expect(() => limiter.consume("client-a")).not.toThrow();
    expect(() => limiter.consume("client-a")).not.toThrow();
  });

  it("throws TOO_MANY_REQUESTS on the call past `max` within the window", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, max: 3 });
    limiter.consume("client-a");
    limiter.consume("client-a");
    limiter.consume("client-a");

    let caught: unknown;
    try {
      limiter.consume("client-a");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe("TOO_MANY_REQUESTS");
  });

  it("tracks separate keys independently — one client's usage never affects another's", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, max: 2 });
    limiter.consume("client-a");
    limiter.consume("client-a");
    expect(() => limiter.consume("client-a")).toThrow(TRPCError);

    // client-b has consumed nothing yet, so it still has its own full budget.
    expect(() => limiter.consume("client-b")).not.toThrow();
    expect(() => limiter.consume("client-b")).not.toThrow();
  });

  it("resets a key's budget once the window elapses", () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ windowMs: 1_000, max: 1 });
    limiter.consume("client-a");
    expect(() => limiter.consume("client-a")).toThrow(TRPCError);

    vi.advanceTimersByTime(1_001);

    expect(() => limiter.consume("client-a")).not.toThrow();
  });

  it("reset() clears all tracked state", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, max: 1 });
    limiter.consume("client-a");
    expect(() => limiter.consume("client-a")).toThrow(TRPCError);

    limiter.reset();

    expect(() => limiter.consume("client-a")).not.toThrow();
  });
});
