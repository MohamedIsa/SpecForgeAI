import { describe, it, expect, afterAll } from "vitest";

import { createPool, getPool, closePool } from "../db/pool";

describe("database pool", () => {
  afterAll(async () => {
    await closePool();
  });

  it("creates a pool when createPool is called", () => {
    const pool = createPool();
    expect(pool).toBeDefined();
  });

  it("returns the same pool instance on subsequent calls", () => {
    const pool = createPool();
    const pool2 = createPool();
    expect(pool).toBe(pool2);
  });

  it("throws when getPool is called before createPool", async () => {
    await closePool();
    expect(() => getPool()).toThrow(
      "Database pool not initialized. Call createPool() first.",
    );
  });

  it("has correct max connections from env", () => {
    const pool = createPool();
    expect(pool.options.max).toBeGreaterThan(0);
  });
});

describe("pool lifecycle", () => {
  it("closes pool and resets state", async () => {
    const pool = createPool();
    expect(pool).toBeDefined();

    await closePool();
    expect(pool.ended).toBe(true);
  });
});
