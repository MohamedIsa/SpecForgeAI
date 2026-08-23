import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestCaller } from "../test-utils";
import { pool } from "../db/pool";
import {
  requestBacklogGeneration,
  type BacklogDraft,
} from "../services/backlog-generator";
import { AiUnavailableError, AiResponseError, AiConfigurationError } from "../services/ai";

vi.mock("../services/backlog-generator", async () => {
  const actual = await vi.importActual<typeof import("../services/backlog-generator")>(
    "../services/backlog-generator",
  );
  return { ...actual, requestBacklogGeneration: vi.fn() };
});

const generateMock = vi.mocked(requestBacklogGeneration);

function createCaller(userId: string | null) {
  return createTestCaller(userId).caller;
}

function uniqueEmail(): string {
  return `backlog-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueKey(): string {
  return `B${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

const createdUserIds: string[] = [];
const tempDirs: string[] = [];

async function createUser(fullName: string): Promise<{ id: string; email: string }> {
  const email = uniqueEmail();
  const result = await createCaller(null).auth.signup({
    fullName,
    email,
    password: "a-strong-password",
  });
  createdUserIds.push(result.user.id);
  return { id: result.user.id, email };
}

async function createProject(ownerId: string): Promise<string> {
  const created = await createCaller(ownerId).project.createProject({
    name: "Backlog Test Project",
    key: uniqueKey(),
    template: "kanban",
  });
  return created.project.id;
}

async function addBrdFile(
  projectId: string,
  userId: string,
  fileName = "requirements.md",
  content = "Users must be able to log in.",
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "specforge-backlog-"));
  tempDirs.push(dir);
  const storagePath = join(dir, fileName);
  await writeFile(storagePath, content, "utf8");

  await pool.query(
    `INSERT INTO brd_files
       (project_id, file_name, extension, byte_size, checksum, storage_path, scan_status, uploaded_by)
     VALUES ($1, $2, 'md', $3, $4, $5, 'clean', $6)`,
    [
      projectId,
      fileName,
      Buffer.byteLength(content),
      Math.random().toString(36).slice(2),
      storagePath,
      userId,
    ],
  );
}

/** Completes clarification with a single resolved question so the project has a compiled context. */
async function completeClarification(userId: string, projectId: string): Promise<void> {
  await pool.query(
    `INSERT INTO clarification_sessions (project_id, status, compiled_context, completed_at, created_by)
     VALUES ($1, 'completed', 'Auth method: email + password', now(), $2)`,
    [projectId, userId],
  );
}

const draft: BacklogDraft = {
  epics: [
    {
      title: "Authentication",
      tickets: [
        {
          ref: "T1",
          title: "Add login form",
          type: "story",
          priority: "P1",
          storyPoints: 3,
          acceptanceCriteria: [
            { given: "a visitor", when: "they submit valid credentials", expectedResult: "they are logged in" },
          ],
          aiDevPrompt: "Implement a login form with email and password fields.",
          dependsOn: [],
        },
        {
          ref: "T2",
          title: "Add password reset",
          type: "story",
          priority: "P2",
          storyPoints: 5,
          acceptanceCriteria: [
            { given: "a user forgot their password", when: "they request a reset", expectedResult: "they receive an email" },
          ],
          aiDevPrompt: "Implement a password reset flow triggered by email.",
          dependsOn: ["T1"],
        },
      ],
    },
  ],
};

beforeEach(() => {
  generateMock.mockReset();
  generateMock.mockResolvedValue(draft);
});

