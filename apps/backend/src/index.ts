import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  fastifyTRPCPlugin,
  type FastifyTRPCPluginOptions,
} from "@trpc/server/adapters/fastify";
import { appRouter } from "./router";
import type { AppRouter, Context } from "./router";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";

function createContext({ req, res }: CreateFastifyContextOptions): Context {
  return { req, res };
}

const PORT = Number(process.env.PORT) || 3001;

const fastify = Fastify({
  maxParamLength: 5000,
  logger: true,
});

await fastify.register(cors, {
  origin: ["http://localhost:5173", "http://localhost:3000"],
  credentials: true,
});

await fastify.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: {
    router: appRouter,
    createContext,
  } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
});

try {
  await fastify.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Backend listening on http://localhost:${PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
