import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestCaller } from "../test-utils";
import { pool } from "../db/pool";
import {
  requestClarificationQuestions,
  AiUnavailableError,
  AiResponseError,
  AiConfigurationError,
  type ClarificationQuestionDraft,
} from "../services/ai";
import { compileSpecificationContext } from "./clarification";

// Only the network-facing call is faked; the error classes stay real so the
// router's mapping is exercised against the types it will see in production.
vi.mock("../services/ai", async () => {
  const actual = await vi.importActual<typeof import("../services/ai")>("../services/ai");
  return { ...actual, requestClarificationQuestions: vi.fn() };
});

const askAi = vi.mocked(requestClarificationQuestions);

function createCaller(userId: string | null) {
  return createTestCaller(userId).caller;
}

function uniqueEmail(): string {
  return `clarify-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueKey(): string {
  return `C${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
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
    name: "Clarification Test Project",
    key: uniqueKey(),
    template: "kanban",
  });
  return created.project.id;
}

/** Writes a real markdown BRD to disk and registers it as a clean upload. */
async function addBrdFile(
  projectId: string,
  userId: string,
  fileName = "requirements.md",
  content = "The system must authenticate users.\nBilling should support refunds.",
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "specforge-clarify-"));
  tempDirs.push(dir);
  const storagePath = join(dir, fileName);
  await writeFile(storagePath, content, "utf8");

  const result = await pool.query<{ id: string }>(
    `INSERT INTO brd_files
       (project_id, file_name, extension, byte_size, checksum, storage_path, scan_status, uploaded_by)
     VALUES ($1, $2, 'md', $3, $4, $5, 'clean', $6)
     RETURNING id`,
    [
      projectId,
      fileName,
      Buffer.byteLength(content),
      Math.random().toString(36).slice(2),
      storagePath,
      userId,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Failed to seed BRD file");
  return id;
}

const drafts: ClarificationQuestionDraft[] = [
  {
    ambiguity: "Auth method",
    prompt: "Which authentication method should be used?",
    quickReplies: ["Email + password", "SSO"],
  },
  {
    ambiguity: "Refund window",
    prompt: "How long can a customer request a refund?",
    quickReplies: ["14 days", "30 days"],
  },
];

beforeEach(() => {
  askAi.mockReset();
  askAi.mockResolvedValue(drafts);
});

afterEach(async () => {
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop();
    // Cascades to projects, memberships, BRD files and clarification rows.
    await pool.query("DELETE FROM users WHERE id = $1", [id]);
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

/** Starts a session and answers every question, leaving it fully resolved. */
async function resolveAll(userId: string, projectId: string): Promise<void> {
  const session = await createCaller(userId).clarification.startSession({ projectId });
  for (const question of session.questions) {
    await createCaller(userId).clarification.sendMessage({
      projectId,
      questionId: question.id,
      answer: `Answer for ${question.ambiguity}`,
    });
  }
}

describe("clarificationRouter.startSession", () => {
  it("creates a session with one question and AI message per ambiguity", async () => {
    const owner = await createUser("Start Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);

    const session = await createCaller(owner.id).clarification.startSession({ projectId });

    expect(session.status).toBe("active");
    expect(session.projectId).toBe(projectId);
    expect(session.questions).toHaveLength(2);
    expect(session.questions[0]?.prompt).toBe(drafts[0]?.prompt);
    expect(session.questions[0]?.quickReplies).toEqual(["Email + password", "SSO"]);
    expect(session.questions[0]?.position).toBe(0);
    expect(session.questions[1]?.position).toBe(1);
    expect(session.messages).toHaveLength(2);
    expect(session.messages.every((message) => message.role === "ai")).toBe(true);
    expect(session.resolvedCount).toBe(0);
    expect(session.totalCount).toBe(2);
    expect(session.allResolved).toBe(false);
  });

  it("passes the extracted BRD text and tech preferences to the AI", async () => {
    const owner = await createUser("Prompt Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id, "spec.md", "The API must return JSON.");
    await createCaller(owner.id).brd.saveTechPreferences({
      projectId,
      frontend: "React",
      backend: "Fastify",
      database: "PostgreSQL",
      infra: "AWS",
    });

    await createCaller(owner.id).clarification.startSession({ projectId });

    expect(askAi).toHaveBeenCalledTimes(1);
    const call = askAi.mock.calls[0]?.[0];
    expect(call?.brdText).toContain("The API must return JSON.");
    expect(call?.brdText).toContain("spec.md");
    expect(call?.techPreferences).toMatchObject({
      frontend: "React",
      backend: "Fastify",
      database: "PostgreSQL",
      infra: "AWS",
    });
  });

  it("reuses the active session instead of burning a second AI call", async () => {
    const owner = await createUser("Reuse Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);

    const first = await createCaller(owner.id).clarification.startSession({ projectId });
    const second = await createCaller(owner.id).clarification.startSession({ projectId });

    expect(second.id).toBe(first.id);
    expect(askAi).toHaveBeenCalledTimes(1);
  });

  it("returns a single shared session when two starts race", async () => {
    const owner = await createUser("Race Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);

    const [a, b] = await Promise.all([
      createCaller(owner.id).clarification.startSession({ projectId }),
      createCaller(owner.id).clarification.startSession({ projectId }),
    ]);

    expect(a.id).toBe(b.id);
    const rows = await pool.query(
      "SELECT id FROM clarification_sessions WHERE project_id = $1 AND status = 'active'",
      [projectId],
    );
    expect(rows.rows).toHaveLength(1);
  });

  it("rejects starting without any uploaded BRD", async () => {
    const owner = await createUser("No BRD Owner");
    const projectId = await createProject(owner.id);

    await expect(
      createCaller(owner.id).clarification.startSession({ projectId }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(askAi).not.toHaveBeenCalled();
  });

  it("rejects a BRD whose text cannot be extracted, naming the file", async () => {
    const owner = await createUser("Unreadable Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id, "broken.md");
    // Point the row at a path that no longer exists.
    await pool.query("UPDATE brd_files SET storage_path = $1 WHERE project_id = $2", [
      join(tmpdir(), "specforge-missing", "broken.md"),
      projectId,
    ]);

    await expect(
      createCaller(owner.id).clarification.startSession({ projectId }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("broken.md") });
  });

  it("rejects a BRD that contains no readable text", async () => {
    const owner = await createUser("Blank Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id, "blank.md", "   ");

    await expect(
      createCaller(owner.id).clarification.startSession({ projectId }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("clarificationRouter.startSession — AI failure mapping", () => {
  it("maps an outage to SERVICE_UNAVAILABLE and stores nothing", async () => {
    const owner = await createUser("Outage Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);
    askAi.mockRejectedValue(new AiUnavailableError("upstream 502"));

    await expect(
      createCaller(owner.id).clarification.startSession({ projectId }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });

    const rows = await pool.query("SELECT id FROM clarification_sessions WHERE project_id = $1", [
      projectId,
    ]);
    expect(rows.rows).toHaveLength(0);
  });

  it("maps an unusable payload to BAD_GATEWAY", async () => {
    const owner = await createUser("Bad Payload Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);
    askAi.mockRejectedValue(new AiResponseError("not json"));

    await expect(
      createCaller(owner.id).clarification.startSession({ projectId }),
    ).rejects.toMatchObject({ code: "BAD_GATEWAY" });
  });

  it("maps a missing API key to INTERNAL_SERVER_ERROR without leaking details", async () => {
    const owner = await createUser("Config Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);
    askAi.mockRejectedValue(new AiConfigurationError("DEEPSEEK_API_KEY is not set"));

    await expect(
      createCaller(owner.id).clarification.startSession({ projectId }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "The AI service is not configured. Contact an administrator.",
    });
  });
});

describe("clarificationRouter.startSession — access control", () => {
  it("rejects an unauthenticated caller", async () => {
    await expect(
      createCaller(null).clarification.startSession({
        projectId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects a non-member with FORBIDDEN", async () => {
    const owner = await createUser("Start Forbidden Owner");
    const outsider = await createUser("Start Forbidden Outsider");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);

    await expect(
      createCaller(outsider.id).clarification.startSession({ projectId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(askAi).not.toHaveBeenCalled();
  });

  it("rejects a viewer with FORBIDDEN", async () => {
    const owner = await createUser("Start Viewer Owner");
    const viewer = await createUser("Start Viewer");
    const projectId = await createProject(owner.id);
    await createCaller(owner.id).project.inviteMember({
      projectId,
      email: viewer.email,
      role: "viewer",
    });
    await addBrdFile(projectId, owner.id);

    await expect(
      createCaller(viewer.id).clarification.startSession({ projectId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows an editor to start the session", async () => {
    const owner = await createUser("Start Editor Owner");
    const editor = await createUser("Start Editor");
    const projectId = await createProject(owner.id);
    await createCaller(owner.id).project.inviteMember({
      projectId,
      email: editor.email,
      role: "editor",
    });
    await addBrdFile(projectId, owner.id);

    const session = await createCaller(editor.id).clarification.startSession({ projectId });
    expect(session.questions).toHaveLength(2);
  });
});

describe("clarificationRouter.getSessionState", () => {
  it("returns null before any session exists", async () => {
    const owner = await createUser("State Empty Owner");
    const projectId = await createProject(owner.id);
    expect(await createCaller(owner.id).clarification.getSessionState({ projectId })).toBeNull();
  });

  it("lets a viewer read the session state", async () => {
    const owner = await createUser("State Viewer Owner");
    const viewer = await createUser("State Viewer");
    const projectId = await createProject(owner.id);
    await createCaller(owner.id).project.inviteMember({
      projectId,
      email: viewer.email,
      role: "viewer",
    });
    await addBrdFile(projectId, owner.id);
    await createCaller(owner.id).clarification.startSession({ projectId });

    const state = await createCaller(viewer.id).clarification.getSessionState({ projectId });
    expect(state?.totalCount).toBe(2);
  });

  it("does not leak another project's session", async () => {
    const owner = await createUser("State Isolation Owner");
    const projectA = await createProject(owner.id);
    const projectB = await createProject(owner.id);
    await addBrdFile(projectA, owner.id);
    await createCaller(owner.id).clarification.startSession({ projectId: projectA });

    expect(
      await createCaller(owner.id).clarification.getSessionState({ projectId: projectB }),
    ).toBeNull();
  });

  it("rejects a non-member with FORBIDDEN", async () => {
    const owner = await createUser("State Forbidden Owner");
    const outsider = await createUser("State Forbidden Outsider");
    const projectId = await createProject(owner.id);

    await expect(
      createCaller(outsider.id).clarification.getSessionState({ projectId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("clarificationRouter.getBrdDocuments", () => {
  it("returns paged text for every stored BRD", async () => {
    const owner = await createUser("Docs Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id, "one.md", "The system must log audits.");

    const documents = await createCaller(owner.id).clarification.getBrdDocuments({ projectId });
    expect(documents).toHaveLength(1);
    expect(documents[0]?.fileName).toBe("one.md");
    expect(documents[0]?.extension).toBe("md");
    expect(documents[0]?.pages[0]?.text).toContain("The system must log audits.");
  });

  it("returns an empty list rather than an error when no BRD has been uploaded", async () => {
    const owner = await createUser("Docs Empty Owner");
    const projectId = await createProject(owner.id);

    await expect(
      createCaller(owner.id).clarification.getBrdDocuments({ projectId }),
    ).resolves.toEqual([]);
  });

  it("still lists a blank BRD instead of failing the whole request", async () => {
    const owner = await createUser("Docs Blank Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id, "blank.md", "   ");

    const documents = await createCaller(owner.id).clarification.getBrdDocuments({ projectId });
    expect(documents).toHaveLength(1);
    expect(documents[0]?.fileName).toBe("blank.md");
  });

  it("represents an unreadable file as a document with no readable pages", async () => {
    const owner = await createUser("Docs Unreadable Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id, "broken.md");
    await pool.query("UPDATE brd_files SET storage_path = $1 WHERE project_id = $2", [
      join(tmpdir(), "specforge-missing", "broken.md"),
      projectId,
    ]);

    const documents = await createCaller(owner.id).clarification.getBrdDocuments({ projectId });
    expect(documents).toHaveLength(1);
    expect(documents[0]?.fileName).toBe("broken.md");
    expect(documents[0]?.pages).toEqual([{ pageNumber: 1, text: "" }]);
  });

  it("does not let one unreadable file blank out the others", async () => {
    const owner = await createUser("Docs Partial Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id, "readable.md", "The system must log in users.");
    await addBrdFile(projectId, owner.id, "broken.md");
    await pool.query(
      "UPDATE brd_files SET storage_path = $1 WHERE project_id = $2 AND file_name = 'broken.md'",
      [join(tmpdir(), "specforge-missing", "broken.md"), projectId],
    );

    const documents = await createCaller(owner.id).clarification.getBrdDocuments({ projectId });
    expect(documents).toHaveLength(2);
    const readable = documents.find((doc) => doc.fileName === "readable.md");
    const broken = documents.find((doc) => doc.fileName === "broken.md");
    expect(readable?.pages[0]?.text).toContain("The system must log in users.");
    expect(broken?.pages).toEqual([{ pageNumber: 1, text: "" }]);
  });

  it("rejects a non-member with FORBIDDEN", async () => {
    const owner = await createUser("Docs Forbidden Owner");
    const outsider = await createUser("Docs Forbidden Outsider");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);

    await expect(
      createCaller(outsider.id).clarification.getBrdDocuments({ projectId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("clarificationRouter.sendMessage", () => {
  it("records the answer, resolves the question and asks the next one", async () => {
    const owner = await createUser("Send Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);
    const started = await createCaller(owner.id).clarification.startSession({ projectId });
    const first = started.questions[0];
    if (!first) throw new Error("expected a question");

    const state = await createCaller(owner.id).clarification.sendMessage({
      projectId,
      questionId: first.id,
      answer: "SSO",
    });

    const resolved = state.questions.find((question) => question.id === first.id);
    expect(resolved?.resolved).toBe(true);
    expect(resolved?.answer).toBe("SSO");
    expect(state.resolvedCount).toBe(1);
    expect(state.allResolved).toBe(false);

    const userMessages = state.messages.filter((message) => message.role === "user");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]?.content).toBe("SSO");
    expect(state.messages.at(-1)?.role).toBe("ai");
    expect(state.messages.at(-1)?.content).toContain(drafts[1]?.prompt ?? "");
  });

  it("closes out with a completion message once the last question is answered", async () => {
    const owner = await createUser("Send Last Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);
    const started = await createCaller(owner.id).clarification.startSession({ projectId });

    let state = started;
    for (const question of started.questions) {
      state = await createCaller(owner.id).clarification.sendMessage({
        projectId,
        questionId: question.id,
        answer: "Decided",
      });
    }

    expect(state.allResolved).toBe(true);
    expect(state.resolvedCount).toBe(2);
    expect(state.messages.at(-1)?.content).toContain("every ambiguity is resolved");
    expect(state.messages.at(-1)?.questionId).toBeNull();
  });

  it("keeps the original resolution timestamp when an answer is revised", async () => {
    const owner = await createUser("Revise Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);
    const started = await createCaller(owner.id).clarification.startSession({ projectId });
    const first = started.questions[0];
    if (!first) throw new Error("expected a question");

    await createCaller(owner.id).clarification.sendMessage({
      projectId,
      questionId: first.id,
      answer: "SSO",
    });
    const before = await pool.query<{ resolved_at: Date }>(
      "SELECT resolved_at FROM clarification_questions WHERE id = $1",
      [first.id],
    );

    const state = await createCaller(owner.id).clarification.sendMessage({
      projectId,
      questionId: first.id,
      answer: "Email + password",
    });
    const after = await pool.query<{ resolved_at: Date }>(
      "SELECT resolved_at FROM clarification_questions WHERE id = $1",
      [first.id],
    );

    expect(state.questions.find((question) => question.id === first.id)?.answer).toBe(
      "Email + password",
    );
    expect(after.rows[0]?.resolved_at.toISOString()).toBe(
      before.rows[0]?.resolved_at.toISOString(),
    );
  });

  it("rejects a question id belonging to another project's session", async () => {
    const owner = await createUser("Cross Session Owner");
    const projectA = await createProject(owner.id);
    const projectB = await createProject(owner.id);
    await addBrdFile(projectA, owner.id);
    await addBrdFile(projectB, owner.id);
    const sessionA = await createCaller(owner.id).clarification.startSession({
      projectId: projectA,
    });
    await createCaller(owner.id).clarification.startSession({ projectId: projectB });
    const foreignQuestionId = sessionA.questions[0]?.id;
    if (!foreignQuestionId) throw new Error("expected a question");

    await expect(
      createCaller(owner.id).clarification.sendMessage({
        projectId: projectB,
        questionId: foreignQuestionId,
        answer: "Injected",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const stillOpen = await createCaller(owner.id).clarification.getSessionState({
      projectId: projectA,
    });
    expect(stillOpen?.resolvedCount).toBe(0);
  });

  it("rejects sending when there is no active session", async () => {
    const owner = await createUser("Send No Session Owner");
    const projectId = await createProject(owner.id);

    await expect(
      createCaller(owner.id).clarification.sendMessage({
        projectId,
        questionId: "00000000-0000-0000-0000-000000000000",
        answer: "Anything",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a blank answer at validation", async () => {
    const owner = await createUser("Blank Answer Owner");
    const projectId = await createProject(owner.id);

    await expect(
      createCaller(owner.id).clarification.sendMessage({
        projectId,
        questionId: "00000000-0000-0000-0000-000000000000",
        answer: "   ",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a viewer with FORBIDDEN and leaves the question open", async () => {
    const owner = await createUser("Send Viewer Owner");
    const viewer = await createUser("Send Viewer");
    const projectId = await createProject(owner.id);
    await createCaller(owner.id).project.inviteMember({
      projectId,
      email: viewer.email,
      role: "viewer",
    });
    await addBrdFile(projectId, owner.id);
    const started = await createCaller(owner.id).clarification.startSession({ projectId });
    const first = started.questions[0];
    if (!first) throw new Error("expected a question");

    await expect(
      createCaller(viewer.id).clarification.sendMessage({
        projectId,
        questionId: first.id,
        answer: "SSO",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const state = await createCaller(owner.id).clarification.getSessionState({ projectId });
    expect(state?.resolvedCount).toBe(0);
  });

  it("rejects a non-member with FORBIDDEN", async () => {
    const owner = await createUser("Send Outsider Owner");
    const outsider = await createUser("Send Outsider");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);
    const started = await createCaller(owner.id).clarification.startSession({ projectId });
    const first = started.questions[0];
    if (!first) throw new Error("expected a question");

    await expect(
      createCaller(outsider.id).clarification.sendMessage({
        projectId,
        questionId: first.id,
        answer: "SSO",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("clarificationRouter.completeSession", () => {
  it("refuses while any ambiguity is unresolved", async () => {
    const owner = await createUser("Complete Gate Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);
    const started = await createCaller(owner.id).clarification.startSession({ projectId });
    const first = started.questions[0];
    if (!first) throw new Error("expected a question");
    await createCaller(owner.id).clarification.sendMessage({
      projectId,
      questionId: first.id,
      answer: "SSO",
    });

    await expect(
      createCaller(owner.id).clarification.completeSession({ projectId }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    const state = await createCaller(owner.id).clarification.getSessionState({ projectId });
    expect(state?.status).toBe("active");
    expect(state?.compiledContext).toBeNull();
  });

  it("completes and persists the compiled specification context", async () => {
    const owner = await createUser("Complete Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);
    await createCaller(owner.id).brd.saveTechPreferences({
      projectId,
      frontend: "React",
      backend: "Fastify",
      database: "PostgreSQL",
      infra: null,
    });
    await resolveAll(owner.id, projectId);

    const completed = await createCaller(owner.id).clarification.completeSession({ projectId });

    expect(completed.status).toBe("completed");
    expect(completed.completedAt).not.toBeNull();
    expect(completed.compiledContext).toContain("Auth method");
    expect(completed.compiledContext).toContain("Answer for Auth method");
    expect(completed.compiledContext).toContain("- Frontend: React");
    expect(completed.compiledContext).not.toContain("Infrastructure");

    const stored = await pool.query<{ compiled_context: string | null; status: string }>(
      "SELECT compiled_context, status FROM clarification_sessions WHERE id = $1",
      [completed.id],
    );
    expect(stored.rows[0]?.status).toBe("completed");
    expect(stored.rows[0]?.compiled_context).toBe(completed.compiledContext);
  });

  it("does not require a second AI call", async () => {
    const owner = await createUser("Complete No AI Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);
    await resolveAll(owner.id, projectId);
    askAi.mockClear();

    await createCaller(owner.id).clarification.completeSession({ projectId });
    expect(askAi).not.toHaveBeenCalled();
  });

  it("rejects completing twice", async () => {
    const owner = await createUser("Double Complete Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);
    await resolveAll(owner.id, projectId);
    await createCaller(owner.id).clarification.completeSession({ projectId });

    await expect(
      createCaller(owner.id).clarification.completeSession({ projectId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("frees the project for a fresh session after completion", async () => {
    const owner = await createUser("Restart Owner");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);
    await resolveAll(owner.id, projectId);
    const completed = await createCaller(owner.id).clarification.completeSession({ projectId });

    const restarted = await createCaller(owner.id).clarification.startSession({ projectId });
    expect(restarted.id).not.toBe(completed.id);
    expect(restarted.status).toBe("active");
  });

  it("rejects a viewer with FORBIDDEN", async () => {
    const owner = await createUser("Complete Viewer Owner");
    const viewer = await createUser("Complete Viewer");
    const projectId = await createProject(owner.id);
    await createCaller(owner.id).project.inviteMember({
      projectId,
      email: viewer.email,
      role: "viewer",
    });
    await addBrdFile(projectId, owner.id);
    await resolveAll(owner.id, projectId);

    await expect(
      createCaller(viewer.id).clarification.completeSession({ projectId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a non-member with FORBIDDEN", async () => {
    const owner = await createUser("Complete Outsider Owner");
    const outsider = await createUser("Complete Outsider");
    const projectId = await createProject(owner.id);
    await addBrdFile(projectId, owner.id);
    await resolveAll(owner.id, projectId);

    await expect(
      createCaller(outsider.id).clarification.completeSession({ projectId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("compileSpecificationContext", () => {
  const noPreferences = { frontend: null, backend: null, database: null, infra: null };

  it("renders every ambiguity with its question and answer", () => {
    const context = compileSpecificationContext(
      [
        {
          id: "q1",
          position: 0,
          prompt: "Which auth method?",
          ambiguity: "Auth method",
          quickReplies: [],
          answer: "SSO",
          resolved: true,
        },
      ],
      noPreferences,
    );
    expect(context).toContain("### Auth method");
    expect(context).toContain("- Question: Which auth method?");
    expect(context).toContain("- Answer: SSO");
  });

  it("states plainly when no tech stack was supplied", () => {
    expect(compileSpecificationContext([], noPreferences)).toContain(
      "No preferred tech stack was supplied.",
    );
  });

  it("omits blank preference fields", () => {
    const context = compileSpecificationContext([], {
      frontend: "React",
      backend: "",
      database: null,
      infra: null,
    });
    expect(context).toContain("- Frontend: React");
    expect(context).not.toContain("- Backend:");
  });
});
