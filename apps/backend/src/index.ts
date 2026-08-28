import "./env";
import { buildApp } from "./app";
import { closePool } from "./db/pool";

const PORT = Number(process.env.PORT) || 3000;
/** Upper bound on graceful shutdown before forcing exit — a request that
 *  genuinely hangs must not block a rolling deploy/restart forever. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

const fastify = await buildApp();

// Node does not apply the default SIGTERM disposition (terminate) when
// running as PID 1 in a container unless something explicitly listens for
// it — without this, `docker stop` / `podman stop` (and therefore any
// rolling-restart deploy) has to wait out its full timeout and fall back to
// SIGKILL on every single restart, verified directly against this exact
// image before adding this handler.
let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  fastify.log.info(`Received ${signal}, shutting down gracefully`);

  const forceExit = setTimeout(() => {
    fastify.log.error("Graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    await fastify.close();
    await closePool();
    process.exit(0);
  } catch (err) {
    fastify.log.error(err, "Error during graceful shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await fastify.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Backend listening on http://localhost:${PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
