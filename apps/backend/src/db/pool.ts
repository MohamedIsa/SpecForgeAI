import { Pool, type PoolConfig } from "pg";

function getPoolConfig(): PoolConfig {
  const connectionString = process.env["DATABASE_URL"];

  if (connectionString != null && connectionString !== "") {
    return {
      connectionString,
      max: parseInt(process.env["DB_POOL_MAX"] ?? "10", 10),
      idleTimeoutMillis: parseInt(
        process.env["DB_POOL_IDLE_TIMEOUT"] ?? "30000",
        10,
      ),
      connectionTimeoutMillis: parseInt(
        process.env["DB_CONNECTION_TIMEOUT"] ?? "5000",
        10,
      ),
    };
  }

  return {
    host: process.env["DB_HOST"] ?? "localhost",
    port: parseInt(process.env["DB_PORT"] ?? "5432", 10),
    database: process.env["DB_NAME"] ?? "specforge",
    user: process.env["DB_USER"] ?? "postgres",
    password: process.env["DB_PASSWORD"] ?? "postgres",
    max: parseInt(process.env["DB_POOL_MAX"] ?? "10", 10),
    idleTimeoutMillis: parseInt(
      process.env["DB_POOL_IDLE_TIMEOUT"] ?? "30000",
      10,
    ),
    connectionTimeoutMillis: parseInt(
      process.env["DB_CONNECTION_TIMEOUT"] ?? "5000",
      10,
    ),
  };
}

let pool: Pool | null = null;

export function createPool(): Pool {
  if (pool !== null) {
    return pool;
  }

  pool = new Pool(getPoolConfig());

  pool.on("error", (err) => {
    console.error("Unexpected database pool error:", err);
  });

  return pool;
}

export function getPool(): Pool {
  if (pool === null) {
    throw new Error(
      "Database pool not initialized. Call createPool() first.",
    );
  }

  return pool;
}

export async function testConnection(): Promise<boolean> {
  const client = await getPool().connect();

  try {
    await client.query("SELECT 1");
    return true;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool !== null) {
    await pool.end();
    pool = null;
  }
}
