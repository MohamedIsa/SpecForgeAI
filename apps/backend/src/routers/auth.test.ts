import { describe, it, expect, afterEach, vi } from "vitest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { TRPCError } from "@trpc/server";
import { createTestCaller, type CapturedCookie, type FakeReply } from "../test-utils";
import { pool } from "../db/pool";
import type { AuthResult } from "./auth";

interface AccessPayload {
  sub: string;
  type: string;
  iat: number;
  exp: number;
}

interface RefreshPayload {
  sub: string;
  sid: string;
  type: string;
  iat: number;
  exp: number;
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set for this test run");
  return secret;
}

function requireCookie(reply: FakeReply, name: string): CapturedCookie {
  const cookie = reply.setCookies[name];
  if (!cookie) throw new Error(`expected a ${name} cookie to be set`);
  return cookie;
}

function uniqueEmail(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

const createdUserIds: string[] = [];

afterEach(async () => {
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop();
    // Cascades to any sessions rows via the sessions.user_id FK.
    await pool.query("DELETE FROM users WHERE id = $1", [id]);
  }
});

async function signupUser(
  overrides: Partial<{ fullName: string; email: string; password: string }> = {},
) {
  const { caller, reply } = createTestCaller(null);
  const result = await caller.auth.signup({
    fullName: overrides.fullName ?? "Ada Lovelace",
    email: overrides.email ?? uniqueEmail(),
    password: overrides.password ?? "correct-horse-battery",
  });
  createdUserIds.push(result.user.id);
  return { result, reply };
}

