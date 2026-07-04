import { createPool, testConnection, closePool } from "./db/pool";
import { buildApp } from "./server";

async function main() {
  const server = await buildApp();

  try {
    server.log.info("Establishing database connection pool...");
    createPool();

    const connected = await testConnection();
    if (!connected) {
      server.log.error("Database connection test failed.");
      await closePool();
      process.exit(1);
    }

    server.log.info("Database connection established.");

    const port = parseInt(process.env["PORT"] ?? "3001", 10);
    await server.listen({ port, host: "0.0.0.0" });

    server.log.info(
      { routes: server.printRoutes() },
      "registered routes",
    );
  } catch (err) {
    server.log.error({ err }, "Server startup failed");
    await closePool();
    process.exit(1);
  }
}

void main();
