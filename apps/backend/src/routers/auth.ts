import bcrypt from "bcryptjs";
import { TRPCError } from "@trpc/server";
import type { CookieSerializeOptions } from "@fastify/cookie";
import { router, publicProcedure, authProcedure } from "../trpc";
import { pool } from "../db/pool";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  ACCESS_TOKEN_TTL_SECONDS,
} from "../lib/jwt";
import type { ReplyLike, RequestLike } from "../lib/http";
import { signupInput, loginInput } from "../validation";

const SALT_ROUNDS = 12;
const REFRESH_COOKIE_NAME = "refreshToken";
const REFRESH_COOKIE_PATH = "/";
const SESSION_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * A bcrypt.compare call is the expensive step in login — if it only ever
 * runs for emails that exist, an attacker can time responses to enumerate
 * accounts. Comparing against this precomputed hash for a missing user
 * keeps the two paths' cost roughly equal. The password is a fixed,
 * meaningless constant: nothing is ever meant to match it.
 */
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing-parity", SALT_ROUNDS);

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
  absolute_expires_at: Date;
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

/**
 * `secure` is scheme-aware (SEC-T6) rather than a flat NODE_ENV check: this
 * app sits behind nginx terminating (or not terminating) TLS, so the only
 * way to know whether the ORIGINAL client connection was HTTPS is the
 * X-Forwarded-Proto header nginx sets — checking `req.protocol` here would
 * just see the plain-HTTP hop from nginx to the backend container.
 * X-Forwarded-Proto is safe to trust here for the same reason `req.ip` is
 * (see trustProxy in app.ts): the backend has no host-published port, so
 * nginx is the only possible path in, and it always sets this header itself
 * — meaning on the current HTTP-only staging deployment it is always
 * *present* as "http", never absent. That distinction matters: falling back
 * to the NODE_ENV check on anything other than an exact "https" match (e.g.
 * via `||`) would mark the cookie Secure even on that plain-HTTP box, and
 * browsers silently refuse to send a Secure cookie over HTTP — breaking
 * session refresh with no visible error. The NODE_ENV fallback below fires
 * only when the header is genuinely undefined (e.g. a direct, non-proxied
 * request in tests), unless ALLOW_INSECURE_COOKIES explicitly opts out — an
 * escape hatch for deliberately testing the production build without TLS.
 */
function refreshCookieOptions(rememberMe: boolean, req: RequestLike): CookieSerializeOptions {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const secure =
    forwardedProto === undefined
      ? process.env.NODE_ENV === "production" && !process.env.ALLOW_INSECURE_COOKIES
      : forwardedProto === "https";
  const base: CookieSerializeOptions = {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
  };
  // Omitting maxAge/expires produces a session cookie the browser discards on close.
  return rememberMe ? { ...base, maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS } : base;
}

function clearRefreshCookie(res: ReplyLike): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

/**
 * `absoluteExpiresAt` is the hard ceiling on this session's lineage: omitted
 * for a brand-new login (defaults to the normal 30d window, so the first
 * session's ceiling equals its own expiry), but on rotation the caller must
 * pass the ORIGINAL session's ceiling through unchanged — never recomputed —
 * so a refresh token can keep a session alive indefinitely in 30-day rolling
 * windows, but never past 30 days from the actual login.
 */
async function createSession(
  userId: string,
  rememberMe: boolean,
  absoluteExpiresAt: Date = new Date(Date.now() + SESSION_VALIDITY_MS),
): Promise<SessionRow> {
  const rollingExpiresAt = new Date(Date.now() + SESSION_VALIDITY_MS);
  const expiresAt = rollingExpiresAt < absoluteExpiresAt ? rollingExpiresAt : absoluteExpiresAt;
  const inserted = await pool.query<SessionRow>(
    `INSERT INTO sessions (user_id, remember_me, expires_at, absolute_expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, remember_me, expires_at, absolute_expires_at`,
    [userId, rememberMe, expiresAt, absoluteExpiresAt],
  );
  const row = inserted.rows[0];
  if (!row) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create session" });
  }
  return row;
}

/** Opportunistic cleanup so the sessions table doesn't grow unbounded with
 *  dead rows — runs on the natural traffic that already touches sessions
 *  (refresh) rather than needing a separate cron job. */
async function pruneExpiredSessions(): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE expires_at <= now()");
}

function issueAuthResult(
  user: UserRow,
  session: SessionRow,
  res: ReplyLike,
  req: RequestLike,
): AuthResult {
  const accessToken = signAccessToken(user.id);
  const refreshToken = signRefreshToken(user.id, session.id);
  res.setCookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(session.remember_me, req));
  return {
    accessToken,
    expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
    user: toAuthUser(user),
  };
}

export const authRouter = router({
  signup: authProcedure
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
      return issueAuthResult(user, session, ctx.res, ctx.req);
    }),

  login: authProcedure
    .input(loginInput)
    .mutation(async ({ ctx, input }): Promise<AuthResult> => {
      const result = await pool.query<UserRow>(
        "SELECT id, full_name, email, password_hash FROM users WHERE email = $1",
        [input.email],
      );
      const user = result.rows[0];
      if (!user) {
        // Burn the same bcrypt.compare cost a real attempt would pay, so
        // response timing can't be used to tell "wrong password" apart from
        // "no such account".
        await bcrypt.compare(input.password, DUMMY_HASH);
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
      }

      const passwordMatches = await bcrypt.compare(input.password, user.password_hash);
      if (!passwordMatches) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
      }

      const session = await createSession(user.id, input.rememberMe);
      return issueAuthResult(user, session, ctx.res, ctx.req);
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
    // expires_at is always <= absolute_expires_at by construction (see
    // createSession), so this same check already enforces the absolute
    // ceiling — no separate comparison needed here.
    const deleted = await pool.query<SessionRow>(
      `DELETE FROM sessions WHERE id = $1 AND user_id = $2 AND expires_at > now()
       RETURNING id, user_id, remember_me, expires_at, absolute_expires_at`,
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

    const newSession = await createSession(
      oldSession.user_id,
      oldSession.remember_me,
      oldSession.absolute_expires_at,
    );
    await pruneExpiredSessions();
    return issueAuthResult(user, newSession, ctx.res, ctx.req);
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
