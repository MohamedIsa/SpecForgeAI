import { buildApp } from "./app";

const PORT = Number(process.env.PORT) || 3000;

const fastify = await buildApp();

try {
  await fastify.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Backend listening on http://localhost:${PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