afterEach(async () => {
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop();
    await pool.query("DELETE FROM users WHERE id = $1", [id]);
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("backlogRouter.generateBacklog", () => {
  it("returns epics with preview keys and a computed summary", async () => {
    const owner = await createUser("Generate Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);
    await completeClarification(owner.id, projectId);

    const result = await createCaller(owner.id).backlog.generateBacklog({ projectId });

    expect(result.summary).toEqual({ epicCount: 1, ticketCount: 2, totalStoryPoints: 8 });
    expect(result.epics).toHaveLength(1);
    const [ticket1, ticket2] = result.epics[0]?.tickets ?? [];
    expect(ticket1?.previewKey).toMatch(/^[A-Z0-9]+-101$/);
    expect(ticket2?.previewKey).toMatch(/^[A-Z0-9]+-102$/);
    expect(ticket2?.dependsOnPreviewKeys).toEqual([ticket1?.previewKey]);
  });

  it("passes the BRD text, clarification context and tech preferences to the AI", async () => {
    const owner = await createUser("Generate Prompt Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id, "spec.md", "The API must return JSON.");
    await completeClarification(owner.id, projectId);
    await createCaller(owner.id).brd.saveTechPreferences({
      projectId,
      frontend: "React",
      backend: "Fastify",
      database: "PostgreSQL",
      infra: null,
    });

    await createCaller(owner.id).backlog.generateBacklog({ projectId });

    expect(generateMock).toHaveBeenCalledTimes(1);
    const call = generateMock.mock.calls[0]?.[0];
    expect(call?.brdText).toContain("The API must return JSON.");
    expect(call?.clarificationContext).toBe("Auth method: email + password");
    expect(call?.techPreferences).toMatchObject({ frontend: "React", backend: "Fastify" });
  });

  it("rejects generation before clarification has completed", async () => {
    const owner = await createUser("No Clarification Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);

    await expect(
      createCaller(owner.id).backlog.generateBacklog({ projectId }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("maps an AI outage to SERVICE_UNAVAILABLE", async () => {
    const owner = await createUser("Outage Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);
    await completeClarification(owner.id, projectId);
    generateMock.mockRejectedValue(new AiUnavailableError("upstream 502"));

    await expect(
      createCaller(owner.id).backlog.generateBacklog({ projectId }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("maps an unusable payload to BAD_GATEWAY", async () => {
    const owner = await createUser("Bad Payload Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);
    await completeClarification(owner.id, projectId);
    generateMock.mockRejectedValue(new AiResponseError("not json"));

    await expect(
      createCaller(owner.id).backlog.generateBacklog({ projectId }),
    ).rejects.toMatchObject({ code: "BAD_GATEWAY" });
  });

  it("maps a missing API key to INTERNAL_SERVER_ERROR without leaking details", async () => {
    const owner = await createUser("Config Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);
    await completeClarification(owner.id, projectId);
    generateMock.mockRejectedValue(new AiConfigurationError("DEEPSEEK_API_KEY is not set"));

    await expect(
      createCaller(owner.id).backlog.generateBacklog({ projectId }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "The AI service is not configured. Contact an administrator.",
    });
  });

  it("rejects a viewer with FORBIDDEN", async () => {
    const owner = await createUser("Viewer Owner");
    const viewer = await createUser("Viewer");
    const projectId = await createProject(owner.id);
    await createCaller(owner.id).project.inviteMember({
      projectId,
      email: viewer.email,
      role: "viewer",
    });
    await addBrdFile(projectId, owner.id);
    await completeClarification(owner.id, projectId);

    await expect(
      createCaller(viewer.id).backlog.generateBacklog({ projectId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a non-member with FORBIDDEN", async () => {
    const owner = await createUser("Outsider Owner");
    const outsider = await createUser("Outsider");
    const projectId = await createProject(owner.id);

    await expect(
      createCaller(outsider.id).backlog.generateBacklog({ projectId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    await expect(
      createCaller(null).backlog.generateBacklog({
        projectId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("backlogRouter.publishBacklogToBoard", () => {
  it("inserts every epic and ticket, resolving dependencies to real ids", async () => {
    const owner = await createUser("Publish Owner");
    const projectId = await createProject(owner.id);

    const result = await createCaller(owner.id).backlog.publishBacklogToBoard({
      projectId,
      ...draft,
    });

    expect(result).toEqual({ epicCount: 1, ticketCount: 2 });

    const epicsResult = await pool.query<{ id: string; title: string }>(
      "SELECT id, title FROM epics WHERE project_id = $1",
      [projectId],
    );
    expect(epicsResult.rows).toHaveLength(1);
    expect(epicsResult.rows[0]?.title).toBe("Authentication");

    const ticketsResult = await pool.query<{
      key: string;
      title: string;
      epic_id: string;
      dependencies: string[];
      acceptance_criteria: Array<{ checked: boolean }>;
    }>(
      "SELECT key, title, epic_id, dependencies, acceptance_criteria FROM tickets WHERE project_id = $1 ORDER BY key ASC",
      [projectId],
    );
    expect(ticketsResult.rows).toHaveLength(2);
    const [first, second] = ticketsResult.rows;
    expect(first?.epic_id).toBe(epicsResult.rows[0]?.id);
    expect(first?.acceptance_criteria[0]?.checked).toBe(false);
    expect(second?.dependencies).toEqual([
      (await pool.query("SELECT id FROM tickets WHERE key = $1", [first?.key])).rows[0]?.id,
    ]);
  });

  it("places every published ticket in the project's first status column", async () => {
    const owner = await createUser("Publish Status Owner");
    const projectId = await createProject(owner.id);
    const statuses = await createCaller(owner.id).status.getProjectStatuses({ projectId });
    const firstStatusId = statuses[0]?.id;

    await createCaller(owner.id).backlog.publishBacklogToBoard({ projectId, ...draft });

    const ticketsResult = await pool.query<{ status_id: string }>(
      "SELECT status_id FROM tickets WHERE project_id = $1",
      [projectId],
    );
    expect(ticketsResult.rows.every((row) => row.status_id === firstStatusId)).toBe(true);
  });

  it("assigns sequential keys continuing from the project's ticket counter", async () => {
    const owner = await createUser("Publish Sequence Owner");
    const projectId = await createProject(owner.id);
    await createCaller(owner.id).ticket.createTicket({
      projectId,
      statusId: (await createCaller(owner.id).status.getProjectStatuses({ projectId }))[0]!.id,
      title: "Existing ticket",
      type: "task",
      priority: "P3",
    });

    await createCaller(owner.id).backlog.publishBacklogToBoard({ projectId, ...draft });

    const keysResult = await pool.query<{ key: string }>(
      "SELECT key FROM tickets WHERE project_id = $1 ORDER BY key ASC",
      [projectId],
    );
    const keys = keysResult.rows.map((row) => row.key);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
  });

  it("does nothing when a duplicate ticket ref is submitted", async () => {
    const owner = await createUser("Publish Duplicate Owner");
    const projectId = await createProject(owner.id);
    const tampered: BacklogDraft = {
      epics: [
        {
          title: "Epic",
          tickets: [draft.epics[0]!.tickets[0]!, { ...draft.epics[0]!.tickets[0]!, dependsOn: [] }],
        },
      ],
    };

    await expect(
      createCaller(owner.id).backlog.publishBacklogToBoard({ projectId, ...tampered }),
    ).rejects.toThrow(/duplicate ticket reference/);

    const ticketsResult = await pool.query("SELECT id FROM tickets WHERE project_id = $1", [
      projectId,
    ]);
    expect(ticketsResult.rows).toHaveLength(0);
  });

  it("rolls back every insert when one ticket in the batch is invalid", async () => {
    const owner = await createUser("Publish Rollback Owner");
    const projectId = await createProject(owner.id);
    const invalid: BacklogDraft = {
      epics: [
        {
          title: "Epic",
          // storyPoints of -1 fails the zod schema at the input boundary.
          tickets: [{ ...draft.epics[0]!.tickets[0]!, storyPoints: -1 }],
        },
      ],
    };

    await expect(
      createCaller(owner.id).backlog.publishBacklogToBoard({ projectId, ...invalid }),
    ).rejects.toThrow();

    const epicsResult = await pool.query("SELECT id FROM epics WHERE project_id = $1", [
      projectId,
    ]);
    expect(epicsResult.rows).toHaveLength(0);
  });

  it("rejects a viewer with FORBIDDEN", async () => {
    const owner = await createUser("Publish Viewer Owner");
    const viewer = await createUser("Publish Viewer");
    const projectId = await createProject(owner.id);
    await createCaller(owner.id).project.inviteMember({
      projectId,
      email: viewer.email,
      role: "viewer",
    });

    await expect(
      createCaller(viewer.id).backlog.publishBacklogToBoard({ projectId, ...draft }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const ticketsResult = await pool.query("SELECT id FROM tickets WHERE project_id = $1", [
      projectId,
    ]);
    expect(ticketsResult.rows).toHaveLength(0);
  });

  it("rejects a non-member with FORBIDDEN", async () => {
    const owner = await createUser("Publish Outsider Owner");
    const outsider = await createUser("Publish Outsider");
    const projectId = await createProject(owner.id);

    await expect(
      createCaller(outsider.id).backlog.publishBacklogToBoard({ projectId, ...draft }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not leak tickets into another project", async () => {
    const owner = await createUser("Publish Isolation Owner");
    const projectA = await createProject(owner.id);
    const projectB = await createProject(owner.id);

    await createCaller(owner.id).backlog.publishBacklogToBoard({ projectId: projectA, ...draft });

    const projectBTickets = await pool.query("SELECT id FROM tickets WHERE project_id = $1", [
      projectB,
    ]);
    expect(projectBTickets.rows).toHaveLength(0);
  });

  it("assigns every ticket a unique key when two publishes race", async () => {
    const owner = await createUser("Publish Race Owner");
    const projectId = await createProject(owner.id);

    await Promise.all([
      createCaller(owner.id).backlog.publishBacklogToBoard({ projectId, ...draft }),
      createCaller(owner.id).backlog.publishBacklogToBoard({ projectId, ...draft }),
    ]);

    const ticketsResult = await pool.query<{ key: string }>(
      "SELECT key FROM tickets WHERE project_id = $1",
      [projectId],
    );
    expect(ticketsResult.rows).toHaveLength(4);
    expect(new Set(ticketsResult.rows.map((row) => row.key)).size).toBe(4);
  });

  it("supports publishing twice, appending a second batch of epics and tickets", async () => {
    const owner = await createUser("Publish Twice Owner");
    const projectId = await createProject(owner.id);

    await createCaller(owner.id).backlog.publishBacklogToBoard({ projectId, ...draft });
    await createCaller(owner.id).backlog.publishBacklogToBoard({ projectId, ...draft });

    const epicsResult = await pool.query("SELECT id FROM epics WHERE project_id = $1", [
      projectId,
    ]);
    const ticketsResult = await pool.query<{ key: string }>(
      "SELECT key FROM tickets WHERE project_id = $1",
      [projectId],
    );
    expect(epicsResult.rows).toHaveLength(2);
    expect(ticketsResult.rows).toHaveLength(4);
    expect(new Set(ticketsResult.rows.map((row) => row.key)).size).toBe(4);
  });
});
