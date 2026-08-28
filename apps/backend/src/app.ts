import "./env";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  fastifyTRPCPlugin,
  type FastifyTRPCPluginOptions,
  type CreateFastifyContextOptions,
} from "@trpc/server/adapters/fastify";
import { registerBrdUploadRoute, BRD_UPLOAD_LIMITS } from "./routes/brd-upload";
import { registerDocsApiRoutes } from "./routes/docs-api";
import { appRouter, type AppRouter, type Context } from "./router";
import { verifyBearerToken } from "./lib/jwt";

function createContext({ req, res }: CreateFastifyContextOptions): Context {
  const userId = verifyBearerToken(req.headers.authorization);
  return { req, res, userId };
}

/**
 * DEV-TEMP-T1: interactive Swagger/OpenAPI docs at /docs, meant to be torn
 * out later. Strictly opt-in everywhere, including local dev — the previous
 * "on by default outside production" fallback meant a deployment that never
 * heard of this variable but also never set NODE_ENV=production shipped the
 * docs surface unintentionally. Now nothing short of an exact "true" (after
 * trimming stray whitespace and normalizing case) turns it on — see
 * .env.example.
 */
function isSwaggerEnabled(): boolean {
  return process.env.ENABLE_SWAGGER?.trim().toLowerCase() === "true";
}

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    maxParamLength: 5000,
    logger: true,
    // Behind nginx (docker-compose.staging.yml's "web" service), request.ip
    // would otherwise be nginx's own container IP for every single request
    // — collapsing every real client onto one identity and defeating the
    // per-IP rate limiters in trpc.ts entirely (every user sharing one
    // budget). Safe as unconditional trust specifically because of this
    // deployment's topology: the backend container publishes no host port
    // and is only reachable from other containers on the private "staging"
    // network, so nginx is the only possible path in — and nginx itself
    // (apps/web/nginx.conf) always REPLACES X-Forwarded-For with
    // $remote_addr rather than appending to it, so a client can never
    // inject a spoofed value that survives to reach this process.
    trustProxy: true,
  });

  await fastify.register(cors, {
    origin: ["http://localhost:5173"],
    credentials: true,
  });

  await fastify.register(cookie);

  // Blanket HTTP-level baseline against gross abuse (scripted floods, scraping).
  // This is deliberately coarse — it can't distinguish individual tRPC
  // procedures batched into one /trpc request, which is what the per-procedure
  // authProcedure/aiProcedure limiters in trpc.ts exist to cover.
  await fastify.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
  });

  await fastify.register(multipart, { limits: { ...BRD_UPLOAD_LIMITS, files: 10 } });

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
