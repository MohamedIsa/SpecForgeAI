import { Pool, type PoolConfig } from "pg";

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL environment variable is not set. Provide a Postgres connection string.",
    );
  }
  return url;
}

const poolConfig: PoolConfig = {
  connectionString: getDatabaseUrl(),
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
};

export const pool = new Pool(poolConfig);

// pg requires an 'error' listener on the pool; otherwise an error on an idle
// client (e.g. the DB restarting) throws an unhandled error and crashes the process.
pool.on("error", (err: Error) => {
  console.error("Unexpected error on idle Postgres client", err);
});

export async function pingDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
