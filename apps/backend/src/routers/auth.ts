import bcrypt from "bcryptjs";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc";
import { pool } from "../db/pool";
import { signToken } from "../lib/jwt";
import { signupInput, loginInput } from "../validation";

const SALT_ROUNDS = 12;

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  password_hash: string;
}

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
}

export interface AuthResult {
  token: string;
  user: AuthUser;
}

function toAuthUser(row: UserRow): AuthUser {
  return { id: row.id, fullName: row.full_name, email: row.email };
}

const POSTGRES_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  );
}

export const authRouter = router({
  signup: publicProcedure.input(signupInput).mutation(async ({ input }): Promise<AuthResult> => {
    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

    let user: UserRow;
    try {
      const inserted = await pool.query<UserRow>(
        `INSERT INTO users (full_name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, full_name, email, password_hash`,
        [input.fullName, input.email, passwordHash],
      );
      const row = inserted.rows[0];
      if (!row) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create account",
        });
      }
      user = row;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with this email already exists",
        });
      }
      throw err;
    }

    return { token: signToken(user.id), user: toAuthUser(user) };
  }),

  login: publicProcedure.input(loginInput).mutation(async ({ input }): Promise<AuthResult> => {
    const result = await pool.query<UserRow>(
      "SELECT id, full_name, email, password_hash FROM users WHERE email = $1",
      [input.email],
    );
    const user = result.rows[0];
    if (!user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
    }

    const passwordMatches = await bcrypt.compare(input.password, user.password_hash);
    if (!passwordMatches) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
    }

    return { token: signToken(user.id), user: toAuthUser(user) };
  }),
});
