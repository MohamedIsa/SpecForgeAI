import { describe, it, expect, afterAll } from "vitest";
import { pool, pingDatabase, closePool } from "./pool";

describe("database connection pool", () => {
  afterAll(async () => {
    await closePool();
  });

  it("connects to Postgres and executes SELECT 1", async () => {
    const client = await pool.connect();
    try {
      const result = await client.query<{ ok: number }>("SELECT 1 AS ok");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.ok).toBe(1);
    } finally {
      client.release();
    }
  });

  it("pingDatabase resolves without throwing against a live connection", async () => {
    await expect(pingDatabase()).resolves.toBeUndefined();
  });

  it("reports the pgcrypto extension from the baseline migration as installed", async () => {
    const client = await pool.connect();
    try {
      const result = await client.query<{ extname: string }>(
        "SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'",
      );
      expect(result.rows).toHaveLength(1);
    } finally {
      client.release();
    }
  });
});
