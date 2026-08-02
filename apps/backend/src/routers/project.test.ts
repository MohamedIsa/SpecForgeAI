import { describe, it, expect, afterEach } from "vitest";
import { createTestCaller } from "../test-utils";
import { pool } from "../db/pool";
import type { CreateProjectResult } from "./project";

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
    // Cascades to owned projects, memberships, and statuses via FK constraints.
    await pool.query("DELETE FROM users WHERE id = $1", [id]);
  }
});

describe("projectRouter authentication", () => {
  it("rejects listUserProjects for an unauthenticated caller", async () => {
    await expect(createCaller(null).project.listUserProjects()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects createProject for an unauthenticated caller", async () => {
    await expect(
      createCaller(null).project.createProject({
        name: "Spec Forge",
        key: uniqueKey(),
        template: "kanban",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects inviteMember for an unauthenticated caller", async () => {
    await expect(
      createCaller(null).project.inviteMember({
        projectId: "00000000-0000-0000-0000-000000000000",
        email: "someone@example.com",
        role: "editor",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("projectRouter.createProject", () => {
  it("creates a project, an owner membership, and default kanban statuses atomically", async () => {
    const owner = await createUser("Kanban Owner");
    const key = uniqueKey();

    const result = await createCaller(owner.id).project.createProject({
      name: "Kanban Project",
      key,
      description: "A test project",
      template: "kanban",
    });

    expect(result.project.key).toBe(key);
    expect(result.project.template).toBe("kanban");
    expect(result.statuses.map((status) => status.name)).toEqual([
      "Backlog",
      "In Clarification",
      "In Progress",
      "Review",
      "Done",
    ]);
    expect(result.statuses.every((status) => /^#[0-9A-Fa-f]{6}$/.test(status.color))).toBe(true);

    const membershipRow = await pool.query<{ role: string }>(
      "SELECT role FROM project_memberships WHERE project_id = $1 AND user_id = $2",
      [result.project.id, owner.id],
    );
    expect(membershipRow.rows[0]?.role).toBe("owner");

    const statusRows = await pool.query(
      "SELECT name FROM project_statuses WHERE project_id = $1 ORDER BY position ASC",
      [result.project.id],
    );
    expect(statusRows.rows).toHaveLength(5);
  });

  it("creates default scrum statuses when the scrum template is selected", async () => {
    const owner = await createUser("Scrum Owner");

    const result = await createCaller(owner.id).project.createProject({
      name: "Scrum Project",
      key: uniqueKey(),
      template: "scrum",
    });

    expect(result.statuses.map((status) => status.name)).toEqual([
      "Backlog",
      "Sprint Backlog",
      "In Progress",
      "QA / Review",
      "Done",
    ]);
  });

  it("rejects a duplicate project key with CONFLICT", async () => {
    const owner = await createUser("Duplicate Key Owner");
    const key = uniqueKey();

    await createCaller(owner.id).project.createProject({
      name: "First Project",
      key,
      template: "kanban",
    });

    await expect(
      createCaller(owner.id).project.createProject({
        name: "Second Project",
        key,
        template: "kanban",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects a concurrent duplicate project key with CONFLICT, leaving one project with its statuses intact", async () => {
    const owner = await createUser("Concurrent Key Owner");
    const key = uniqueKey();

    const results = await Promise.allSettled([
      createCaller(owner.id).project.createProject({
        name: "Concurrent One",
        key,
        template: "kanban",
      }),
      createCaller(owner.id).project.createProject({
        name: "Concurrent Two",
        key,
        template: "scrum",
      }),
    ]);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<CreateProjectResult> =>
        result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const rejectedResult = rejected[0];
    if (!rejectedResult) throw new Error("expected exactly one rejected creation");
    expect(rejectedResult.reason).toMatchObject({ code: "CONFLICT" });

    const fulfilledResult = fulfilled[0];
    if (!fulfilledResult) throw new Error("expected exactly one fulfilled creation");
    const statusRows = await pool.query(
      "SELECT id FROM project_statuses WHERE project_id = $1",
      [fulfilledResult.value.project.id],
    );
    expect(statusRows.rows.length).toBeGreaterThan(0);
  });

  it("rejects an invalid project key via Zod validation", async () => {
    const owner = await createUser("Invalid Key Owner");
    await expect(
      createCaller(owner.id).project.createProject({
        name: "Bad Key Project",
        key: "1NVALID",
        template: "kanban",
      }),
    ).rejects.toThrow();
  });

  it("rejects an empty project name via Zod validation", async () => {
    const owner = await createUser("Empty Name Owner");
    await expect(
      createCaller(owner.id).project.createProject({
        name: "   ",
        key: uniqueKey(),
        template: "kanban",
      }),
    ).rejects.toThrow();
  });
});

describe("projectRouter.listUserProjects", () => {
  it("only returns projects the caller is a member of, with role and member count", async () => {
    const owner = await createUser("List Owner");
    const outsider = await createUser("List Outsider");

    const created = await createCaller(owner.id).project.createProject({
      name: "Visible Project",
      key: uniqueKey(),
      template: "kanban",
    });

    const ownerProjects = await createCaller(owner.id).project.listUserProjects();
    const match = ownerProjects.find((project) => project.id === created.project.id);
    expect(match).toBeDefined();
    expect(match?.role).toBe("owner");
    expect(match?.memberCount).toBe(1);

    const outsiderProjects = await createCaller(outsider.id).project.listUserProjects();
    expect(outsiderProjects.find((project) => project.id === created.project.id)).toBeUndefined();
  });

  it("reflects an increased member count after a successful invite", async () => {
    const owner = await createUser("Invite Count Owner");
    const invitee = await createUser("Invite Count Invitee");

    const created = await createCaller(owner.id).project.createProject({
      name: "Growing Project",
      key: uniqueKey(),
      template: "kanban",
    });

    await createCaller(owner.id).project.inviteMember({
      projectId: created.project.id,
      email: invitee.email,
      role: "editor",
    });

    const ownerProjects = await createCaller(owner.id).project.listUserProjects();
    const match = ownerProjects.find((project) => project.id === created.project.id);
    expect(match?.memberCount).toBe(2);

    const inviteeProjects = await createCaller(invitee.id).project.listUserProjects();
    const inviteeMatch = inviteeProjects.find((project) => project.id === created.project.id);
    expect(inviteeMatch?.role).toBe("editor");
  });
});

describe("projectRouter.inviteMember", () => {
  it("allows the owner to invite a member with the Editor role", async () => {
    const owner = await createUser("Editor Invite Owner");
    const invitee = await createUser("Editor Invitee");

    const created = await createCaller(owner.id).project.createProject({
      name: "Editor Invite Project",
      key: uniqueKey(),
      template: "kanban",
    });

    const result = await createCaller(owner.id).project.inviteMember({
      projectId: created.project.id,
      email: invitee.email,
      role: "editor",
    });

    expect(result.membership.role).toBe("editor");
    expect(result.membership.userId).toBe(invitee.id);
  });

  it("allows an existing Editor to invite another member", async () => {
    const owner = await createUser("Delegate Invite Owner");
    const editor = await createUser("Delegate Editor");
    const invitee = await createUser("Delegate Invitee");

    const created = await createCaller(owner.id).project.createProject({
      name: "Delegate Invite Project",
      key: uniqueKey(),
      template: "kanban",
    });

    await createCaller(owner.id).project.inviteMember({
      projectId: created.project.id,
      email: editor.email,
      role: "editor",
    });

    const result = await createCaller(editor.id).project.inviteMember({
      projectId: created.project.id,
      email: invitee.email,
      role: "viewer",
    });

    expect(result.membership.role).toBe("viewer");
  });

  it("rejects an invite from a Viewer with FORBIDDEN", async () => {
    const owner = await createUser("Viewer Restriction Owner");
    const viewer = await createUser("Restricted Viewer");
    const invitee = await createUser("Viewer Restriction Invitee");

    const created = await createCaller(owner.id).project.createProject({
      name: "Viewer Restriction Project",
      key: uniqueKey(),
      template: "kanban",
    });

    await createCaller(owner.id).project.inviteMember({
      projectId: created.project.id,
      email: viewer.email,
      role: "viewer",
    });

    await expect(
      createCaller(viewer.id).project.inviteMember({
        projectId: created.project.id,
        email: invitee.email,
        role: "editor",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects an invite from a non-member with FORBIDDEN, without leaking project existence", async () => {
    const owner = await createUser("Non-Member Project Owner");
    const outsider = await createUser("Non-Member Outsider");
    const invitee = await createUser("Non-Member Invitee");

    const created = await createCaller(owner.id).project.createProject({
      name: "Non-Member Project",
      key: uniqueKey(),
      template: "kanban",
    });

    await expect(
      createCaller(outsider.id).project.inviteMember({
        projectId: created.project.id,
        email: invitee.email,
        role: "editor",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects inviting an email with no matching user account with NOT_FOUND", async () => {
    const owner = await createUser("No Match Owner");

    const created = await createCaller(owner.id).project.createProject({
      name: "No Match Project",
      key: uniqueKey(),
      template: "kanban",
    });

    await expect(
      createCaller(owner.id).project.inviteMember({
        projectId: created.project.id,
        email: uniqueEmail(),
        role: "editor",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects inviting an already-existing member with CONFLICT", async () => {
    const owner = await createUser("Duplicate Invite Owner");
    const invitee = await createUser("Duplicate Invitee");

    const created = await createCaller(owner.id).project.createProject({
      name: "Duplicate Invite Project",
      key: uniqueKey(),
      template: "kanban",
    });

    await createCaller(owner.id).project.inviteMember({
      projectId: created.project.id,
      email: invitee.email,
      role: "editor",
    });

    await expect(
      createCaller(owner.id).project.inviteMember({
        projectId: created.project.id,
        email: invitee.email,
        role: "viewer",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects an invalid email via Zod validation", async () => {
    const owner = await createUser("Invalid Invite Email Owner");
    const created = await createCaller(owner.id).project.createProject({
      name: "Invalid Invite Email Project",
      key: uniqueKey(),
      template: "kanban",
    });

    await expect(
      createCaller(owner.id).project.inviteMember({
        projectId: created.project.id,
        email: "not-an-email",
        role: "editor",
      }),
    ).rejects.toThrow();
  });
});
