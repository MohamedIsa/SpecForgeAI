import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { signToken, verifyBearerToken } from "./jwt";

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set for this test run");
  return secret;
}

describe("signToken / verifyBearerToken", () => {
  it("round-trips a userId through a signed Bearer token", () => {
    const token = signToken("user-123");
    expect(verifyBearerToken(`Bearer ${token}`)).toBe("user-123");
  });

  it("returns null for a missing Authorization header", () => {
    expect(verifyBearerToken(undefined)).toBeNull();
  });

  it("returns null for a header without the Bearer scheme", () => {
    const token = signToken("user-123");
    expect(verifyBearerToken(token)).toBeNull();
    expect(verifyBearerToken(`Basic ${token}`)).toBeNull();
  });

  it("returns null for a malformed token", () => {
    expect(verifyBearerToken("Bearer not-a-real-jwt")).toBeNull();
  });

  it("returns null for a token signed with a different secret", () => {
    const forgedToken = jwt.sign({ sub: "user-123" }, "wrong-secret", { expiresIn: "30d" });
    expect(verifyBearerToken(`Bearer ${forgedToken}`)).toBeNull();
  });

  it("returns null for an expired token instead of throwing", () => {
    const expiredToken = jwt.sign({ sub: "user-123" }, getSecret(), { expiresIn: -10 });
    expect(verifyBearerToken(`Bearer ${expiredToken}`)).toBeNull();
  });

  it("returns null for a valid token whose payload lacks a sub claim", () => {
    const noSubToken = jwt.sign({ role: "owner" }, getSecret(), { expiresIn: "30d" });
    expect(verifyBearerToken(`Bearer ${noSubToken}`)).toBeNull();
  });
});
