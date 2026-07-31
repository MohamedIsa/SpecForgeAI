import bcrypt from "bcryptjs";
import { TRPCError } from "@trpc/server";
import type { CookieSerializeOptions } from "@fastify/cookie";
import { router, publicProcedure } from "../trpc";
import { pool } from "../db/pool";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  ACCESS_TOKEN_TTL_SECONDS,
} from "../lib/jwt";
import type { ReplyLike } from "../lib/http";
import { signupInput, loginInput } from "../validation";

const SALT_ROUNDS = 12;
const REFRESH_COOKIE_NAME = "refreshToken";
const REFRESH_COOKIE_PATH = "/";
const SESSION_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  password_hash: string;
}

interface SessionRow {
  id: string;
  user_id: string;
  remember_me: boolean;
  expires_at: Date;
}

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
}

export interface AuthResult {
  accessToken: string;
  expiresInSeconds: number;
  user: AuthUser;
}

export interface LogoutResult {
  success: true;
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

function refreshCookieOptions(rememberMe: boolean): CookieSerializeOptions {
  const base: CookieSerializeOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
  };
  // Omitting maxAge/expires produces a session cookie the browser discards on close.
  return rememberMe ? { ...base, maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS } : base;
}

function clearRefreshCookie(res: ReplyLike): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

async function createSession(userId: string, rememberMe: boolean): Promise<SessionRow> {
  const expiresAt = new Date(Date.now() + SESSION_VALIDITY_MS);
  const inserted = await pool.query<SessionRow>(
    `INSERT INTO sessions (user_id, remember_me, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, remember_me, expires_at`,
    [userId, rememberMe, expiresAt],
  );
  const row = inserted.rows[0];
  if (!row) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create session" });
  }
  return row;
}

function issueAuthResult(user: UserRow, session: SessionRow, res: ReplyLike): AuthResult {
  const accessToken = signAccessToken(user.id);
  const refreshToken = signRefreshToken(user.id, session.id);
  res.setCookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(session.remember_me));
  return {
    accessToken,
    expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
    user: toAuthUser(user),
  };
}

export const authRouter = router({
  signup: publicProcedure
    .input(signupInput)
    .mutation(async ({ ctx, input }): Promise<AuthResult> => {
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

      const session = await createSession(user.id, false);
      return issueAuthResult(user, session, ctx.res);
    }),

  login: publicProcedure
    .input(loginInput)
    .mutation(async ({ ctx, input }): Promise<AuthResult> => {
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

      const session = await createSession(user.id, input.rememberMe);
      return issueAuthResult(user, session, ctx.res);
    }),

  refreshSession: publicProcedure.mutation(async ({ ctx }): Promise<AuthResult> => {
    const claims = verifyRefreshToken(ctx.req.cookies[REFRESH_COOKIE_NAME]);
    if (!claims) {
      clearRefreshCookie(ctx.res);
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Session expired, please sign in again" });
    }

    // Atomic delete-and-return: under concurrent reuse of the same refresh
    // token, exactly one caller's DELETE matches a row; the other gets zero
    // rows back and is rejected, preventing duplicate session rotation.
    const deleted = await pool.query<SessionRow>(
      `DELETE FROM sessions WHERE id = $1 AND user_id = $2 AND expires_at > now()
       RETURNING id, user_id, remember_me, expires_at`,
      [claims.sessionId, claims.userId],
    );
    const oldSession = deleted.rows[0];
    if (!oldSession) {
      clearRefreshCookie(ctx.res);
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Session expired, please sign in again" });
    }

    const userResult = await pool.query<UserRow>(
      "SELECT id, full_name, email, password_hash FROM users WHERE id = $1",
      [oldSession.user_id],
    );
    const user = userResult.rows[0];
    if (!user) {
      clearRefreshCookie(ctx.res);
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Session expired, please sign in again" });
    }

    const newSession = await createSession(oldSession.user_id, oldSession.remember_me);
    return issueAuthResult(user, newSession, ctx.res);
  }),

  logout: publicProcedure.mutation(async ({ ctx }): Promise<LogoutResult> => {
    const claims = verifyRefreshToken(ctx.req.cookies[REFRESH_COOKIE_NAME]);
    if (claims) {
      await pool.query("DELETE FROM sessions WHERE id = $1", [claims.sessionId]);
    }
    clearRefreshCookie(ctx.res);
    return { success: true };
  }),
});
