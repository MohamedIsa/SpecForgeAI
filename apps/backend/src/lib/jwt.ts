import jwt from "jsonwebtoken";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "30d";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set");
  }
  return secret;
}

interface AccessTokenPayload {
  sub: string;
  type: "access";
}

interface RefreshTokenPayload {
  sub: string;
  sid: string;
  type: "refresh";
}

export function signAccessToken(userId: string): string {
  const payload: AccessTokenPayload = { sub: userId, type: "access" };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function signRefreshToken(userId: string, sessionId: string): string {
  const payload: RefreshTokenPayload = { sub: userId, sid: sessionId, type: "refresh" };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: REFRESH_TOKEN_EXPIRY });
}

function isAccessTokenPayload(payload: unknown): payload is AccessTokenPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { type?: unknown }).type === "access" &&
    typeof (payload as { sub?: unknown }).sub === "string"
  );
}

function isRefreshTokenPayload(payload: unknown): payload is RefreshTokenPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { type?: unknown }).type === "refresh" &&
    typeof (payload as { sub?: unknown }).sub === "string" &&
    typeof (payload as { sid?: unknown }).sid === "string"
  );
}

/**
 * Returns the authenticated userId, or null for a missing/malformed header,
 * an invalid signature, an expired token, or a refresh token presented as a
 * bearer credential (type confusion) — all treated as "not authenticated"
 * rather than surfaced as distinct errors, so tRPC context creation never throws.
 */
export function verifyBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  try {
    const payload: unknown = jwt.verify(token, getJwtSecret());
    return isAccessTokenPayload(payload) ? payload.sub : null;
  } catch {
    return null;
  }
}

export interface RefreshTokenClaims {
  userId: string;
  sessionId: string;
}

/**
 * Verifies a refresh-cookie token, returning the embedded userId/sessionId, or
 * null for a missing/malformed/expired token or an access token presented
 * where a refresh token was expected (type confusion).
 */
export function verifyRefreshToken(token: string | undefined): RefreshTokenClaims | null {
  if (!token) return null;
  try {
    const payload: unknown = jwt.verify(token, getJwtSecret());
    return isRefreshTokenPayload(payload)
      ? { userId: payload.sub, sessionId: payload.sid }
      : null;
  } catch {
    return null;
  }
}
