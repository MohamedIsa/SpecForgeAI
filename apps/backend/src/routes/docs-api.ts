import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { appRouter } from "../router";
import type { Context } from "../router";
import { verifyBearerToken } from "../lib/jwt";
import type { TicketType, TicketPriority } from "../routers/ticket";

/**
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

const BEARER_AUTH = [{ bearerAuth: [] }];

// ---------------------------------------------------------------------------
// Shared JSON Schema fragments (registered once via fastify.addSchema, then
// referenced everywhere via $ref so every response/body schema below stays
// in sync with a single source of truth).
// ---------------------------------------------------------------------------

const schemas: Array<{ $id: string } & Record<string, unknown>> = [
  {
    $id: "AuthUser",
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      fullName: { type: "string" },
      email: { type: "string" },
    },
  },
  {
    $id: "AuthResult",
    type: "object",
    properties: {
      accessToken: { type: "string" },
      expiresInSeconds: { type: "number" },
      user: { $ref: "AuthUser#" },
    },
  },
  {
    $id: "LogoutResult",
    type: "object",
    properties: { success: { type: "boolean" } },
  },
  {
    $id: "Project",
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      key: { type: "string" },
      description: { type: "string", nullable: true },
      template: { type: "string", enum: ["kanban", "scrum"] },
      nextTicketNumber: { type: "number" },
      createdAt: { type: "string" },
    },
  },
  {
    $id: "ProjectSummary",
    type: "object",
    allOf: [
      { $ref: "Project#" },
      {
        type: "object",
        properties: {
          role: { type: "string", enum: ["owner", "editor", "viewer"] },
          memberCount: { type: "number" },
        },
      },
    ],
  },
  {
    $id: "ProjectStatus",
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      color: { type: "string" },
      position: { type: "number" },
    },
  },
  {
    $id: "CreateProjectResult",
    type: "object",
    properties: {
      project: { $ref: "Project#" },
      statuses: { type: "array", items: { $ref: "ProjectStatus#" } },
    },
  },
  {
    $id: "Membership",
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      projectId: { type: "string", format: "uuid" },
      userId: { type: "string", format: "uuid" },
      role: { type: "string", enum: ["owner", "editor", "viewer"] },
    },
  },
  {
    $id: "InviteMemberResult",
    type: "object",
    properties: { membership: { $ref: "Membership#" } },
  },
  {
    $id: "CreateStatusResult",
    type: "object",
    properties: { status: { $ref: "ProjectStatus#" } },
  },
  {
    $id: "ReorderStatusesResult",
    type: "object",
    properties: { statuses: { type: "array", items: { $ref: "ProjectStatus#" } } },
  },
  {
    $id: "DeleteStatusResult",
    type: "object",
    properties: { success: { type: "boolean" } },
  },
  {
    $id: "AcceptanceCriterion",
    type: "object",
    properties: {
      given: { type: "string" },
      when: { type: "string" },
      expectedResult: { type: "string" },
      checked: { type: "boolean" },
    },
  },
  {
    $id: "Ticket",
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      projectId: { type: "string", format: "uuid" },
      statusId: { type: "string", format: "uuid" },
      key: { type: "string" },
      title: { type: "string" },
      description: { type: "string", nullable: true },
      type: { type: "string", enum: ["story", "bug", "task"] },
      priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
      storyPoints: { type: "number", nullable: true },
      assigneeId: { type: "string", format: "uuid", nullable: true },
      acceptanceCriteria: { type: "array", items: { $ref: "AcceptanceCriterion#" } },
      aiDevPrompt: { type: "string", nullable: true },
      dependencies: { type: "array", items: { type: "string", format: "uuid" } },
      createdAt: { type: "string" },
    },
  },
  {
    $id: "AssigneeSummary",
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      fullName: { type: "string" },
      email: { type: "string" },
    },
  },
  {
    $id: "TicketWithAssignee",
    type: "object",
    allOf: [
      { $ref: "Ticket#" },
      {
        type: "object",
        properties: { assignee: { anyOf: [{ $ref: "AssigneeSummary#" }, { type: "null" }] } },
      },
    ],
  },
  {
    $id: "DependencySummary",
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      key: { type: "string" },
      title: { type: "string" },
      statusId: { type: "string", format: "uuid" },
    },
  },
  {
    $id: "TicketDetails",
    type: "object",
    allOf: [
      { $ref: "TicketWithAssignee#" },
      {
        type: "object",
        properties: {
          dependencySummaries: { type: "array", items: { $ref: "DependencySummary#" } },
        },
      },
    ],
  },
  {
    $id: "TicketResult",
    type: "object",
    properties: { ticket: { $ref: "Ticket#" } },
  },
  {
    $id: "BrdFile",
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      projectId: { type: "string", format: "uuid" },
      fileName: { type: "string" },
      extension: { type: "string", enum: ["pdf", "docx", "md"] },
      byteSize: { type: "number" },
      checksum: { type: "string" },
      scanStatus: { type: "string", enum: ["clean"] },
      createdAt: { type: "string" },
    },
  },
  {
    $id: "TechPreferences",
    type: "object",
    properties: {
      frontend: { type: "string", nullable: true },
      backend: { type: "string", nullable: true },
      database: { type: "string", nullable: true },
      infra: { type: "string", nullable: true },
      updatedAt: { type: "string", nullable: true },
    },
  },
  {
    $id: "ClarificationQuestion",
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      position: { type: "number" },
      prompt: { type: "string" },
      ambiguity: { type: "string" },
      quickReplies: { type: "array", items: { type: "string" } },
      answer: { type: "string", nullable: true },
      resolved: { type: "boolean" },
    },
  },
  {
    $id: "ClarificationMessage",
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      role: { type: "string", enum: ["ai", "user"] },
      content: { type: "string" },
      questionId: { type: "string", format: "uuid", nullable: true },
      createdAt: { type: "string" },
    },
  },
  {
    $id: "ClarificationSessionState",
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      projectId: { type: "string", format: "uuid" },
      status: { type: "string", enum: ["active", "completed"] },
      compiledContext: { type: "string", nullable: true },
      createdAt: { type: "string" },
      completedAt: { type: "string", nullable: true },
      questions: { type: "array", items: { $ref: "ClarificationQuestion#" } },
      messages: { type: "array", items: { $ref: "ClarificationMessage#" } },
      resolvedCount: { type: "number" },
      totalCount: { type: "number" },
      allResolved: { type: "boolean" },
    },
  },
  {
    $id: "BrdDocumentPage",
    type: "object",
    properties: {
      pageNumber: { type: "number" },
      text: { type: "string" },
    },
  },
  {
    $id: "BrdDocumentView",
    type: "object",
    properties: {
      fileId: { type: "string", format: "uuid" },
      fileName: { type: "string" },
      extension: { type: "string", enum: ["pdf", "docx", "md"] },
      pages: { type: "array", items: { $ref: "BrdDocumentPage#" } },
    },
  },
  {
    $id: "GeneratedAcceptanceCriterion",
    type: "object",
    properties: {
      given: { type: "string" },
      when: { type: "string" },
      expectedResult: { type: "string" },
    },
  },
  {
    $id: "BacklogTicketPreview",
    type: "object",
    properties: {
      ref: { type: "string" },
      title: { type: "string" },
      type: { type: "string", enum: ["story", "bug", "task"] },
      priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
      storyPoints: { type: "number" },
      acceptanceCriteria: { type: "array", items: { $ref: "GeneratedAcceptanceCriterion#" } },
      aiDevPrompt: { type: "string" },
      dependsOn: { type: "array", items: { type: "string" } },
      previewKey: { type: "string" },
      dependsOnPreviewKeys: { type: "array", items: { type: "string" } },
    },
  },
  {
    $id: "BacklogEpicPreview",
    type: "object",
    properties: {
      title: { type: "string" },
      tickets: { type: "array", items: { $ref: "BacklogTicketPreview#" } },
    },
  },
  {
    $id: "BacklogSummary",
    type: "object",
    properties: {
      epicCount: { type: "number" },
      ticketCount: { type: "number" },
      totalStoryPoints: { type: "number" },
    },
  },
  {
    $id: "GenerateBacklogResult",
    type: "object",
    properties: {
      epics: { type: "array", items: { $ref: "BacklogEpicPreview#" } },
      summary: { $ref: "BacklogSummary#" },
    },
  },
  {
    $id: "PublishBacklogResult",
    type: "object",
    properties: {
      epicCount: { type: "number" },
      ticketCount: { type: "number" },
    },
  },
];

const acceptanceCriterionBodySchema = {
  type: "object",
  required: ["given", "when", "expectedResult", "checked"],
  properties: {
    given: { type: "string", minLength: 1, maxLength: 500 },
    when: { type: "string", minLength: 1, maxLength: 500 },
    expectedResult: { type: "string", minLength: 1, maxLength: 500 },
    checked: { type: "boolean" },
  },
} as const;

const publishAcceptanceCriterionBodySchema = {
  type: "object",
  required: ["given", "when", "expectedResult"],
  properties: {
    given: { type: "string", minLength: 1, maxLength: 500 },
    when: { type: "string", minLength: 1, maxLength: 500 },
    expectedResult: { type: "string", minLength: 1, maxLength: 500 },
  },
} as const;

const publishTicketBodySchema = {
  type: "object",
  required: ["ref", "title", "type", "priority", "storyPoints", "acceptanceCriteria", "aiDevPrompt"],
  properties: {
    ref: { type: "string", minLength: 1, maxLength: 20 },
    title: { type: "string", minLength: 1, maxLength: 200 },
    type: { type: "string", enum: ["story", "bug", "task"] },
    priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
    storyPoints: { type: "number", minimum: 0, maximum: 21 },
    acceptanceCriteria: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: publishAcceptanceCriterionBodySchema,
    },
    aiDevPrompt: { type: "string", minLength: 1, maxLength: 4000 },
    dependsOn: { type: "array", items: { type: "string", minLength: 1, maxLength: 20 } },
  },
} as const;

const publishEpicBodySchema = {
  type: "object",
  required: ["title", "tickets"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 200 },
    tickets: { type: "array", minItems: 1, items: publishTicketBodySchema },
  },
} as const;

interface ProjectIdParams {
  projectId: string;
}

const projectIdParamsSchema = {
  type: "object",
  required: ["projectId"],
  properties: { projectId: { type: "string", format: "uuid" } },
} as const;

interface TicketIdParams extends ProjectIdParams {
  ticketId: string;
}

const ticketIdParamsSchema = {
  type: "object",
  required: ["projectId", "ticketId"],
  properties: {
    projectId: { type: "string", format: "uuid" },
    ticketId: { type: "string", format: "uuid" },
  },
} as const;

interface StatusIdParams extends ProjectIdParams {
  statusId: string;
}

const statusIdParamsSchema = {
  type: "object",
  required: ["projectId", "statusId"],
  properties: {
    projectId: { type: "string", format: "uuid" },
    statusId: { type: "string", format: "uuid" },
  },
} as const;

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

interface CreateProjectBody {
  name: string;
  key: string;
  description?: string;
  template: "kanban" | "scrum";
}

interface InviteMemberBody {
  email: string;
  role: "owner" | "editor" | "viewer";
}

interface CreateStatusBody {
  name: string;
  color?: string;
}

interface ReorderStatusesBody {
  orderedStatusIds: string[];
}

interface AcceptanceCriterionBody {
  given: string;
  when: string;
  expectedResult: string;
  checked: boolean;
}

interface CreateTicketBody {
  statusId: string;
  title: string;
  description?: string;
  type: TicketType;
  priority: TicketPriority;
  storyPoints?: number;
  assigneeId?: string;
  acceptanceCriteria?: AcceptanceCriterionBody[];
  aiDevPrompt?: string;
  dependencies?: string[];
}

interface UpdateTicketStatusBody {
  statusId: string;
}

interface UpdateTicketBody {
  title?: string;
  description?: string | null;
  priority?: TicketPriority;
  storyPoints?: number | null;
  assigneeId?: string | null;
}

interface SaveTechPreferencesBody {
  frontend?: string | null;
  backend?: string | null;
  database?: string | null;
  infra?: string | null;
}

interface SendClarificationMessageBody {
  questionId: string;
  answer: string;
}

interface PublishGeneratedAcceptanceCriterion {
  given: string;
  when: string;
  expectedResult: string;
}

interface PublishGeneratedTicket {
  ref: string;
  title: string;
  type: TicketType;
  priority: TicketPriority;
  storyPoints: number;
  acceptanceCriteria: PublishGeneratedAcceptanceCriterion[];
  aiDevPrompt: string;
  dependsOn?: string[];
}

interface PublishGeneratedEpic {
  title: string;
  tickets: PublishGeneratedTicket[];
}

interface PublishBacklogBody {
  epics: PublishGeneratedEpic[];
}

function registerHealthRoute(fastify: FastifyInstance): void {
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
}

function registerAuthRoutes(fastify: FastifyInstance): void {
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
        response: { 200: { $ref: "AuthResult#" } },
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
        response: { 200: { $ref: "AuthResult#" } },
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

  fastify.post(
    "/api/auth/refresh",
    {
      schema: {
        description:
          "Rotates the session using the httpOnly refresh cookie set by signup/login, " +
          "returning a new access token.",
        tags: ["auth"],
        response: { 200: { $ref: "AuthResult#" } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.auth.refreshSession();
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );

  fastify.post(
    "/api/auth/logout",
    {
      schema: {
        description: "Invalidates the current session and clears the refresh cookie.",
        tags: ["auth"],
        response: { 200: { $ref: "LogoutResult#" } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      return caller.auth.logout();
    },
  );
}

function registerProjectRoutes(fastify: FastifyInstance): void {
  fastify.get(
    "/api/projects",
    {
      schema: {
        description: "Lists the projects the authenticated user is a member of.",
        tags: ["projects"],
        security: BEARER_AUTH,
        response: { 200: { type: "array", items: { $ref: "ProjectSummary#" } } },
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

  fastify.post<{ Body: CreateProjectBody }>(
    "/api/projects",
    {
      schema: {
        description: "Creates a project, owner membership, and default statuses for its template.",
        tags: ["projects"],
        security: BEARER_AUTH,
        body: {
          type: "object",
          required: ["name", "key", "template"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 200 },
            key: { type: "string", pattern: "^[A-Z][A-Z0-9]{1,9}$" },
            description: { type: "string", maxLength: 2000 },
            template: { type: "string", enum: ["kanban", "scrum"] },
          },
        },
        response: { 200: { $ref: "CreateProjectResult#" } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.project.createProject(request.body);
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );

  fastify.post<{ Params: ProjectIdParams; Body: InviteMemberBody }>(
    "/api/projects/:projectId/members",
    {
      schema: {
        description: "Invites an existing user (by email) to the project with the given role.",
        tags: ["projects"],
        security: BEARER_AUTH,
        params: projectIdParamsSchema,
        body: {
          type: "object",
          required: ["email", "role"],
          properties: {
            email: { type: "string", format: "email" },
            role: { type: "string", enum: ["owner", "editor", "viewer"] },
          },
        },
        response: { 200: { $ref: "InviteMemberResult#" } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.project.inviteMember({
          projectId: request.params.projectId,
          ...request.body,
        });
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );
}

function registerStatusRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Params: ProjectIdParams }>(
    "/api/projects/:projectId/statuses",
    {
      schema: {
        description: "Lists a project's statuses ordered by position.",
        tags: ["statuses"],
        security: BEARER_AUTH,
        params: projectIdParamsSchema,
        response: { 200: { type: "array", items: { $ref: "ProjectStatus#" } } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.status.getProjectStatuses({ projectId: request.params.projectId });
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );

  fastify.post<{ Params: ProjectIdParams; Body: CreateStatusBody }>(
    "/api/projects/:projectId/statuses",
    {
      schema: {
        description: "Appends a new status at the end of the project's board.",
        tags: ["statuses"],
        security: BEARER_AUTH,
        params: projectIdParamsSchema,
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
            color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
          },
        },
        response: { 200: { $ref: "CreateStatusResult#" } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.status.createStatus({
          projectId: request.params.projectId,
          ...request.body,
        });
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );

  fastify.put<{ Params: ProjectIdParams; Body: ReorderStatusesBody }>(
    "/api/projects/:projectId/statuses/order",
    {
      schema: {
        description: "Reorders every status in the project to match the given id order.",
        tags: ["statuses"],
        security: BEARER_AUTH,
        params: projectIdParamsSchema,
        body: {
          type: "object",
          required: ["orderedStatusIds"],
          properties: {
            orderedStatusIds: {
              type: "array",
              minItems: 1,
              items: { type: "string", format: "uuid" },
            },
          },
        },
        response: { 200: { $ref: "ReorderStatusesResult#" } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.status.reorderStatuses({
          projectId: request.params.projectId,
          ...request.body,
        });
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );

  fastify.delete<{ Params: StatusIdParams }>(
    "/api/projects/:projectId/statuses/:statusId",
    {
      schema: {
        description: "Deletes a status. Fails if any ticket still references it.",
        tags: ["statuses"],
        security: BEARER_AUTH,
        params: statusIdParamsSchema,
        response: { 200: { $ref: "DeleteStatusResult#" } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.status.deleteStatus({
          projectId: request.params.projectId,
          statusId: request.params.statusId,
        });
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );
}

function registerTicketRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Params: ProjectIdParams }>(
    "/api/projects/:projectId/tickets",
    {
      schema: {
        description: "Lists every ticket in the project with resolved assignee info.",
        tags: ["tickets"],
        security: BEARER_AUTH,
        params: projectIdParamsSchema,
        response: { 200: { type: "array", items: { $ref: "TicketWithAssignee#" } } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.ticket.getProjectTickets({ projectId: request.params.projectId });
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );

  fastify.get<{ Params: TicketIdParams }>(
    "/api/projects/:projectId/tickets/:ticketId",
    {
      schema: {
        description: "Returns full ticket details, including resolved dependency summaries.",
        tags: ["tickets"],
        security: BEARER_AUTH,
        params: ticketIdParamsSchema,
        response: { 200: { $ref: "TicketDetails#" } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.ticket.getTicketDetails({
          projectId: request.params.projectId,
          ticketId: request.params.ticketId,
        });
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );

  fastify.post<{ Params: ProjectIdParams; Body: CreateTicketBody }>(
    "/api/projects/:projectId/tickets",
    {
      schema: {
        description: "Creates a ticket with an auto-generated sequential key.",
        tags: ["tickets"],
        security: BEARER_AUTH,
        params: projectIdParamsSchema,
        body: {
          type: "object",
          required: ["statusId", "title", "type", "priority"],
          properties: {
            statusId: { type: "string", format: "uuid" },
            title: { type: "string", minLength: 1, maxLength: 300 },
            description: { type: "string", maxLength: 5000 },
            type: { type: "string", enum: ["story", "bug", "task"] },
            priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
            storyPoints: { type: "number", minimum: 0, maximum: 100 },
            assigneeId: { type: "string", format: "uuid" },
            acceptanceCriteria: { type: "array", items: acceptanceCriterionBodySchema },
            aiDevPrompt: { type: "string", maxLength: 10000 },
            dependencies: { type: "array", items: { type: "string", format: "uuid" } },
          },
        },
        response: { 200: { $ref: "TicketResult#" } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.ticket.createTicket({
          projectId: request.params.projectId,
          ...request.body,
        });
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );

  fastify.patch<{ Params: TicketIdParams; Body: UpdateTicketStatusBody }>(
    "/api/projects/:projectId/tickets/:ticketId/status",
    {
      schema: {
        description: "Moves a ticket to a different status, enforcing dependency ordering.",
        tags: ["tickets"],
        security: BEARER_AUTH,
        params: ticketIdParamsSchema,
        body: {
          type: "object",
          required: ["statusId"],
          properties: { statusId: { type: "string", format: "uuid" } },
        },
        response: { 200: { $ref: "TicketResult#" } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.ticket.updateTicketStatus({
          projectId: request.params.projectId,
          ticketId: request.params.ticketId,
          statusId: request.body.statusId,
        });
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );

  fastify.patch<{ Params: TicketIdParams; Body: UpdateTicketBody }>(
    "/api/projects/:projectId/tickets/:ticketId",
    {
      schema: {
        description: "Partially updates a ticket's title, description, priority, points, or assignee.",
        tags: ["tickets"],
        security: BEARER_AUTH,
        params: ticketIdParamsSchema,
        body: {
          type: "object",
          properties: {
            title: { type: "string", minLength: 1, maxLength: 300 },
            description: { type: "string", maxLength: 5000, nullable: true },
            priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
            storyPoints: { type: "number", minimum: 0, maximum: 100, nullable: true },
            assigneeId: { type: "string", format: "uuid", nullable: true },
          },
        },
        response: { 200: { $ref: "TicketResult#" } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.ticket.updateTicket({
          projectId: request.params.projectId,
          ticketId: request.params.ticketId,
          ...request.body,
        });
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );
}

function registerBrdRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Params: ProjectIdParams }>(
    "/api/projects/:projectId/brd/files",
    {
      schema: {
        description: "Lists the BRD files stored for the project.",
        tags: ["brd"],
        security: BEARER_AUTH,
        params: projectIdParamsSchema,
        response: { 200: { type: "array", items: { $ref: "BrdFile#" } } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.brd.listFiles({ projectId: request.params.projectId });
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );

  fastify.get<{ Params: ProjectIdParams }>(
    "/api/projects/:projectId/brd/tech-preferences",
    {
      schema: {
        description: "Returns the project's saved tech-stack preferences.",
        tags: ["brd"],
        security: BEARER_AUTH,
        params: projectIdParamsSchema,
        response: { 200: { $ref: "TechPreferences#" } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.brd.getTechPreferences({ projectId: request.params.projectId });
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );

  fastify.put<{ Params: ProjectIdParams; Body: SaveTechPreferencesBody }>(
    "/api/projects/:projectId/brd/tech-preferences",
    {
      schema: {
        description: "Saves (upserts) the project's tech-stack preferences. An empty string clears a field.",
        tags: ["brd"],
        security: BEARER_AUTH,
        params: projectIdParamsSchema,
        body: {
          type: "object",
          properties: {
            frontend: { type: "string", maxLength: 200, nullable: true },
            backend: { type: "string", maxLength: 200, nullable: true },
            database: { type: "string", maxLength: 200, nullable: true },
            infra: { type: "string", maxLength: 200, nullable: true },
          },
        },
        response: { 200: { $ref: "TechPreferences#" } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.brd.saveTechPreferences({
          projectId: request.params.projectId,
          ...request.body,
        });
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );
}

function registerClarificationRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Params: ProjectIdParams }>(
    "/api/projects/:projectId/clarification",
    {
      schema: {
        description: "Returns the project's latest clarification session, or null if none exists.",
        tags: ["clarification"],
        security: BEARER_AUTH,
        params: projectIdParamsSchema,
        response: {
          200: { anyOf: [{ $ref: "ClarificationSessionState#" }, { type: "null" }] },
        },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.clarification.getSessionState({ projectId: request.params.projectId });
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );

  fastify.get<{ Params: ProjectIdParams }>(
    "/api/projects/:projectId/clarification/documents",
    {
      schema: {
        description: "Returns every uploaded BRD's extracted text, paginated per source page.",
        tags: ["clarification"],
        security: BEARER_AUTH,
        params: projectIdParamsSchema,
        response: { 200: { type: "array", items: { $ref: "BrdDocumentView#" } } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.clarification.getBrdDocuments({ projectId: request.params.projectId });
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );

  fastify.post<{ Params: ProjectIdParams }>(
    "/api/projects/:projectId/clarification/start",
    {
      schema: {
        description:
          "Starts a clarification session, asking the AI to generate questions from the uploaded BRDs. " +
          "Reuses an already-active session instead of burning a second AI call.",
        tags: ["clarification"],
        security: BEARER_AUTH,
        params: projectIdParamsSchema,
        response: { 200: { $ref: "ClarificationSessionState#" } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.clarification.startSession({ projectId: request.params.projectId });
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );

  fastify.post<{ Params: ProjectIdParams; Body: SendClarificationMessageBody }>(
    "/api/projects/:projectId/clarification/messages",
    {
      schema: {
        description: "Answers the given open question in the project's active clarification session.",
        tags: ["clarification"],
        security: BEARER_AUTH,
        params: projectIdParamsSchema,
        body: {
          type: "object",
          required: ["questionId", "answer"],
          properties: {
            questionId: { type: "string", format: "uuid" },
            answer: { type: "string", minLength: 1, maxLength: 2000 },
          },
        },
        response: { 200: { $ref: "ClarificationSessionState#" } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.clarification.sendMessage({
          projectId: request.params.projectId,
          ...request.body,
        });
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );

  fastify.post<{ Params: ProjectIdParams }>(
    "/api/projects/:projectId/clarification/complete",
    {
      schema: {
        description: "Completes the active clarification session once every question is resolved.",
        tags: ["clarification"],
        security: BEARER_AUTH,
        params: projectIdParamsSchema,
        response: { 200: { $ref: "ClarificationSessionState#" } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.clarification.completeSession({ projectId: request.params.projectId });
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );
}

function registerBacklogRoutes(fastify: FastifyInstance): void {
  fastify.post<{ Params: ProjectIdParams }>(
    "/api/projects/:projectId/backlog/generate",
    {
      schema: {
        description:
          "Asks the AI to draft a backlog (epics + tickets) from the BRD and completed clarification context. " +
          "Nothing is persisted until it is published.",
        tags: ["backlog"],
        security: BEARER_AUTH,
        params: projectIdParamsSchema,
        response: { 200: { $ref: "GenerateBacklogResult#" } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.backlog.generateBacklog({ projectId: request.params.projectId });
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );

  fastify.post<{ Params: ProjectIdParams; Body: PublishBacklogBody }>(
    "/api/projects/:projectId/backlog/publish",
    {
      schema: {
        description:
          "Publishes a previously generated backlog draft to the board, creating real epics and tickets.",
        tags: ["backlog"],
        security: BEARER_AUTH,
        params: projectIdParamsSchema,
        body: {
          type: "object",
          required: ["epics"],
          properties: {
            epics: { type: "array", minItems: 1, maxItems: 10, items: publishEpicBodySchema },
          },
        },
        response: { 200: { $ref: "PublishBacklogResult#" } },
      },
    },
    async (request, reply) => {
      const caller = appRouter.createCaller(buildContext(request, reply));
      try {
        return await caller.backlog.publishBacklogToBoard({
          projectId: request.params.projectId,
          ...request.body,
        });
      } catch (error) {
        return handleTrpcError(error, reply);
      }
    },
  );
}

export async function registerDocsApiRoutes(fastify: FastifyInstance): Promise<void> {
  for (const schema of schemas) {
    fastify.addSchema(schema);
  }

  registerHealthRoute(fastify);
  registerAuthRoutes(fastify);
  registerProjectRoutes(fastify);
  registerStatusRoutes(fastify);
  registerTicketRoutes(fastify);
  registerBrdRoutes(fastify);
  registerClarificationRoutes(fastify);
  registerBacklogRoutes(fastify);
}
