import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  fastifyTRPCPlugin,
  type FastifyTRPCPluginOptions,
} from "@trpc/server/adapters/fastify";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { registerBrdUploadRoute, BRD_UPLOAD_LIMITS } from "./routes/brd-upload";
import { registerDocsApiRoutes } from "./routes/docs-api";
import { appRouter } from "./router";
import type { AppRouter, Context } from "./router";
import { verifyBearerToken } from "./lib/jwt";

function createContext({ req, res }: CreateFastifyContextOptions): Context {
  const userId = verifyBearerToken(req.headers.authorization);
  return { req, res, userId };
}

/**
 * DEV-TEMP-T1: interactive Swagger/OpenAPI docs at /docs, meant to be torn
 * out later. Fails closed: an explicit ENABLE_SWAGGER=true or =false always
 * wins (normalized for stray case/whitespace); with nothing set, the surface
 * is opt-in everywhere except non-production NODE_ENV, so it's on by default
 * for local dev but a deployment that never heard of this variable does not
 * ship it — see .env.example.
 */
function isSwaggerEnabled(): boolean {
  const raw = process.env.ENABLE_SWAGGER?.trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return process.env.NODE_ENV !== "production";
}

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    maxParamLength: 5000,
    logger: true,
  });

  await fastify.register(cors, {
    origin: ["http://localhost:5173"],
    credentials: true,
  });

  await fastify.register(cookie);

  await fastify.register(multipart, { limits: BRD_UPLOAD_LIMITS });

  if (isSwaggerEnabled()) {
    // Dynamic mode: @fastify/swagger builds the document by scanning every
    // route's `schema` field as it is registered, so it must go on before
    // the routes below. This is deliberately the only OpenAPI-generation
    // path in the app — see routes/docs-api.ts for why the tRPC procedures
    // are wrapped in plain, schema-documented Fastify routes rather than
    // bridged automatically.
    await fastify.register(swagger, {
      openapi: {
        info: {
          title: "SpecForge AI API (temporary docs)",
          description:
            "DEV-TEMP-T1: interactive documentation covering the native BRD upload route " +
            "plus a representative subset of tRPC procedures exposed as REST under /api. " +
            "The full API surface remains available at /trpc regardless of what appears here.",
          version: "0.0.0-temp",
        },
        components: {
          securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer" },
          },
        },
      },
    });

    await fastify.register(swaggerUi, {
      routePrefix: "/docs",
    });
  }

  await registerBrdUploadRoute(fastify);

  if (isSwaggerEnabled()) {
    await registerDocsApiRoutes(fastify);
  }

  await fastify.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext,
    } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
  });

  return fastify;
}
