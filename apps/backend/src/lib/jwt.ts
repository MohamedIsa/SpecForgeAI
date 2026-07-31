import jwt from "jsonwebtoken";

const TOKEN_EXPIRY = "30d";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set");
  }
  return secret;
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, getJwtSecret(), { expiresIn: TOKEN_EXPIRY });
}

function isPayloadWithSub(payload: unknown): payload is { sub: string } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "sub" in payload &&
    typeof (payload as { sub: unknown }).sub === "string"
  );
}

/**
 * Returns the authenticated userId, or null for a missing/malformed header,
 * an invalid signature, or an expired token — all treated as "not authenticated"
 * rather than surfaced as distinct errors, so tRPC context creation never throws.
 */
export function verifyBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  try {
    const payload: unknown = jwt.verify(token, getJwtSecret());
    return isPayloadWithSub(payload) ? payload.sub : null;
  } catch {
    return null;
  }
}
