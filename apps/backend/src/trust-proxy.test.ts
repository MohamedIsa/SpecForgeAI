import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import { resetRateLimitersForTests, AUTH_RATE_LIMIT } from "./trpc";

// Each test loops AUTH_RATE_LIMIT.max real bcrypt-hashing login attempts
// (see routers/rate-limiting.test.ts for the full explanation) — under
// `vitest run --coverage`, v8's instrumentation can push 10 of those past
// the default 5000ms test timeout, and a timed-out test keeps running
// invisibly in the background, corrupting whichever test runs next.
vi.setConfig({ testTimeout: 20_000 });

/**
 * These tests prove Fastify's `trustProxy: true` (app.ts) actually does what
 * SEC-T6 needs: `request.ip` (which the authProcedure/aiProcedure rate
 * limiters in trpc.ts key on) must reflect the ORIGINAL client's address —
 * carried in X-Forwarded-For — not the immediate TCP peer, which behind
 * nginx would always be nginx's own container IP, collapsing every real
 * user onto one shared rate-limit budget.
 *
 * There is no diagnostic endpoint that echoes request.ip directly, so these
 * tests observe it indirectly through the real rate limiter: two requests
 * are "the same client" to the limiter if and only if Fastify resolved the
 * same req.ip for both. That's a stronger, more realistic proof than
 * asserting on request.ip in isolation — it's the exact behavior a
 * misconfiguration here would actually break.
 */
describe("trustProxy IP parsing (SEC-T6)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetRateLimitersForTests();
  });

  it("keys request.ip off X-Forwarded-For (leftmost value), not the raw TCP peer", async () => {
    // Same immediate TCP peer (as if both requests came through the same
    // nginx container) but two different X-Forwarded-For values (two
    // different real end users behind it) — these must get independent
    // rate-limit budgets. If Fastify were reading the raw socket peer
    // instead, both would collapse onto the single "10.0.0.1" identity.
    const nginxPeerAddress = "10.0.0.1";
    const clientA = "203.0.113.50";
    const clientB = "203.0.113.51";

    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      const response = await app.inject({
        method: "POST",
        url: "/trpc/auth.login",
        remoteAddress: nginxPeerAddress,
        headers: { "x-forwarded-for": clientA },
        payload: { email: "nobody@example.com", password: "wrong", rememberMe: false },
      });
      expect(response.statusCode).not.toBe(429);
    }

    // clientA's budget is now exhausted...
    const clientAThrottled = await app.inject({
      method: "POST",
      url: "/trpc/auth.login",
      remoteAddress: nginxPeerAddress,
      headers: { "x-forwarded-for": clientA },
      payload: { email: "nobody@example.com", password: "wrong", rememberMe: false },
    });
    expect(clientAThrottled.statusCode).toBe(429);

    // ...but clientB, behind the exact same TCP peer, is untouched.
    const clientBResponse = await app.inject({
      method: "POST",
      url: "/trpc/auth.login",
      remoteAddress: nginxPeerAddress,
      headers: { "x-forwarded-for": clientB },
      payload: { email: "nobody@example.com", password: "wrong", rememberMe: false },
    });
    expect(clientBResponse.statusCode).not.toBe(429);
  });

  it("treats the same X-Forwarded-For value as the same client even across different TCP peers", async () => {
    // Mirrors what actually happens if nginx itself restarts and gets a new
    // container IP mid-traffic: the client's real identity (X-Forwarded-For)
    // doesn't change, so its rate-limit budget must carry over rather than
    // resetting just because the immediate hop's address changed.
    const sameClient = "203.0.113.60";

    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      const response = await app.inject({
        method: "POST",
        url: "/trpc/auth.login",
        remoteAddress: `10.0.0.${i + 1}`,
        headers: { "x-forwarded-for": sameClient },
        payload: { email: "nobody@example.com", password: "wrong", rememberMe: false },
      });
      expect(response.statusCode).not.toBe(429);
    }

    const throttled = await app.inject({
      method: "POST",
      url: "/trpc/auth.login",
      remoteAddress: "10.0.0.99",
      headers: { "x-forwarded-for": sameClient },
      payload: { email: "nobody@example.com", password: "wrong", rememberMe: false },
    });
    expect(throttled.statusCode).toBe(429);
  });

  it("falls back to the raw TCP peer when no X-Forwarded-For header is present", async () => {
    // A direct, non-proxied request (e.g. a test harness hitting the
    // backend directly) must still resolve to *some* stable per-client
    // identity rather than erroring — trustProxy's fallback is the plain
    // socket address.
    const directPeer = "198.51.100.10";

    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      const response = await app.inject({
        method: "POST",
        url: "/trpc/auth.login",
        remoteAddress: directPeer,
        payload: { email: "nobody@example.com", password: "wrong", rememberMe: false },
      });
      expect(response.statusCode).not.toBe(429);
    }

    const throttled = await app.inject({
      method: "POST",
      url: "/trpc/auth.login",
      remoteAddress: directPeer,
      payload: { email: "nobody@example.com", password: "wrong", rememberMe: false },
    });
    expect(throttled.statusCode).toBe(429);

    // A different direct peer is a different client.
    const otherPeer = await app.inject({
      method: "POST",
      url: "/trpc/auth.login",
      remoteAddress: "198.51.100.11",
      payload: { email: "nobody@example.com", password: "wrong", rememberMe: false },
    });
    expect(otherPeer.statusCode).not.toBe(429);
  });
});
