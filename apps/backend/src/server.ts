import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import cors from "@fastify/cors";
import Fastify from "fastify";

import { createContext } from "./trpc/context";
import { appRouter } from "./trpc/router";
import { registerOpenAPI } from "./swagger";

export async function buildApp() {
  const server = Fastify({ logger: true });

  await server.register(cors, {
    origin: true,
  });

  await registerOpenAPI(server);

  await server.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: { router: appRouter, createContext },
  });

  return server;
}
