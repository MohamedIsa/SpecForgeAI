import { describe, it, expect, afterEach } from "vitest";
import { createTestCaller } from "../test-utils";
import { pool } from "../db/pool";

function createCaller(userId: string | null) {
  return createTestCaller(userId).caller;
}

function uniqueEmail(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueKey(): string {
  return `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

const createdUserIds: string[] = [];

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

afterEach(async () => {
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop();
    // Cascades to projects, memberships, brd_files and tech preferences.
    await pool.query("DELETE FROM users WHERE id = $1", [id]);
  }
});

async function createProject(ownerId: string): Promise<string> {
  const created = await createCaller(ownerId).project.createProject({
    name: "BRD Router Test Project",
    key: uniqueKey(),
    template: "kanban",
  });
  return created.project.id;
}

async function insertCleanFile(projectId: string, fileName: string, userId: string): Promise<void> {
  await pool.query(
    `INSERT INTO brd_files
       (project_id, file_name, extension, byte_size, checksum, storage_path, scan_status, uploaded_by)
     VALUES ($1, $2, 'md', 128, 'deadbeef', $3, 'clean', $4)`,
    [projectId, fileName, `/tmp/${projectId}/${fileName}-${Math.random()}`, userId],
  );
}

describe("brdRouter.listFiles", () => {
  it("returns the project's stored files for a member", async () => {
    const owner = await createUser("List Files Owner");
    const projectId = await createProject(owner.id);
    await insertCleanFile(projectId, "requirements.md", owner.id);

    const files = await createCaller(owner.id).brd.listFiles({ projectId });
    expect(files).toHaveLength(1);
    expect(files[0]?.fileName).toBe("requirements.md");
    expect(files[0]?.scanStatus).toBe("clean");
    expect(files[0]?.byteSize).toBe(128);
  });

  it("returns an empty list for a project with no uploads", async () => {
    const owner = await createUser("Empty List Owner");
    const projectId = await createProject(owner.id);
    expect(await createCaller(owner.id).brd.listFiles({ projectId })).toEqual([]);
  });

  it("allows a viewer to read the file list", async () => {
    const owner = await createUser("Viewer List Owner");
    const viewer = await createUser("Viewer List Viewer");
    const projectId = await createProject(owner.id);
    await createCaller(owner.id).project.inviteMember({
      projectId,
      email: viewer.email,
      role: "viewer",
    });
    await insertCleanFile(projectId, "spec.md", owner.id);

    expect(await createCaller(viewer.id).brd.listFiles({ projectId })).toHaveLength(1);
  });

  it("does not leak another project's files", async () => {
    const owner = await createUser("Isolation Owner");
    const projectA = await createProject(owner.id);
    const projectB = await createProject(owner.id);
    await insertCleanFile(projectA, "only-in-a.md", owner.id);

    expect(await createCaller(owner.id).brd.listFiles({ projectId: projectB })).toEqual([]);
  });

  it("rejects a non-member with FORBIDDEN", async () => {
    const owner = await createUser("List Forbidden Owner");
    const outsider = await createUser("List Forbidden Outsider");
    const projectId = await createProject(owner.id);

    await expect(createCaller(outsider.id).brd.listFiles({ projectId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects an unauthenticated caller with UNAUTHORIZED", async () => {
    await expect(
      createCaller(null).brd.listFiles({ projectId: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("brdRouter.saveTechPreferences", () => {
  it("saves all four preference fields and returns them", async () => {
    const owner = await createUser("Tech Prefs Owner");
    const projectId = await createProject(owner.id);

    const saved = await createCaller(owner.id).brd.saveTechPreferences({
      projectId,
      frontend: "React + Vite",
      backend: "Fastify + tRPC",
      database: "PostgreSQL",
      infra: "Terraform on AWS",
    });

    expect(saved.frontend).toBe("React + Vite");
    expect(saved.backend).toBe("Fastify + tRPC");
    expect(saved.database).toBe("PostgreSQL");
    expect(saved.infra).toBe("Terraform on AWS");
    expect(saved.updatedAt).not.toBeNull();
  });

  it("upserts rather than duplicating on repeated saves", async () => {
    const owner = await createUser("Upsert Owner");
    const projectId = await createProject(owner.id);

    await createCaller(owner.id).brd.saveTechPreferences({ projectId, frontend: "Vue" });
    const second = await createCaller(owner.id).brd.saveTechPreferences({
      projectId,
      frontend: "React",
    });

    expect(second.frontend).toBe("React");
    const rows = await pool.query("SELECT project_id FROM project_tech_preferences WHERE project_id = $1", [
      projectId,
    ]);
    expect(rows.rows).toHaveLength(1);
  });

  it("treats an empty string as clearing the field", async () => {
    const owner = await createUser("Clear Prefs Owner");
    const projectId = await createProject(owner.id);

    await createCaller(owner.id).brd.saveTechPreferences({ projectId, frontend: "React" });
    const cleared = await createCaller(owner.id).brd.saveTechPreferences({
      projectId,
      frontend: "",
    });
    expect(cleared.frontend).toBeNull();
  });

  it("allows partial preferences, leaving unspecified fields null", async () => {
    const owner = await createUser("Partial Prefs Owner");
    const projectId = await createProject(owner.id);

    const saved = await createCaller(owner.id).brd.saveTechPreferences({
      projectId,
      database: "PostgreSQL",
    });
    expect(saved.database).toBe("PostgreSQL");
    expect(saved.frontend).toBeNull();
    expect(saved.infra).toBeNull();
  });

  it("allows an editor to save preferences", async () => {
    const owner = await createUser("Editor Prefs Owner");
    const editor = await createUser("Editor Prefs Editor");
    const projectId = await createProject(owner.id);
    await createCaller(owner.id).project.inviteMember({
      projectId,
      email: editor.email,
      role: "editor",
    });

    const saved = await createCaller(editor.id).brd.saveTechPreferences({
      projectId,
      backend: "Fastify",
    });
    expect(saved.backend).toBe("Fastify");
  });

  it("rejects a viewer with FORBIDDEN", async () => {
    const owner = await createUser("Viewer Prefs Owner");
    const viewer = await createUser("Viewer Prefs Viewer");
    const projectId = await createProject(owner.id);
    await createCaller(owner.id).project.inviteMember({
      projectId,
      email: viewer.email,
      role: "viewer",
    });

    await expect(
      createCaller(viewer.id).brd.saveTechPreferences({ projectId, frontend: "React" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a non-member with FORBIDDEN", async () => {
    const owner = await createUser("Non-Member Prefs Owner");
    const outsider = await createUser("Non-Member Prefs Outsider");
    const projectId = await createProject(owner.id);

    await expect(
      createCaller(outsider.id).brd.saveTechPreferences({ projectId, frontend: "React" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects an over-long preference value via Zod validation", async () => {
    const owner = await createUser("Long Prefs Owner");
    const projectId = await createProject(owner.id);

    await expect(
      createCaller(owner.id).brd.saveTechPreferences({
        projectId,
        frontend: "x".repeat(201),
      }),
    ).rejects.toThrow();
  });
});

describe("brdRouter.getTechPreferences", () => {
  it("returns null fields when nothing has been saved yet", async () => {
    const owner = await createUser("Unset Prefs Owner");
    const projectId = await createProject(owner.id);

    const prefs = await createCaller(owner.id).brd.getTechPreferences({ projectId });
    expect(prefs).toEqual({
      frontend: null,
      backend: null,
      database: null,
      infra: null,
      updatedAt: null,
    });
  });

  it("round-trips saved preferences", async () => {
    const owner = await createUser("Roundtrip Prefs Owner");
    const projectId = await createProject(owner.id);

    await createCaller(owner.id).brd.saveTechPreferences({
      projectId,
      frontend: "React",
      infra: "Terraform",
    });

    const prefs = await createCaller(owner.id).brd.getTechPreferences({ projectId });
    expect(prefs.frontend).toBe("React");
    expect(prefs.infra).toBe("Terraform");
  });

  it("allows a viewer to read preferences", async () => {
    const owner = await createUser("Viewer Read Prefs Owner");
    const viewer = await createUser("Viewer Read Prefs Viewer");
    const projectId = await createProject(owner.id);
    await createCaller(owner.id).project.inviteMember({
      projectId,
      email: viewer.email,
      role: "viewer",
    });
    await createCaller(owner.id).brd.saveTechPreferences({ projectId, frontend: "React" });

    const prefs = await createCaller(viewer.id).brd.getTechPreferences({ projectId });
    expect(prefs.frontend).toBe("React");
  });

  it("rejects a non-member with FORBIDDEN", async () => {
    const owner = await createUser("Prefs Isolation Owner");
    const outsider = await createUser("Prefs Isolation Outsider");
    const projectId = await createProject(owner.id);

    await expect(
      createCaller(outsider.id).brd.getTechPreferences({ projectId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
