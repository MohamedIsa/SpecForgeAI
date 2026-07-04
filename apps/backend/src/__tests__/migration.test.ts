import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { join } from "path";
import { randomUUID } from "crypto";

const TEST_DB_NAME = process.env["TEST_DB_NAME"] ?? "specforge_test";
const DB_HOST = process.env["DB_HOST"] ?? "localhost";
const DB_PORT = parseInt(process.env["DB_PORT"] ?? "5432", 10);
const DB_USER = process.env["DB_USER"] ?? "postgres";
const DB_PASSWORD = process.env["DB_PASSWORD"] ?? "postgres";

let pool: Pool;

async function canConnect(): Promise<boolean> {
  const probe = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: "postgres",
    connectionTimeoutMillis: 2000,
  });

  try {
    await probe.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

async function ensureTestDatabase(): Promise<void> {
  const admin = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: "postgres",
  });

  try {
    const result = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [TEST_DB_NAME],
    );

    if (result.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
    }
  } finally {
    await admin.end();
  }
}

async function dropTestDatabase(): Promise<void> {
  const admin = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: "postgres",
  });

  try {
    await admin.query(
      `DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`,
    );
  } finally {
    await admin.end();
  }
}

async function runMigration(): Promise<void> {
  // @ts-expect-error -- ESM-only package, resolves at runtime via dynamic import
  const pkg = (await import("node-pg-migrate")) as {
    default: (opts: Record<string, unknown>) => Promise<unknown>;
  };
  const migrate = pkg.default;
  const client = await pool.connect();

  try {
    await migrate({
      dbClient: client,
      direction: "up",
      dir: join(__dirname, "..", "..", "migrations"),
      migrationsTable: "pgmigrations",
      count: Infinity,
    });
  } finally {
    client.release();
  }
}

describe("database migration", () => {
  beforeAll(async () => {
    const connected = await canConnect();

    if (!connected) {
      console.log("Skipping DB integration tests: PostgreSQL not available.");
      return;
    }

    await dropTestDatabase();
    await ensureTestDatabase();

    pool = new Pool({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: TEST_DB_NAME,
    });

    await runMigration();
  }, 30000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
      await dropTestDatabase().catch(() => {});
    }
  });

  it("creates epics table with expected columns", async () => {
    if (!pool) return;

    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'epics'
      ORDER BY ordinal_position
    `);

    const columns = result.rows.map((r: { column_name: string }) => r.column_name);
    expect(columns).toContain("id");
    expect(columns).toContain("title");
    expect(columns).toContain("description");
    expect(columns).toContain("created_at");
  });

  it("creates tickets table with check constraints", async () => {
    if (!pool) return;

    const result = await pool.query(`
      SELECT conname, consrc
      FROM pg_constraint
      WHERE conrelid = 'tickets'::regclass AND contype = 'c'
    `);

    const checks = result.rows.map(
      (r: { conname: string }) => r.conname,
    );
    expect(checks).toContain("tickets_type_check");
    expect(checks).toContain("tickets_priority_check");
    expect(checks).toContain("tickets_story_points_check");
    expect(checks).toContain("tickets_status_check");
  });

  it("creates brd_uploads table with check constraint", async () => {
    if (!pool) return;

    const result = await pool.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'brd_uploads'::regclass AND contype = 'c'
    `);

    const checks = result.rows.map(
      (r: { conname: string }) => r.conname,
    );
    expect(checks).toContain("brd_uploads_status_check");
  });

  it("creates tech_stacks table with unique name", async () => {
    if (!pool) return;

    const result = await pool.query(`
      SELECT conname, contype
      FROM pg_constraint
      WHERE conrelid = 'tech_stacks'::regclass AND contype = 'u'
    `);

    const constraints = result.rows.map(
      (r: { conname: string }) => r.conname,
    );
    expect(constraints.length).toBeGreaterThan(0);
  });

  it("has foreign key from tickets to epics", async () => {
    if (!pool) return;

    const result = await pool.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'tickets'::regclass AND contype = 'f'
    `);

    const fks = result.rows.map(
      (r: { conname: string }) => r.conname,
    );
    expect(fks.length).toBeGreaterThan(0);
  });

  it("has indexes on tickets", async () => {
    if (!pool) return;

    const result = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'tickets'
    `);

    const indexes = result.rows.map(
      (r: { indexname: string }) => r.indexname,
    );
    expect(indexes.some((i) => i.includes("epic_id"))).toBe(true);
    expect(indexes.some((i) => i.includes("status"))).toBe(true);
    expect(indexes.some((i) => i.includes("type"))).toBe(true);
  });
});

