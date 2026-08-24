import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { TRPCError } from "@trpc/server";
import type { FastifyInstance } from "fastify";
import { createTestCaller } from "../test-utils";
import { resetRateLimitersForTests, AUTH_RATE_LIMIT, AI_RATE_LIMIT } from "../trpc";
import { buildApp } from "../app";
import { pool } from "../db/pool";

const NONEXISTENT_PROJECT_ID = "00000000-0000-0000-0000-000000000000";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

const createdUserIds: string[] = [];

afterEach(async () => {
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop();
    await pool.query("DELETE FROM users WHERE id = $1", [id]);
  }
});

beforeEach(() => {
  resetRateLimitersForTests();
});

describe("authProcedure — auth.login / auth.signup share one per-IP budget", () => {
  it("returns TOO_MANY_REQUESTS once a client exceeds the shared budget across both procedures", async () => {
    const ip = "203.0.113.10";

    // Alternate login (fails fast — no such account, but still consumes a
    // slot) and signup (succeeds, also consumes a slot) to prove the budget
    // is shared across both procedures, not tracked per-procedure.
    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      if (i % 2 === 0) {
        const { caller } = createTestCaller(null, {}, ip);
        await expect(
          caller.auth.login({ email: "nobody@example.com", password: "wrong", rememberMe: false }),
        ).rejects.toThrow();
      } else {
        const { caller } = createTestCaller(null, {}, ip);
        const result = await caller.auth.signup({
          fullName: "Burst Test",
          email: uniqueEmail("burst"),
          password: "a-strong-password",
        });
        createdUserIds.push(result.user.id);
      }
    }

    // Budget is now exhausted — the next call, regardless of which of the
    // two procedures it hits, must be rejected before it does any work.
    const { caller } = createTestCaller(null, {}, ip);
    let caught: unknown;
    try {
      await caller.auth.login({ email: "nobody@example.com", password: "wrong", rememberMe: false });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe("TOO_MANY_REQUESTS");
  });

  it("does not throttle a different client's login/signup attempts", async () => {
    const throttledIp = "203.0.113.20";
    const unaffectedIp = "203.0.113.21";

    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      const { caller } = createTestCaller(null, {}, throttledIp);
      await expect(
        caller.auth.login({ email: "nobody@example.com", password: "wrong", rememberMe: false }),
      ).rejects.toThrow();
    }
    const { caller: throttled } = createTestCaller(null, {}, throttledIp);
    await expect(
      throttled.auth.login({ email: "nobody@example.com", password: "wrong", rememberMe: false }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });

    const { caller: unaffected } = createTestCaller(null, {}, unaffectedIp);
    const result = await unaffected.auth.signup({
      fullName: "Different Client",
      email: uniqueEmail("different-client"),
      password: "a-strong-password",
    });
    createdUserIds.push(result.user.id);
  });
});

describe("aiProcedure — clarification.startSession / backlog.generateBacklog share one per-user budget", () => {
  it("returns TOO_MANY_REQUESTS once an authenticated user exceeds the shared budget across both procedures", async () => {
    const userId = "11111111-1111-1111-1111-111111111111";

    for (let i = 0; i < AI_RATE_LIMIT.max; i++) {
      const { caller } = createTestCaller(userId);
      const target =
        i % 2 === 0
          ? caller.clarification.startSession({ projectId: NONEXISTENT_PROJECT_ID })
          : caller.backlog.generateBacklog({ projectId: NONEXISTENT_PROJECT_ID });
      // Each call fails on the membership check (no such project) — the
      // point is only that the middleware still counts it before that
      // check runs.
      await expect(target).rejects.toThrow();
    }

    const { caller } = createTestCaller(userId);
    let caught: unknown;
    try {
      await caller.clarification.startSession({ projectId: NONEXISTENT_PROJECT_ID });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe("TOO_MANY_REQUESTS");
  });

  it("does not throttle a different user's AI-backed calls", async () => {
    const throttledUserId = "22222222-2222-2222-2222-222222222222";
    const unaffectedUserId = "33333333-3333-3333-3333-333333333333";

    for (let i = 0; i < AI_RATE_LIMIT.max; i++) {
      const { caller } = createTestCaller(throttledUserId);
      await expect(
        caller.backlog.generateBacklog({ projectId: NONEXISTENT_PROJECT_ID }),
      ).rejects.toThrow();
    }
    const { caller: throttled } = createTestCaller(throttledUserId);
    await expect(
      throttled.backlog.generateBacklog({ projectId: NONEXISTENT_PROJECT_ID }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });

    const { caller: unaffected } = createTestCaller(unaffectedUserId);
    await expect(
      unaffected.clarification.startSession({ projectId: NONEXISTENT_PROJECT_ID }),
    ).rejects.not.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("rate limiting over real HTTP", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    delete process.env.ENABLE_SWAGGER;
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetRateLimitersForTests();
  });

  it("serializes a rate-limited tRPC procedure as a genuine HTTP 429 over /trpc", async () => {
    const remoteAddress = "203.0.113.30";

    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      const response = await app.inject({
        method: "POST",
        url: "/trpc/auth.login",
        remoteAddress,
        payload: { email: "nobody@example.com", password: "wrong", rememberMe: false },
      });
      expect(response.statusCode).not.toBe(429);
    }

    const throttledResponse = await app.inject({
      method: "POST",
      url: "/trpc/auth.login",
      remoteAddress,
      payload: { email: "nobody@example.com", password: "wrong", rememberMe: false },
    });
    expect(throttledResponse.statusCode).toBe(429);
  });

  it("serializes a rate-limited tRPC procedure as a genuine HTTP 429 over the REST wrapper", async () => {
    const remoteAddress = "203.0.113.31";

    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        remoteAddress,
        payload: { email: "nobody@example.com", password: "wrong", rememberMe: false },
      });
      expect(response.statusCode).not.toBe(429);
    }

    const throttledResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress,
      payload: { email: "nobody@example.com", password: "wrong", rememberMe: false },
    });
    expect(throttledResponse.statusCode).toBe(429);
    expect(JSON.parse(throttledResponse.payload)).toMatchObject({
      error: { code: "TOO_MANY_REQUESTS" },
    });
  });

  it("registers the global @fastify/rate-limit baseline (visible via response headers)", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.headers["x-ratelimit-limit"]).toBe("300");
    expect(response.headers).toHaveProperty("x-ratelimit-remaining");
  });
});