describe("authRouter.signup", () => {
  it("creates a user with a bcrypt hash (12 rounds), a 15-minute access token, and an httpOnly/strict refresh cookie", async () => {
    const { result, reply } = await signupUser({ fullName: "Ada Lovelace" });

    expect(result.user.fullName).toBe("Ada Lovelace");
    expect(result.expiresInSeconds).toBe(900);

    const row = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = $1",
      [result.user.id],
    );
    const passwordHash = row.rows[0]?.password_hash;
    expect(passwordHash).toBeDefined();
    if (!passwordHash) throw new Error("expected password hash to exist");
    expect(bcrypt.getRounds(passwordHash)).toBe(12);

    const decodedAccess = jwt.verify(result.accessToken, getSecret()) as AccessPayload;
    expect(decodedAccess.type).toBe("access");
    expect(decodedAccess.sub).toBe(result.user.id);
    expect(decodedAccess.exp - decodedAccess.iat).toBe(900);

    const cookie = requireCookie(reply, "refreshToken");
    expect(cookie.options?.httpOnly).toBe(true);
    expect(cookie.options?.sameSite).toBe("strict");
    expect(cookie.options?.secure).toBe(false);
    expect(cookie.options?.maxAge).toBeUndefined();

    const decodedRefresh = jwt.verify(cookie.value, getSecret()) as RefreshPayload;
    expect(decodedRefresh.type).toBe("refresh");
    expect(decodedRefresh.sub).toBe(result.user.id);

    const sessionRow = await pool.query("SELECT id FROM sessions WHERE id = $1", [
      decodedRefresh.sid,
    ]);
    expect(sessionRow.rows).toHaveLength(1);
  });

  it("rejects a duplicate email with CONFLICT", async () => {
    const email = uniqueEmail();
    await signupUser({ fullName: "Grace Hopper", email });

    await expect(
      createTestCaller(null).caller.auth.signup({
        fullName: "Grace Hopper Duplicate",
        email,
        password: "yet-another-password",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects a concurrent duplicate signup with CONFLICT, not a raw DB error", async () => {
    const email = uniqueEmail();

    const results = await Promise.allSettled([
      createTestCaller(null).caller.auth.signup({
        fullName: "Concurrent One",
        email,
        password: "concurrent-password-1",
      }),
      createTestCaller(null).caller.auth.signup({
        fullName: "Concurrent Two",
        email,
        password: "concurrent-password-2",
      }),
    ]);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<AuthResult> => result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const fulfilledResult = fulfilled[0];
    const rejectedResult = rejected[0];
    if (!fulfilledResult || !rejectedResult) {
      throw new Error("expected exactly one fulfilled and one rejected signup");
    }
    createdUserIds.push(fulfilledResult.value.user.id);

    expect(rejectedResult.reason).toMatchObject({ code: "CONFLICT" });
    const message = String((rejectedResult.reason as { message?: unknown }).message ?? "");
    expect(message).not.toMatch(/constraint|duplicate key|SQL/i);
  });

  it("rejects an invalid email via Zod validation", async () => {
    await expect(
      createTestCaller(null).caller.auth.signup({
        fullName: "Invalid Email",
        email: "not-an-email",
        password: "valid-password",
      }),
    ).rejects.toThrow();
  });

  it("rejects a password shorter than 8 characters via Zod validation", async () => {
    await expect(
      createTestCaller(null).caller.auth.signup({
        fullName: "Short Password",
        email: uniqueEmail(),
        password: "short",
      }),
    ).rejects.toThrow();
  });
});

describe("refresh cookie secure flag (SEC-T6)", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowInsecure = process.env.ALLOW_INSECURE_COOKIES;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalAllowInsecure === undefined) delete process.env.ALLOW_INSECURE_COOKIES;
    else process.env.ALLOW_INSECURE_COOKIES = originalAllowInsecure;
  });

  it("is secure when X-Forwarded-Proto is https, regardless of NODE_ENV", async () => {
    process.env.NODE_ENV = "test";
    const { caller, reply } = createTestCaller(null, {}, undefined, {
      "x-forwarded-proto": "https",
    });
    const result = await caller.auth.signup({
      fullName: "HTTPS Proxy Test",
      email: uniqueEmail(),
      password: "a-strong-password",
    });
    createdUserIds.push(result.user.id);
    const cookie = requireCookie(reply, "refreshToken");
    expect(cookie.options?.secure).toBe(true);
  });

  it("is not secure when X-Forwarded-Proto is present but not https", async () => {
    process.env.NODE_ENV = "test";
    const { caller, reply } = createTestCaller(null, {}, undefined, {
      "x-forwarded-proto": "http",
    });
    const result = await caller.auth.signup({
      fullName: "HTTP Proxy Test",
      email: uniqueEmail(),
      password: "a-strong-password",
    });
    createdUserIds.push(result.user.id);
    const cookie = requireCookie(reply, "refreshToken");
    expect(cookie.options?.secure).toBe(false);
  });

  it("is not secure when X-Forwarded-Proto: http even under NODE_ENV=production — the exact combination the live HTTP-only staging deployment produces on every request", async () => {
    // Regression test for a real bug caught in review: an earlier `||`-based
    // implementation treated "header present but not https" the same as
    // "header absent" and fell through to the NODE_ENV=production check,
    // marking the cookie Secure on a plain-HTTP box — where browsers then
    // silently refuse to send it back, breaking session refresh. nginx.conf
    // always sets X-Forwarded-Proto to $scheme, so on that box the header is
    // never absent; it's always exactly "http".
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_INSECURE_COOKIES;
    const { caller, reply } = createTestCaller(null, {}, undefined, {
      "x-forwarded-proto": "http",
    });
    const result = await caller.auth.signup({
      fullName: "Production HTTP Proxy Test",
      email: uniqueEmail(),
      password: "a-strong-password",
    });
    createdUserIds.push(result.user.id);
    const cookie = requireCookie(reply, "refreshToken");
    expect(cookie.options?.secure).toBe(false);
  });

  it("falls back to NODE_ENV=production when X-Forwarded-Proto is absent", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_INSECURE_COOKIES;
    const { caller, reply } = createTestCaller(null);
    const result = await caller.auth.signup({
      fullName: "Direct Production Test",
      email: uniqueEmail(),
      password: "a-strong-password",
    });
    createdUserIds.push(result.user.id);
    const cookie = requireCookie(reply, "refreshToken");
    expect(cookie.options?.secure).toBe(true);
  });

  it("is not secure outside production when X-Forwarded-Proto is absent (existing test-env behavior)", async () => {
    process.env.NODE_ENV = "test";
    const { caller, reply } = createTestCaller(null);
    const result = await caller.auth.signup({
      fullName: "Direct Test Env Test",
      email: uniqueEmail(),
      password: "a-strong-password",
    });
    createdUserIds.push(result.user.id);
    const cookie = requireCookie(reply, "refreshToken");
    expect(cookie.options?.secure).toBe(false);
  });

  it("ALLOW_INSECURE_COOKIES opts out of the production fallback when there is no proxy header", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_INSECURE_COOKIES = "true";
    const { caller, reply } = createTestCaller(null);
    const result = await caller.auth.signup({
      fullName: "Insecure Opt-out Test",
      email: uniqueEmail(),
      password: "a-strong-password",
    });
    createdUserIds.push(result.user.id);
    const cookie = requireCookie(reply, "refreshToken");
    expect(cookie.options?.secure).toBe(false);
  });

  it("X-Forwarded-Proto: https still wins even with ALLOW_INSECURE_COOKIES set", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_INSECURE_COOKIES = "true";
    const { caller, reply } = createTestCaller(null, {}, undefined, {
      "x-forwarded-proto": "https",
    });
    const result = await caller.auth.signup({
      fullName: "HTTPS Overrides Opt-out Test",
      email: uniqueEmail(),
      password: "a-strong-password",
    });
    createdUserIds.push(result.user.id);
    const cookie = requireCookie(reply, "refreshToken");
    expect(cookie.options?.secure).toBe(true);
  });
});