describe("constraint enforcement", () => {
  beforeAll(async () => {
    if (!pool) return;
  });

  it("inserts a valid epic and ticket successfully", async () => {
    if (!pool) return;

    const epicId = randomUUID().slice(0, 16);
    await pool.query("INSERT INTO epics (id, title) VALUES ($1, $2)", [
      epicId,
      "Test Epic",
    ]);

    const ticketId = randomUUID().slice(0, 16);
    await pool.query(
      `INSERT INTO tickets (id, epic_id, title, type, priority, story_points, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [ticketId, epicId, "Test Ticket", "feature", "P1", 3, "backlog"],
    );

    const result = await pool.query("SELECT * FROM tickets WHERE id = $1", [
      ticketId,
    ]);
    expect(result.rows).toHaveLength(1);
  });

  it("rejects invalid ticket type via check constraint", async () => {
    if (!pool) return;

    const epicId = randomUUID().slice(0, 16);
    await pool.query("INSERT INTO epics (id, title) VALUES ($1, $2)", [
      epicId,
      "Reject Epic",
    ]);

    const ticketId = randomUUID().slice(0, 16);
    await expect(
      pool.query(
        `INSERT INTO tickets (id, epic_id, title, type, priority, story_points, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [ticketId, epicId, "Bad Ticket", "invalid_type", "P1", 3, "backlog"],
      ),
    ).rejects.toThrow(/tickets_type_check/);
  });

  it("rejects invalid story_points via check constraint", async () => {
    if (!pool) return;

    const epicId = randomUUID().slice(0, 16);
    await pool.query("INSERT INTO epics (id, title) VALUES ($1, $2)", [
      epicId,
      "Points Epic",
    ]);

    const ticketId = randomUUID().slice(0, 16);
    await expect(
      pool.query(
        `INSERT INTO tickets (id, epic_id, title, type, priority, story_points, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [ticketId, epicId, "Bad Points", "feature", "P1", 13, "backlog"],
      ),
    ).rejects.toThrow(/tickets_story_points_check/);
  });

  it("rejects invalid status via check constraint", async () => {
    if (!pool) return;

    const epicId = randomUUID().slice(0, 16);
    await pool.query("INSERT INTO epics (id, title) VALUES ($1, $2)", [
      epicId,
      "Status Epic",
    ]);

    const ticketId = randomUUID().slice(0, 16);
    await expect(
      pool.query(
        `INSERT INTO tickets (id, epic_id, title, type, priority, story_points, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [ticketId, epicId, "Bad Status", "feature", "P1", 3, "archived"],
      ),
    ).rejects.toThrow(/tickets_status_check/);
  });

  it("rejects ticket referencing nonexistent epic via FK", async () => {
    if (!pool) return;

    const ticketId = randomUUID().slice(0, 16);
    await expect(
      pool.query(
        `INSERT INTO tickets (id, epic_id, title, type, priority, story_points, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ticketId,
          "nonexistent-epic",
          "Orphan Ticket",
          "feature",
          "P1",
          3,
          "backlog",
        ],
      ),
    ).rejects.toThrow(/violates foreign key|tickets_epic_id_fkey/);
  });
});
