import { describe, it, expect } from "vitest";
import { parseEnv } from "./env";

const STRONG_SECRET = "a".repeat(32);

function validEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: "postgresql://user:password@localhost:5432/specforge",
    JWT_SECRET: STRONG_SECRET,
    DEEPSEEK_API_KEY: "sk-test-key",
    NODE_ENV: "test",
    ...overrides,
  };
}

describe("parseEnv", () => {
  it("accepts a fully valid environment", () => {
    const env = parseEnv(validEnv());
    expect(env.DATABASE_URL).toBe("postgresql://user:password@localhost:5432/specforge");
    expect(env.JWT_SECRET).toBe(STRONG_SECRET);
    expect(env.DEEPSEEK_API_KEY).toBe("sk-test-key");
    expect(env.NODE_ENV).toBe("test");
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => parseEnv(validEnv({ DATABASE_URL: undefined }))).toThrow();
  });

  it("rejects an empty DATABASE_URL", () => {
    expect(() => parseEnv(validEnv({ DATABASE_URL: "" }))).toThrow();
  });

  it("rejects a JWT_SECRET shorter than 32 characters", () => {
    expect(() => parseEnv(validEnv({ JWT_SECRET: "a".repeat(31) }))).toThrow(
      /at least 32 characters/,
    );
  });

  it("accepts a JWT_SECRET exactly 32 characters long", () => {
    expect(() => parseEnv(validEnv({ JWT_SECRET: "a".repeat(32) }))).not.toThrow();
  });

  it.each(["change-me-in-production", "CHANGE-ME-IN-PRODUCTION", "secret", "changeme"])(
    "rejects the placeholder JWT_SECRET %j (from .env.example and common defaults)",
    (placeholder) => {
      expect(() => parseEnv(validEnv({ JWT_SECRET: placeholder }))).toThrow();
    },
  );

  it("rejects a placeholder value even when it is 32+ characters long, proving the placeholder check fires independently of the length check", () => {
    // "replace-this-with-a-real-secret-value" is 38 characters — long enough
    // to clear .min(32) on its own, so if this still throws, the rejection
    // can only be coming from the placeholder refine, not the length check.
    const longPlaceholder = "replace-this-with-a-real-secret-value";
    expect(longPlaceholder.length).toBeGreaterThanOrEqual(32);
    expect(() => parseEnv(validEnv({ JWT_SECRET: longPlaceholder }))).toThrow(/placeholder/);
  });

  it("rejects a missing DEEPSEEK_API_KEY", () => {
    expect(() => parseEnv(validEnv({ DEEPSEEK_API_KEY: undefined }))).toThrow();
  });

  it("rejects an empty DEEPSEEK_API_KEY", () => {
    expect(() => parseEnv(validEnv({ DEEPSEEK_API_KEY: "" }))).toThrow();
  });

  it("defaults NODE_ENV to development when unset", () => {
    const env = parseEnv(validEnv({ NODE_ENV: undefined }));
    expect(env.NODE_ENV).toBe("development");
  });

  it.each(["development", "test", "production"])("accepts NODE_ENV=%s", (value) => {
    expect(() => parseEnv(validEnv({ NODE_ENV: value }))).not.toThrow();
  });

  it("rejects an unrecognized NODE_ENV value", () => {
    expect(() => parseEnv(validEnv({ NODE_ENV: "staging" }))).toThrow();
  });

  it("lists every failing field in a single error rather than stopping at the first", () => {
    let caught: unknown;
    try {
      parseEnv({ DATABASE_URL: "", JWT_SECRET: "too-short", DEEPSEEK_API_KEY: "" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("JWT_SECRET");
    expect(message).toContain("DEEPSEEK_API_KEY");
  });
});