describe("authRouter.login", () => {
  it("authenticates with correct credentials and issues a 15-minute access token", async () => {
    const email = uniqueEmail();
    const password = "apollo-guidance";
    const { result: signupResult } = await signupUser({ fullName: "Margaret Hamilton", email, password });

    const { caller } = createTestCaller(null);
    const loginResult = await caller.auth.login({ email, password, rememberMe: false });
    expect(loginResult.user.id).toBe(signupResult.user.id);
    expect(loginResult.expiresInSeconds).toBe(900);

    const decoded = jwt.verify(loginResult.accessToken, getSecret()) as AccessPayload;
    expect(decoded.sub).toBe(signupResult.user.id);
    expect(decoded.type).toBe("access");
  });

  it("sets a 30-day cookie maxAge when rememberMe is checked, and a session cookie when unchecked", async () => {
    const email = uniqueEmail();
    const password = "correct-horse-battery";
    await signupUser({ fullName: "Remember Me", email, password });

    const { caller: rememberCaller, reply: rememberReply } = createTestCaller(null);
    await rememberCaller.auth.login({ email, password, rememberMe: true });
    const rememberCookie = requireCookie(rememberReply, "refreshToken");
    expect(rememberCookie.options?.maxAge).toBe(30 * 24 * 60 * 60);

    const { caller: sessionCaller, reply: sessionReply } = createTestCaller(null);
    await sessionCaller.auth.login({ email, password, rememberMe: false });
    const sessionCookie = requireCookie(sessionReply, "refreshToken");
    expect(sessionCookie.options?.maxAge).toBeUndefined();
  });

  it("rejects an incorrect password with UNAUTHORIZED", async () => {
    const email = uniqueEmail();
    await signupUser({ fullName: "Katherine Johnson", email, password: "correct-password" });

    await expect(
      createTestCaller(null).caller.auth.login({
        email,
        password: "wrong-password",
        rememberMe: false,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects a non-existent email with UNAUTHORIZED", async () => {
    await expect(
      createTestCaller(null).caller.auth.login({
        email: uniqueEmail(),
        password: "whatever-password",
        rememberMe: false,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  describe("email enumeration protection (SEC-T4)", () => {
    it("returns byte-for-byte the same error message for a wrong password and a non-existent email", async () => {
      const email = uniqueEmail();
      await signupUser({ email, password: "correct-password" });

      let wrongPasswordError: unknown;
      try {
        await createTestCaller(null).caller.auth.login({
          email,
          password: "wrong-password",
          rememberMe: false,
        });
      } catch (error) {
        wrongPasswordError = error;
      }

      let noSuchUserError: unknown;
      try {
        await createTestCaller(null).caller.auth.login({
          email: uniqueEmail(),
          password: "whatever-password",
          rememberMe: false,
        });
      } catch (error) {
        noSuchUserError = error;
      }

      expect(wrongPasswordError).toBeInstanceOf(TRPCError);
      expect(noSuchUserError).toBeInstanceOf(TRPCError);
      expect((wrongPasswordError as TRPCError).message).toBe(
        (noSuchUserError as TRPCError).message,
      );
    });

    it("runs a bcrypt.compare against a dummy hash even when the email has no matching account", async () => {
      const compareSpy = vi.spyOn(bcrypt, "compare");
      try {
        await expect(
          createTestCaller(null).caller.auth.login({
            email: uniqueEmail(),
            password: "whatever-password",
            rememberMe: false,
          }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

        // Exactly one compare — the dummy-hash path — since no real user
        // row (and therefore no real password_hash) exists to compare against.
        expect(compareSpy).toHaveBeenCalledTimes(1);
      } finally {
        compareSpy.mockRestore();
      }
    });

    it("runs exactly one bcrypt.compare for a real account too, so both paths pay the same cost", async () => {
      const email = uniqueEmail();
      await signupUser({ email, password: "correct-password" });

      const compareSpy = vi.spyOn(bcrypt, "compare");
      try {
        await expect(
          createTestCaller(null).caller.auth.login({
            email,
            password: "wrong-password",
            rememberMe: false,
          }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

        expect(compareSpy).toHaveBeenCalledTimes(1);
      } finally {
        compareSpy.mockRestore();
      }
    });
  });
});

describe("authRouter.refreshSession", () => {
  it("rotates the session: issues a new access token and a new refresh cookie, invalidating the old session row", async () => {
    const { reply } = await signupUser();
    const oldCookie = requireCookie(reply, "refreshToken");
    const oldDecoded = jwt.verify(oldCookie.value, getSecret()) as RefreshPayload;

    const { caller, reply: refreshReply } = createTestCaller(null, {
      refreshToken: oldCookie.value,
    });
    const refreshed = await caller.auth.refreshSession();
    expect(refreshed.expiresInSeconds).toBe(900);

    const newCookie = requireCookie(refreshReply, "refreshToken");
    expect(newCookie.value).not.toBe(oldCookie.value);
    const newDecoded = jwt.verify(newCookie.value, getSecret()) as RefreshPayload;
    expect(newDecoded.sid).not.toBe(oldDecoded.sid);

    const oldSessionRow = await pool.query("SELECT id FROM sessions WHERE id = $1", [
      oldDecoded.sid,
    ]);
    expect(oldSessionRow.rows).toHaveLength(0);

    const newSessionRow = await pool.query("SELECT id FROM sessions WHERE id = $1", [
      newDecoded.sid,
    ]);
    expect(newSessionRow.rows).toHaveLength(1);
  });

  it("carries the rememberMe flag through rotation, keeping the 30-day cookie maxAge", async () => {
    const email = uniqueEmail();
    const password = "correct-horse-battery";
    await signupUser({ email, password });

    const { caller: loginCaller, reply: loginReply } = createTestCaller(null);
    await loginCaller.auth.login({ email, password, rememberMe: true });
    const loginCookie = requireCookie(loginReply, "refreshToken");

    const { caller: refreshCaller, reply: refreshReply } = createTestCaller(null, {
      refreshToken: loginCookie.value,
    });
    await refreshCaller.auth.refreshSession();
    const rotatedCookie = requireCookie(refreshReply, "refreshToken");
    expect(rotatedCookie.options?.maxAge).toBe(30 * 24 * 60 * 60);
  });

  it("rejects reuse of a refresh token after it has already been rotated", async () => {
    const { reply } = await signupUser();
    const cookie = requireCookie(reply, "refreshToken");

    await createTestCaller(null, { refreshToken: cookie.value }).caller.auth.refreshSession();

    await expect(
      createTestCaller(null, { refreshToken: cookie.value }).caller.auth.refreshSession(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rotates exactly once under concurrent reuse of the same refresh token", async () => {
    const { reply } = await signupUser();
    const cookie = requireCookie(reply, "refreshToken");

    const results = await Promise.allSettled([
      createTestCaller(null, { refreshToken: cookie.value }).caller.auth.refreshSession(),
      createTestCaller(null, { refreshToken: cookie.value }).caller.auth.refreshSession(),
    ]);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<AuthResult> => result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects and clears the cookie when no refresh cookie is present", async () => {
    const { caller, reply } = createTestCaller(null, {});
    await expect(caller.auth.refreshSession()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(reply.clearedCookies.refreshToken).toBeDefined();
  });

  it("rejects a garbage/malformed refresh cookie value", async () => {
    const { caller } = createTestCaller(null, { refreshToken: "not-a-real-jwt" });
    await expect(caller.auth.refreshSession()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects an access token presented as the refresh cookie (type confusion)", async () => {
    const { result } = await signupUser();
    const { caller } = createTestCaller(null, { refreshToken: result.accessToken });
    await expect(caller.auth.refreshSession()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects a refresh token whose DB session has already expired, even though the JWT signature is still valid", async () => {
    const { reply } = await signupUser();
    const cookie = requireCookie(reply, "refreshToken");
    const decoded = jwt.verify(cookie.value, getSecret()) as RefreshPayload;

    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 day' WHERE id = $1", [
      decoded.sid,
    ]);

    const { caller } = createTestCaller(null, { refreshToken: cookie.value });
    await expect(caller.auth.refreshSession()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  describe("absolute session ceiling (SEC-T4)", () => {
    it("sets a new login's absolute_expires_at to its own 30-day expiry", async () => {
      const { reply } = await signupUser();
      const cookie = requireCookie(reply, "refreshToken");
      const decoded = jwt.verify(cookie.value, getSecret()) as RefreshPayload;

      const row = await pool.query<{ expires_at: Date; absolute_expires_at: Date }>(
        "SELECT expires_at, absolute_expires_at FROM sessions WHERE id = $1",
        [decoded.sid],
      );
      const session = row.rows[0];
      expect(session).toBeDefined();
      expect(new Date(session!.absolute_expires_at).getTime()).toBe(
        new Date(session!.expires_at).getTime(),
      );
    });

    it("caps a rotated session's expiry to the inherited ceiling instead of a fresh 30-day window", async () => {
      const { reply } = await signupUser();
      const cookie = requireCookie(reply, "refreshToken");
      const decoded = jwt.verify(cookie.value, getSecret()) as RefreshPayload;

      // Simulate a session nearing the end of its 30-day lineage: still
      // valid, but its ceiling is only an hour out — far short of a fresh
      // 30-day rolling window.
      const nearCeiling = new Date(Date.now() + 60 * 60 * 1000);
      await pool.query(
        "UPDATE sessions SET expires_at = $1, absolute_expires_at = $1 WHERE id = $2",
        [nearCeiling, decoded.sid],
      );

      const { caller, reply: refreshReply } = createTestCaller(null, {
        refreshToken: cookie.value,
      });
      await caller.auth.refreshSession();
      const newCookie = requireCookie(refreshReply, "refreshToken");
      const newDecoded = jwt.verify(newCookie.value, getSecret()) as RefreshPayload;

      const rotated = await pool.query<{ expires_at: Date }>(
        "SELECT expires_at FROM sessions WHERE id = $1",
        [newDecoded.sid],
      );
      const rotatedExpiresAt = rotated.rows[0];
      expect(rotatedExpiresAt).toBeDefined();

      const rotatedMs = new Date(rotatedExpiresAt!.expires_at).getTime();
      const uncappedThirtyDayMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
      // Must land at (approximately) the inherited ceiling, nowhere near a
      // fresh 30-day window.
      expect(Math.abs(rotatedMs - nearCeiling.getTime())).toBeLessThan(5_000);
      expect(rotatedMs).toBeLessThan(uncappedThirtyDayMs - 24 * 60 * 60 * 1000);
    });

    it("propagates the same absolute_expires_at ceiling unchanged across repeated rotations", async () => {
      const { reply } = await signupUser();
      const firstCookie = requireCookie(reply, "refreshToken");
      const firstDecoded = jwt.verify(firstCookie.value, getSecret()) as RefreshPayload;

      const original = await pool.query<{ absolute_expires_at: Date }>(
        "SELECT absolute_expires_at FROM sessions WHERE id = $1",
        [firstDecoded.sid],
      );
      const originalCeilingMs = new Date(original.rows[0]!.absolute_expires_at).getTime();

      const { caller: firstRefreshCaller, reply: firstRefreshReply } = createTestCaller(null, {
        refreshToken: firstCookie.value,
      });
      await firstRefreshCaller.auth.refreshSession();
      const secondCookie = requireCookie(firstRefreshReply, "refreshToken");
      const secondDecoded = jwt.verify(secondCookie.value, getSecret()) as RefreshPayload;

      // Capture session #2's ceiling now — rotating again below deletes it.
      const secondRow = await pool.query<{ absolute_expires_at: Date }>(
        "SELECT absolute_expires_at FROM sessions WHERE id = $1",
        [secondDecoded.sid],
      );

      const { caller: secondRefreshCaller, reply: secondRefreshReply } = createTestCaller(null, {
        refreshToken: secondCookie.value,
      });
      await secondRefreshCaller.auth.refreshSession();
      const thirdCookie = requireCookie(secondRefreshReply, "refreshToken");
      const thirdDecoded = jwt.verify(thirdCookie.value, getSecret()) as RefreshPayload;

      const thirdRow = await pool.query<{ absolute_expires_at: Date }>(
        "SELECT absolute_expires_at FROM sessions WHERE id = $1",
        [thirdDecoded.sid],
      );

      expect(new Date(secondRow.rows[0]!.absolute_expires_at).getTime()).toBe(originalCeilingMs);
      expect(new Date(thirdRow.rows[0]!.absolute_expires_at).getTime()).toBe(originalCeilingMs);
    });

    it("rejects refresh once the absolute ceiling has actually been reached", async () => {
      const { reply } = await signupUser();
      const cookie = requireCookie(reply, "refreshToken");
      const decoded = jwt.verify(cookie.value, getSecret()) as RefreshPayload;

      const pastCeiling = new Date(Date.now() - 60 * 1000);
      await pool.query(
        "UPDATE sessions SET expires_at = $1, absolute_expires_at = $1 WHERE id = $2",
        [pastCeiling, decoded.sid],
      );

      const { caller } = createTestCaller(null, { refreshToken: cookie.value });
      await expect(caller.auth.refreshSession()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("prunes other expired session rows as a side effect of a successful refresh", async () => {
      const { reply, result } = await signupUser();
      const cookie = requireCookie(reply, "refreshToken");

      const staleExpiry = new Date(Date.now() - 60 * 60 * 1000);
      const staleSession = await pool.query<{ id: string }>(
        `INSERT INTO sessions (user_id, remember_me, expires_at, absolute_expires_at)
         VALUES ($1, false, $2, $2) RETURNING id`,
        [result.user.id, staleExpiry],
      );
      const staleId = staleSession.rows[0]?.id;
      expect(staleId).toBeDefined();

      const { caller } = createTestCaller(null, { refreshToken: cookie.value });
      await caller.auth.refreshSession();

      const staleRow = await pool.query("SELECT id FROM sessions WHERE id = $1", [staleId]);
      expect(staleRow.rows).toHaveLength(0);
    });
  });
});

describe("authRouter.logout", () => {
  it("deletes the session row and clears the refresh cookie", async () => {
    const { reply } = await signupUser();
    const cookie = requireCookie(reply, "refreshToken");
    const decoded = jwt.verify(cookie.value, getSecret()) as RefreshPayload;

    const { caller, reply: logoutReply } = createTestCaller(null, {
      refreshToken: cookie.value,
    });
    const result = await caller.auth.logout();
    expect(result).toEqual({ success: true });
    expect(logoutReply.clearedCookies.refreshToken).toBeDefined();

    const sessionRow = await pool.query("SELECT id FROM sessions WHERE id = $1", [decoded.sid]);
    expect(sessionRow.rows).toHaveLength(0);
  });

  it("is idempotent when called with no refresh cookie present", async () => {
    const { caller, reply } = createTestCaller(null, {});
    const result = await caller.auth.logout();
    expect(result).toEqual({ success: true });
    expect(reply.clearedCookies.refreshToken).toBeDefined();
  });

  it("is idempotent when called with a garbage refresh cookie", async () => {
    const { caller, reply } = createTestCaller(null, { refreshToken: "garbage-value" });
    const result = await caller.auth.logout();
    expect(result).toEqual({ success: true });
    expect(reply.clearedCookies.refreshToken).toBeDefined();
  });

  it("actually invalidates the session: a logged-out refresh token can no longer refresh", async () => {
    const { reply } = await signupUser();
    const cookie = requireCookie(reply, "refreshToken");

    await createTestCaller(null, { refreshToken: cookie.value }).caller.auth.logout();

    await expect(
      createTestCaller(null, { refreshToken: cookie.value }).caller.auth.refreshSession(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
