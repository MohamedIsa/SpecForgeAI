import { describe, it, expect, afterEach } from "vitest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { appRouter } from "../router";
import type { Context } from "../router";
import { pool } from "../db/pool";
import type { AuthResult } from "./auth";

function createCaller() {
  const ctx: Context = { req: {} as object, res: {} as object, userId: null };
  return appRouter.createCaller(ctx);
}

function uniqueEmail(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

const createdUserIds: string[] = [];

afterEach(async () => {
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop();
    await pool.query("DELETE FROM users WHERE id = $1", [id]);
  }
});

describe("authRouter.signup", () => {
  it("creates a user with a bcrypt hash (12 rounds) and returns a valid JWT", async () => {
    const caller = createCaller();
    const email = uniqueEmail();

    const result = await caller.auth.signup({
      fullName: "Ada Lovelace",
      email,
      password: "correct-horse-battery",
    });
    createdUserIds.push(result.user.id);

    expect(result.user.email).toBe(email);
    expect(result.user.fullName).toBe("Ada Lovelace");

    const row = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = $1",
      [result.user.id],
    );
    const passwordHash = row.rows[0]?.password_hash;
    expect(passwordHash).toBeDefined();
    if (!passwordHash) throw new Error("expected password hash to exist");
    expect(bcrypt.getRounds(passwordHash)).toBe(12);
    expect(await bcrypt.compare("correct-horse-battery", passwordHash)).toBe(true);

    const decoded = jwt.verify(result.token, process.env.JWT_SECRET ?? "");
    expect(typeof decoded).toBe("object");
    expect((decoded as { sub: string }).sub).toBe(result.user.id);
  });

  it("rejects a duplicate email with CONFLICT", async () => {
    const caller = createCaller();
    const email = uniqueEmail();

    const first = await caller.auth.signup({
      fullName: "Grace Hopper",
      email,
      password: "another-password",
    });
    createdUserIds.push(first.user.id);

    await expect(
      caller.auth.signup({
        fullName: "Grace Hopper Duplicate",
        email,
        password: "yet-another-password",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects a concurrent duplicate signup with CONFLICT, not a raw DB error", async () => {
    const email = uniqueEmail();

    const results = await Promise.allSettled([
      createCaller().auth.signup({
        fullName: "Concurrent One",
        email,
        password: "concurrent-password-1",
      }),
      createCaller().auth.signup({
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
    const caller = createCaller();
    await expect(
      caller.auth.signup({
        fullName: "Invalid Email",
        email: "not-an-email",
        password: "valid-password",
      }),
    ).rejects.toThrow();
  });

  it("rejects a password shorter than 8 characters via Zod validation", async () => {
    const caller = createCaller();
    await expect(
      caller.auth.signup({
        fullName: "Short Password",
        email: uniqueEmail(),
        password: "short",
      }),
    ).rejects.toThrow();
  });
});

describe("authRouter.login", () => {
  it("authenticates with correct credentials and issues a JWT", async () => {
    const caller = createCaller();
    const email = uniqueEmail();

    const signupResult = await caller.auth.signup({
      fullName: "Margaret Hamilton",
      email,
      password: "apollo-guidance",
    });
    createdUserIds.push(signupResult.user.id);

    const loginResult = await caller.auth.login({ email, password: "apollo-guidance" });
    expect(loginResult.user.id).toBe(signupResult.user.id);

    const decoded = jwt.verify(loginResult.token, process.env.JWT_SECRET ?? "");
    expect((decoded as { sub: string }).sub).toBe(signupResult.user.id);
  });

  it("rejects an incorrect password with UNAUTHORIZED", async () => {
    const caller = createCaller();
    const email = uniqueEmail();

    const signupResult = await caller.auth.signup({
      fullName: "Katherine Johnson",
      email,
      password: "correct-password",
    });
    createdUserIds.push(signupResult.user.id);

    await expect(
      caller.auth.login({ email, password: "wrong-password" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects a non-existent email with UNAUTHORIZED", async () => {
    const caller = createCaller();
    await expect(
      caller.auth.login({ email: uniqueEmail(), password: "whatever-password" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
