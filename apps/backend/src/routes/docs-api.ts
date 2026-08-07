import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { appRouter } from "../router";
import type { Context } from "../router";
import { verifyBearerToken } from "../lib/jwt";

/**
 * DEV-TEMP-T1: a handful of representative tRPC procedures exposed as plain
 * REST routes so they show up as real, testable endpoints in Swagger UI.
 *
 * trpc-to-openapi (the usual bridge for this) was evaluated and rejected: the
 * only release compatible with our Zod v3 codebase crashes the whole Node
 * process on every request against our pinned @trpc/server version. These
 * routes sidestep that entirely — each one just builds a Context and calls
 * the existing procedure through `appRouter.createCaller`, the same pattern
 * test-utils.ts already uses. The full API remains reachable at /trpc
 * regardless of what is wrapped here.
 */

function buildContext(request: FastifyRequest, reply: FastifyReply): Context {
  return {
    req: request,
    res: reply,
    userId: verifyBearerToken(request.headers.authorization),
  };
}

async function handleTrpcError(error: unknown, reply: FastifyReply): Promise<void> {
  if (error instanceof TRPCError) {
    void reply.code(getHTTPStatusCodeFromError(error)).send({
      error: { code: error.code, message: error.message },
    });
    return;
  }
  throw error;
}

interface SignupBody {
  fullName: string;
  email: string;
  password: string;
}

interface LoginBody {
  email: string;
  password: string;
  rememberMe?: boolean;
}

const authUserSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    fullName: { type: "string" },
    email: { type: "string" },
  },
} as const;

const authResultSchema = {
  type: "object",
  properties: {
    accessToken: { type: "string" },
    expiresInSeconds: { type: "number" },
    user: authUserSchema,
  },
} as const;

export async function registerDocsApiRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/health",
    {
      schema: {
        description: "Reports whether the API can reach the database.",
        tags: ["health"],
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              database: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      return caller.health();
    },
  );

  fastify.post<{ Body: SignupBody }>(
    "/api/auth/signup",
    {
      schema: {
        description: "Creates a new account and returns an access token.",
        tags: ["auth"],
        body: {
          type: "object",
          required: ["fullName", "email", "password"],
          properties: {
            fullName: { type: "string", minLength: 1, maxLength: 200 },
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 8, maxLength: 200 },
          },
        },
        response: { 200: authResultSchema },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.auth.signup(request.body);
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );

  fastify.post<{ Body: LoginBody }>(
    "/api/auth/login",
    {
      schema: {
        description: "Authenticates an existing account and returns an access token.",
        tags: ["auth"],
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 1, maxLength: 200 },
            rememberMe: { type: "boolean" },
          },
        },
        response: { 200: authResultSchema },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.auth.login(request.body);
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );

  fastify.get(
    "/api/projects",
    {
      schema: {
        description: "Lists the projects the authenticated user is a member of.",
        tags: ["projects"],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                name: { type: "string" },
                key: { type: "string" },
                description: { type: "string", nullable: true },
                template: { type: "string" },
                nextTicketNumber: { type: "number" },
                createdAt: { type: "string" },
                role: { type: "string" },
                memberCount: { type: "number" },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.project.listUserProjects();
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );
}
