import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import {
  signAccessToken,
  signRefreshToken,
  verifyBearerToken,
  verifyRefreshToken,
  ACCESS_TOKEN_TTL_SECONDS,
} from "./jwt";

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set for this test run");
  return secret;
}

describe("ACCESS_TOKEN_TTL_SECONDS", () => {
  it("is 15 minutes", () => {
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(15 * 60);
  });
});

describe("signAccessToken / verifyBearerToken", () => {
  it("round-trips a userId through a signed Bearer access token", () => {
    const token = signAccessToken("user-123");
    expect(verifyBearerToken(`Bearer ${token}`)).toBe("user-123");
  });

  it("issues an access token that expires in 15 minutes", () => {
    const token = signAccessToken("user-123");
    const decoded = jwt.decode(token) as { iat: number; exp: number };
    expect(decoded.exp - decoded.iat).toBe(ACCESS_TOKEN_TTL_SECONDS);
  });

  it("returns null for a missing Authorization header", () => {
    expect(verifyBearerToken(undefined)).toBeNull();
  });

  it("returns null for a header without the Bearer scheme", () => {
    const token = signAccessToken("user-123");
    expect(verifyBearerToken(token)).toBeNull();
    expect(verifyBearerToken(`Basic ${token}`)).toBeNull();
  });

  it("returns null for a malformed token", () => {
    expect(verifyBearerToken("Bearer not-a-real-jwt")).toBeNull();
  });

  it("returns null for a token signed with a different secret", () => {
    const forgedToken = jwt.sign({ sub: "user-123", type: "access" }, "wrong-secret", {
      expiresIn: "15m",
    });
    expect(verifyBearerToken(`Bearer ${forgedToken}`)).toBeNull();
  });

  it("returns null for an expired access token instead of throwing", () => {
    const expiredToken = jwt.sign({ sub: "user-123", type: "access" }, getSecret(), {
      expiresIn: -10,
    });
    expect(verifyBearerToken(`Bearer ${expiredToken}`)).toBeNull();
  });

  it("returns null for a valid token whose payload lacks a sub claim", () => {
    const noSubToken = jwt.sign({ type: "access" }, getSecret(), { expiresIn: "15m" });
    expect(verifyBearerToken(`Bearer ${noSubToken}`)).toBeNull();
  });

  it("returns null for a refresh token presented as a bearer access token (type confusion)", () => {
    const refreshToken = signRefreshToken("user-123", "session-abc");
    expect(verifyBearerToken(`Bearer ${refreshToken}`)).toBeNull();
  });
});

describe("signRefreshToken / verifyRefreshToken", () => {
  it("round-trips a userId and sessionId through a signed refresh token", () => {
    const token = signRefreshToken("user-123", "session-abc");
    expect(verifyRefreshToken(token)).toEqual({ userId: "user-123", sessionId: "session-abc" });
  });

  it("issues a refresh token that expires in 30 days", () => {
    const token = signRefreshToken("user-123", "session-abc");
    const decoded = jwt.decode(token) as { iat: number; exp: number };
    expect(decoded.exp - decoded.iat).toBe(30 * 24 * 60 * 60);
  });

  it("returns null for an undefined token", () => {
    expect(verifyRefreshToken(undefined)).toBeNull();
  });

  it("returns null for a malformed token", () => {
    expect(verifyRefreshToken("not-a-real-jwt")).toBeNull();
  });

  it("returns null for a token signed with a different secret", () => {
    const forgedToken = jwt.sign(
      { sub: "user-123", sid: "session-abc", type: "refresh" },
      "wrong-secret",
      { expiresIn: "30d" },
    );
    expect(verifyRefreshToken(forgedToken)).toBeNull();
  });

  it("returns null for an expired refresh token instead of throwing", () => {
    const expiredToken = jwt.sign(
      { sub: "user-123", sid: "session-abc", type: "refresh" },
      getSecret(),
      { expiresIn: -10 },
    );
    expect(verifyRefreshToken(expiredToken)).toBeNull();
  });

  it("returns null for a valid token whose payload lacks a sid claim", () => {
    const noSidToken = jwt.sign({ sub: "user-123", type: "refresh" }, getSecret(), {
      expiresIn: "30d",
    });
    expect(verifyRefreshToken(noSidToken)).toBeNull();
  });

  it("returns null for an access token presented as a refresh token (type confusion)", () => {
    const accessToken = signAccessToken("user-123");
    expect(verifyRefreshToken(accessToken)).toBeNull();
  });
});

describe("algorithm pinning (SEC-T2)", () => {
  it("signs access tokens with HS256", () => {
    const token = signAccessToken("user-123");
    const decoded = jwt.decode(token, { complete: true });
    expect(decoded?.header.alg).toBe("HS256");
  });

  it("signs refresh tokens with HS256", () => {
    const token = signRefreshToken("user-123", "session-abc");
    const decoded = jwt.decode(token, { complete: true });
    expect(decoded?.header.alg).toBe("HS256");
  });

  it("rejects an access-shaped token signed with the right secret but a different algorithm", () => {
    // Same secret, same payload shape — only the algorithm differs. If
    // verifyBearerToken didn't pin `algorithms: ["HS256"]`, this would verify.
    const hs384Token = jwt.sign({ sub: "user-123", type: "access" }, getSecret(), {
      expiresIn: "15m",
      algorithm: "HS384",
    });
    expect(verifyBearerToken(`Bearer ${hs384Token}`)).toBeNull();
  });

  it("rejects a refresh-shaped token signed with the right secret but a different algorithm", () => {
    const hs512Token = jwt.sign(
      { sub: "user-123", sid: "session-abc", type: "refresh" },
      getSecret(),
      { expiresIn: "30d", algorithm: "HS512" },
    );
    expect(verifyRefreshToken(hs512Token)).toBeNull();
  });

  it("rejects a classic alg:none forged token (no signature at all)", () => {
    // Hand-crafted rather than produced via jwt.sign, since jsonwebtoken's
    // signer refuses "none" without an explicit opt-in — this is exactly
    // what an attacker who noticed an unpinned `algorithms` option would send.
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: "user-123", type: "access", exp: Math.floor(Date.now() / 1000) + 900 }),
    ).toString("base64url");
    const forgedToken = `${header}.${payload}.`;

    expect(verifyBearerToken(`Bearer ${forgedToken}`)).toBeNull();
  });
});
