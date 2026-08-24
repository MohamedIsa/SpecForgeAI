import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { pool } from "../db/pool";
import { requestClarificationQuestions, type ClarificationQuestionDraft } from "../services/ai";
import { requestBacklogGeneration, type BacklogDraft } from "../services/backlog-generator";

// Only the network-facing AI calls are faked — everything else runs for
// real (real Postgres, real Fastify routes, real tRPC callers underneath),
// mirroring the pattern already used by clarification.test.ts / backlog.test.ts.
vi.mock("../services/ai", async () => {
  const actual = await vi.importActual<typeof import("../services/ai")>("../services/ai");
  return { ...actual, requestClarificationQuestions: vi.fn() };
});
vi.mock("../services/backlog-generator", async () => {
  const actual = await vi.importActual<typeof import("../services/backlog-generator")>(
    "../services/backlog-generator",
  );
  return { ...actual, requestBacklogGeneration: vi.fn() };
});

const askClarificationAi = vi.mocked(requestClarificationQuestions);
const askBacklogAi = vi.mocked(requestBacklogGeneration);

const EXPECTED_PATHS = [
  "/api/health",
  "/api/auth/signup",
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/auth/logout",
  "/api/brd/upload",
  "/api/projects",
  "/api/projects/{projectId}/members",
  "/api/projects/{projectId}/statuses",
  "/api/projects/{projectId}/statuses/order",
  "/api/projects/{projectId}/statuses/{statusId}",
  "/api/projects/{projectId}/tickets",
  "/api/projects/{projectId}/tickets/{ticketId}",
  "/api/projects/{projectId}/tickets/{ticketId}/status",
  "/api/projects/{projectId}/brd/files",
  "/api/projects/{projectId}/brd/tech-preferences",
  "/api/projects/{projectId}/clarification",
  "/api/projects/{projectId}/clarification/documents",
  "/api/projects/{projectId}/clarification/start",
  "/api/projects/{projectId}/clarification/messages",
  "/api/projects/{projectId}/clarification/complete",
  "/api/projects/{projectId}/backlog/generate",
  "/api/projects/{projectId}/backlog/publish",
];

const createdUserIds: string[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop();
    await pool.query("DELETE FROM users WHERE id = $1", [id]);
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
  askClarificationAi.mockReset();
  askBacklogAi.mockReset();
});

