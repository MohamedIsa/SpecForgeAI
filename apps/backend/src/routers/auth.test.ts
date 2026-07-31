import { describe, it, expect, afterEach } from "vitest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
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