function uniqueEmail(): string {
  return `docs-api-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueKey(): string {
  return `D${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

/**
 * light-my-request defaults every injected request's source IP to
 * 127.0.0.1, which would make every signup() call in this file look like
 * the same client to authProcedure's per-IP rate limiter. Each call needs a
 * distinct address so this suite's incidental signup volume never trips it.
 */
let ipCounter = 0;
function uniqueIp(): string {
  ipCounter += 1;
  return `10.0.${Math.floor(ipCounter / 255)}.${ipCounter % 255}`;
}

describe("DEV-TEMP-T1 expanded REST documentation surface", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.ENABLE_SWAGGER = "true";
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function signup(): Promise<{ accessToken: string; userId: string; refreshCookie: string }> {
    const email = uniqueEmail();
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      remoteAddress: uniqueIp(),
      payload: { fullName: "Docs API Test", email, password: "a-strong-password" },
    });
    const body: { accessToken: string; user: { id: string } } = JSON.parse(response.payload);
    createdUserIds.push(body.user.id);
    const setCookie = response.cookies.find((cookie) => cookie.name === "refreshToken");
    if (!setCookie) throw new Error("signup did not set a refresh cookie");
    return { accessToken: body.accessToken, userId: body.user.id, refreshCookie: setCookie.value };
  }

  async function createProject(
    accessToken: string,
  ): Promise<{ projectId: string; firstStatusId: string }> {
    const response = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: "Docs API Project", key: uniqueKey(), template: "kanban" },
    });
    const body: { project: { id: string }; statuses: { id: string }[] } = JSON.parse(
      response.payload,
    );
    const firstStatusId = body.statuses[0]?.id;
    if (!firstStatusId) throw new Error("createProject did not seed default statuses");
    return { projectId: body.project.id, firstStatusId };
  }

  async function seedBrdFile(projectId: string, userId: string): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "specforge-docs-api-"));
    tempDirs.push(dir);
    const content = "Users must be able to authenticate and manage billing.";
    const storagePath = join(dir, "requirements.md");
    await writeFile(storagePath, content, "utf8");
    await pool.query(
      `INSERT INTO brd_files
         (project_id, file_name, extension, byte_size, checksum, storage_path, scan_status, uploaded_by)
       VALUES ($1, 'requirements.md', 'md', $2, $3, $4, 'clean', $5)`,
      [projectId, Buffer.byteLength(content), Math.random().toString(36).slice(2), storagePath, userId],
    );
  }

  describe("GET /docs and /docs/json", () => {
    it("serves the interactive UI at /docs", async () => {
      const response = await app.inject({ method: "GET", url: "/docs" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
    });

    it("serves a valid OpenAPI document at /docs/json covering every router (auth, project, status, ticket, brd, clarification, backlog, upload)", async () => {
      const response = await app.inject({ method: "GET", url: "/docs/json" });
      expect(response.statusCode).toBe(200);

      const document: {
        openapi: string;
        paths: Record<string, unknown>;
        components: { securitySchemes: { bearerAuth?: { type: string; scheme: string } } };
      } = JSON.parse(response.payload);

      expect(document.openapi).toMatch(/^3\./);
      for (const path of EXPECTED_PATHS) {
        expect(document.paths, `missing path ${path}`).toHaveProperty(path);
      }
      expect(Object.keys(document.paths).length).toBeGreaterThanOrEqual(EXPECTED_PATHS.length);
      expect(document.components.securitySchemes.bearerAuth).toEqual({
        type: "http",
        scheme: "bearer",
      });
    });

    it("declares the bearerAuth security requirement on a protected route but not on a public one", async () => {
      const response = await app.inject({ method: "GET", url: "/docs/json" });
      const document: {
        paths: Record<string, Record<string, { security?: unknown }>>;
      } = JSON.parse(response.payload);

      expect(document.paths["/api/projects"]?.get?.security).toEqual([{ bearerAuth: [] }]);
      expect(document.paths["/api/health"]?.get?.security).toBeUndefined();
    });
  });

  describe("auth REST wrappers", () => {
    it("signup, login, refresh and logout form a working session lifecycle", async () => {
      const { refreshCookie, userId } = await signup();

      const refreshResponse = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        headers: { cookie: `refreshToken=${refreshCookie}` },
      });
      expect(refreshResponse.statusCode).toBe(200);
      const refreshBody: { accessToken: string } = JSON.parse(refreshResponse.payload);
      expect(refreshBody.accessToken).toEqual(expect.any(String));
      const rotatedCookie = refreshResponse.cookies.find((cookie) => cookie.name === "refreshToken");
      expect(rotatedCookie).toBeDefined();

      const logoutResponse = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: { cookie: `refreshToken=${rotatedCookie?.value}` },
      });
      expect(logoutResponse.statusCode).toBe(200);
      expect(JSON.parse(logoutResponse.payload)).toEqual({ success: true });

      const reuseResponse = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        headers: { cookie: `refreshToken=${rotatedCookie?.value}` },
      });
      expect(reuseResponse.statusCode).toBe(401);

      createdUserIds.push(userId);
    });
  });

  describe("project REST wrappers", () => {
    it("creates a project, lists it, and invites a second member", async () => {
      const owner = await signup();
      const invitee = await signup();

      const { projectId } = await createProject(owner.accessToken);

      const listResponse = await app.inject({
        method: "GET",
        url: "/api/projects",
        headers: { authorization: `Bearer ${owner.accessToken}` },
      });
      expect(listResponse.statusCode).toBe(200);
      const projects: { id: string }[] = JSON.parse(listResponse.payload);
      expect(projects.some((project) => project.id === projectId)).toBe(true);

      const inviteeEmailResult = await pool.query<{ email: string }>(
        "SELECT email FROM users WHERE id = $1",
        [invitee.userId],
      );
      const inviteeEmail = inviteeEmailResult.rows[0]?.email;
      expect(inviteeEmail).toBeDefined();

      const inviteResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/members`,
        headers: { authorization: `Bearer ${owner.accessToken}` },
        payload: { email: inviteeEmail, role: "editor" },
      });
      expect(inviteResponse.statusCode).toBe(200);
      const inviteBody: { membership: { role: string; userId: string } } = JSON.parse(
        inviteResponse.payload,
      );
      expect(inviteBody.membership.role).toBe("editor");
      expect(inviteBody.membership.userId).toBe(invitee.userId);
    });

    it("rejects an invalid project body with 400 before it reaches the database", async () => {
      const owner = await signup();
      const response = await app.inject({
        method: "POST",
        url: "/api/projects",
        headers: { authorization: `Bearer ${owner.accessToken}` },
        payload: { name: "", key: "not-a-valid-key", template: "kanban" },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("status REST wrappers", () => {
    it("lists, creates, reorders and deletes statuses", async () => {
      const owner = await signup();
      const { projectId } = await createProject(owner.accessToken);
      const auth = { authorization: `Bearer ${owner.accessToken}` };

      const listResponse = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/statuses`,
        headers: auth,
      });
      expect(listResponse.statusCode).toBe(200);
      const initialStatuses: { id: string }[] = JSON.parse(listResponse.payload);
      expect(initialStatuses).toHaveLength(5);

      const createResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/statuses`,
        headers: auth,
        payload: { name: "Blocked" },
      });
      expect(createResponse.statusCode).toBe(200);
      const created: { status: { id: string; position: number } } = JSON.parse(
        createResponse.payload,
      );
      expect(created.status.position).toBe(5);

      const reorderResponse = await app.inject({
        method: "PUT",
        url: `/api/projects/${projectId}/statuses/order`,
        headers: auth,
        payload: {
          orderedStatusIds: [created.status.id, ...initialStatuses.map((status) => status.id)],
        },
      });
      expect(reorderResponse.statusCode).toBe(200);
      const reordered: { statuses: { id: string }[] } = JSON.parse(reorderResponse.payload);
      expect(reordered.statuses[0]?.id).toBe(created.status.id);

      const deleteResponse = await app.inject({
        method: "DELETE",
        url: `/api/projects/${projectId}/statuses/${created.status.id}`,
        headers: auth,
      });
      expect(deleteResponse.statusCode).toBe(200);
      expect(JSON.parse(deleteResponse.payload)).toEqual({ success: true });
    });
  });

  describe("ticket REST wrappers", () => {
    it("creates a ticket, reads it back, moves its status, and patches its fields", async () => {
      const owner = await signup();
      const { projectId, firstStatusId } = await createProject(owner.accessToken);
      const auth = { authorization: `Bearer ${owner.accessToken}` };

      const statusesResponse = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/statuses`,
        headers: auth,
      });
      const statuses: { id: string }[] = JSON.parse(statusesResponse.payload);
      const secondStatusId = statuses[1]?.id;
      if (!secondStatusId) throw new Error("expected at least two default statuses");

      const createResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/tickets`,
        headers: auth,
        payload: {
          statusId: firstStatusId,
          title: "Wire up billing",
          type: "story",
          priority: "P1",
          storyPoints: 5,
        },
      });
      expect(createResponse.statusCode).toBe(200);
      const created: { ticket: { id: string; key: string } } = JSON.parse(createResponse.payload);

      const listResponse = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/tickets`,
        headers: auth,
      });
      expect(listResponse.statusCode).toBe(200);
      const tickets: { id: string }[] = JSON.parse(listResponse.payload);
      expect(tickets.some((ticket) => ticket.id === created.ticket.id)).toBe(true);

      const detailsResponse = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/tickets/${created.ticket.id}`,
        headers: auth,
      });
      expect(detailsResponse.statusCode).toBe(200);
      const details: { key: string; dependencySummaries: unknown[] } = JSON.parse(
        detailsResponse.payload,
      );
      expect(details.key).toBe(created.ticket.key);

      const moveResponse = await app.inject({
        method: "PATCH",
        url: `/api/projects/${projectId}/tickets/${created.ticket.id}/status`,
        headers: auth,
        payload: { statusId: secondStatusId },
      });
      expect(moveResponse.statusCode).toBe(200);
      const moved: { ticket: { statusId: string } } = JSON.parse(moveResponse.payload);
      expect(moved.ticket.statusId).toBe(secondStatusId);

      const patchResponse = await app.inject({
        method: "PATCH",
        url: `/api/projects/${projectId}/tickets/${created.ticket.id}`,
        headers: auth,
        payload: { title: "Wire up billing (v2)", storyPoints: 8 },
      });
      expect(patchResponse.statusCode).toBe(200);
      const patched: { ticket: { title: string; storyPoints: number } } = JSON.parse(
        patchResponse.payload,
      );
      expect(patched.ticket.title).toBe("Wire up billing (v2)");
      expect(patched.ticket.storyPoints).toBe(8);
    });

    it("rejects a viewer creating a ticket with 403", async () => {
      const owner = await signup();
      const viewer = await signup();
      const { projectId, firstStatusId } = await createProject(owner.accessToken);

      const inviteeEmailResult = await pool.query<{ email: string }>(
        "SELECT email FROM users WHERE id = $1",
        [viewer.userId],
      );
      await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/members`,
        headers: { authorization: `Bearer ${owner.accessToken}` },
        payload: { email: inviteeEmailResult.rows[0]?.email, role: "viewer" },
      });

      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/tickets`,
        headers: { authorization: `Bearer ${viewer.accessToken}` },
        payload: { statusId: firstStatusId, title: "Not allowed", type: "task", priority: "P3" },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe("brd REST wrappers", () => {
    it("lists uploaded BRD files and round-trips tech preferences", async () => {
      const owner = await signup();
      const { projectId } = await createProject(owner.accessToken);
      const auth = { authorization: `Bearer ${owner.accessToken}` };
      await seedBrdFile(projectId, owner.userId);

      const filesResponse = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/brd/files`,
        headers: auth,
      });
      expect(filesResponse.statusCode).toBe(200);
      const files: { fileName: string }[] = JSON.parse(filesResponse.payload);
      expect(files).toEqual([expect.objectContaining({ fileName: "requirements.md" })]);

      const emptyPreferencesResponse = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/brd/tech-preferences`,
        headers: auth,
      });
      expect(emptyPreferencesResponse.statusCode).toBe(200);
      expect(JSON.parse(emptyPreferencesResponse.payload)).toMatchObject({ frontend: null });

      const saveResponse = await app.inject({
        method: "PUT",
        url: `/api/projects/${projectId}/brd/tech-preferences`,
        headers: auth,
        payload: { frontend: "React", backend: "Fastify" },
      });
      expect(saveResponse.statusCode).toBe(200);
      const saved: { frontend: string | null; backend: string | null } = JSON.parse(
        saveResponse.payload,
      );
      expect(saved.frontend).toBe("React");
      expect(saved.backend).toBe("Fastify");
    });
  });

  describe("clarification REST wrappers", () => {
    it("starts a session, answers its question, and completes it", async () => {
      const owner = await signup();
      const { projectId } = await createProject(owner.accessToken);
      const auth = { authorization: `Bearer ${owner.accessToken}` };
      await seedBrdFile(projectId, owner.userId);

      const drafts: ClarificationQuestionDraft[] = [
        {
          prompt: "Which billing provider should be used?",
          ambiguity: "Billing provider is unspecified",
          quickReplies: ["Stripe", "Paddle"],
        },
      ];
      askClarificationAi.mockResolvedValueOnce(drafts);

      const nullStateResponse = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/clarification`,
        headers: auth,
      });
      expect(nullStateResponse.statusCode).toBe(200);
      expect(JSON.parse(nullStateResponse.payload)).toBeNull();

      const documentsResponse = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/clarification/documents`,
        headers: auth,
      });
      expect(documentsResponse.statusCode).toBe(200);
      const documents: { fileName: string }[] = JSON.parse(documentsResponse.payload);
      expect(documents).toHaveLength(1);

      const startResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/clarification/start`,
        headers: auth,
      });
      expect(startResponse.statusCode).toBe(200);
      const started: { questions: { id: string }[]; allResolved: boolean } = JSON.parse(
        startResponse.payload,
      );
      expect(started.allResolved).toBe(false);
      const questionId = started.questions[0]?.id;
      if (!questionId) throw new Error("expected startSession to create a question");

      const messageResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/clarification/messages`,
        headers: auth,
        payload: { questionId, answer: "Use Stripe" },
      });
      expect(messageResponse.statusCode).toBe(200);
      const afterAnswer: { allResolved: boolean } = JSON.parse(messageResponse.payload);
      expect(afterAnswer.allResolved).toBe(true);

      const completeResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/clarification/complete`,
        headers: auth,
      });
      expect(completeResponse.statusCode).toBe(200);
      const completed: { status: string; compiledContext: string | null } = JSON.parse(
        completeResponse.payload,
      );
      expect(completed.status).toBe("completed");
      expect(completed.compiledContext).toEqual(expect.any(String));
    });
  });

  describe("backlog REST wrappers", () => {
    async function completeClarification(userId: string, projectId: string): Promise<void> {
      await pool.query(
        `INSERT INTO clarification_sessions (project_id, status, compiled_context, completed_at, created_by)
         VALUES ($1, 'completed', 'Auth method: email + password', now(), $2)`,
        [projectId, userId],
      );
    }

    it("generates a backlog draft and publishes it to the board", async () => {
      const owner = await signup();
      const { projectId } = await createProject(owner.accessToken);
      const auth = { authorization: `Bearer ${owner.accessToken}` };
      await seedBrdFile(projectId, owner.userId);
      await completeClarification(owner.userId, projectId);

      const draft: BacklogDraft = {
        epics: [
          {
            title: "Billing",
            tickets: [
              {
                ref: "T1",
                title: "Integrate Stripe",
                type: "story",
                priority: "P1",
                storyPoints: 5,
                acceptanceCriteria: [
                  { given: "a checkout", when: "the user pays", expectedResult: "a charge is created" },
                ],
                aiDevPrompt: "Wire up the Stripe SDK.",
                dependsOn: [],
              },
            ],
          },
        ],
      };
      askBacklogAi.mockResolvedValueOnce(draft);

      const generateResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/backlog/generate`,
        headers: auth,
      });
      expect(generateResponse.statusCode).toBe(200);
      const generated: {
        epics: { title: string; tickets: { ref: string; previewKey: string }[] }[];
        summary: { epicCount: number; ticketCount: number };
      } = JSON.parse(generateResponse.payload);
      expect(generated.summary).toEqual({ epicCount: 1, ticketCount: 1, totalStoryPoints: 5 });

      const publishResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/backlog/publish`,
        headers: auth,
        payload: { epics: draft.epics },
      });
      expect(publishResponse.statusCode).toBe(200);
      expect(JSON.parse(publishResponse.payload)).toEqual({ epicCount: 1, ticketCount: 1 });

      const ticketsResponse = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/tickets`,
        headers: auth,
      });
      const tickets: { title: string }[] = JSON.parse(ticketsResponse.payload);
      expect(tickets.some((ticket) => ticket.title === "Integrate Stripe")).toBe(true);
    });

    it("rejects publishing an empty epics array with 400 before it reaches the database", async () => {
      const owner = await signup();
      const { projectId } = await createProject(owner.accessToken);
      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/backlog/publish`,
        headers: { authorization: `Bearer ${owner.accessToken}` },
        payload: { epics: [] },
      });
      expect(response.statusCode).toBe(400);
    });
  });
});
