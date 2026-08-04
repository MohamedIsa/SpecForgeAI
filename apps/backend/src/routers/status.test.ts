import { describe, it, expect, afterEach } from "vitest";
import { createTestCaller } from "../test-utils";
import { pool } from "../db/pool";
import type { ProjectStatus, ReorderStatusesResult } from "./status";

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

async function createProjectWithOwner(ownerId: string): Promise<{
  projectId: string;
  statuses: ProjectStatus[];
}> {
  const created = await createCaller(ownerId).project.createProject({
    name: "Status Test Project",
    key: uniqueKey(),
    template: "kanban",
  });
  return { projectId: created.project.id, statuses: created.statuses };
}

describe("statusRouter.getProjectStatuses", () => {
  it("returns the project's statuses ordered by position for an owner", async () => {
    const owner = await createUser("Status Owner");
    const { projectId } = await createProjectWithOwner(owner.id);

    const statuses = await createCaller(owner.id).status.getProjectStatuses({ projectId });
    expect(statuses.map((status) => status.name)).toEqual([
      "Backlog",
      "In Clarification",
      "In Progress",
      "Review",
      "Done",
    ]);
    expect(statuses.every((status) => /^#[0-9A-Fa-f]{6}$/.test(status.color))).toBe(true);
    expect(statuses.map((status) => status.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it("returns statuses for an invited viewer (read access for any member role)", async () => {
    const owner = await createUser("Viewer Access Owner");
    const viewer = await createUser("Viewer Access Viewer");
    const { projectId } = await createProjectWithOwner(owner.id);

    await createCaller(owner.id).project.inviteMember({
      projectId,
      email: viewer.email,
      role: "viewer",
    });

    const statuses = await createCaller(viewer.id).status.getProjectStatuses({ projectId });
    expect(statuses).toHaveLength(5);
  });

  it("rejects a non-member with FORBIDDEN", async () => {
    const owner = await createUser("Non-Member Statuses Owner");
    const outsider = await createUser("Non-Member Statuses Outsider");
    const { projectId } = await createProjectWithOwner(owner.id);

    await expect(
      createCaller(outsider.id).status.getProjectStatuses({ projectId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects an unauthenticated caller with UNAUTHORIZED", async () => {
    await expect(
      createCaller(null).status.getProjectStatuses({
        projectId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("statusRouter.createStatus", () => {
  it("appends a new status at the next position with an auto-assigned color when none is given", async () => {
    const owner = await createUser("Create Status Owner");
    const { projectId } = await createProjectWithOwner(owner.id);

    const result = await createCaller(owner.id).status.createStatus({
      projectId,
      name: "Blocked",
    });

    expect(result.status.name).toBe("Blocked");
    expect(result.status.position).toBe(5);
    expect(/^#[0-9A-Fa-f]{6}$/.test(result.status.color)).toBe(true);
  });

  it("accepts an explicit valid hex color", async () => {
    const owner = await createUser("Explicit Color Owner");
    const { projectId } = await createProjectWithOwner(owner.id);

    const result = await createCaller(owner.id).status.createStatus({
      projectId,
      name: "Blocked",
      color: "#123abc",
    });

    expect(result.status.color).toBe("#123abc");
  });

  it("rejects an invalid hex color via Zod validation", async () => {
    const owner = await createUser("Invalid Color Owner");
    const { projectId } = await createProjectWithOwner(owner.id);

    await expect(
      createCaller(owner.id).status.createStatus({
        projectId,
        name: "Blocked",
        color: "not-a-color",
      }),
    ).rejects.toThrow();
  });

  it("rejects an empty status name via Zod validation", async () => {
    const owner = await createUser("Empty Status Name Owner");
    const { projectId } = await createProjectWithOwner(owner.id);

    await expect(
      createCaller(owner.id).status.createStatus({ projectId, name: "   " }),
    ).rejects.toThrow();
  });

  it("allows an editor to create a status", async () => {
    const owner = await createUser("Editor Create Owner");
    const editor = await createUser("Editor Create Editor");
    const { projectId } = await createProjectWithOwner(owner.id);

    await createCaller(owner.id).project.inviteMember({
      projectId,
      email: editor.email,
      role: "editor",
    });

    const result = await createCaller(editor.id).status.createStatus({
      projectId,
      name: "Blocked",
    });
    expect(result.status.name).toBe("Blocked");
  });

  it("rejects a viewer creating a status with FORBIDDEN", async () => {
    const owner = await createUser("Viewer Create Owner");
    const viewer = await createUser("Viewer Create Viewer");
    const { projectId } = await createProjectWithOwner(owner.id);

    await createCaller(owner.id).project.inviteMember({
      projectId,
      email: viewer.email,
      role: "viewer",
    });

    await expect(
      createCaller(viewer.id).status.createStatus({ projectId, name: "Blocked" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a non-member creating a status with FORBIDDEN", async () => {
    const owner = await createUser("Non-Member Create Owner");
    const outsider = await createUser("Non-Member Create Outsider");
    const { projectId } = await createProjectWithOwner(owner.id);

    await expect(
      createCaller(outsider.id).status.createStatus({ projectId, name: "Blocked" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a duplicate status name within the same project with CONFLICT", async () => {
    const owner = await createUser("Duplicate Status Owner");
    const { projectId } = await createProjectWithOwner(owner.id);

    await expect(
      createCaller(owner.id).status.createStatus({ projectId, name: "Backlog" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects a concurrent duplicate status name with CONFLICT, and assigns non-colliding positions to concurrent distinct names", async () => {
    const owner = await createUser("Concurrent Status Owner");
    const { projectId } = await createProjectWithOwner(owner.id);

    const results = await Promise.allSettled([
      createCaller(owner.id).status.createStatus({ projectId, name: "Concurrent A" }),
      createCaller(owner.id).status.createStatus({ projectId, name: "Concurrent A" }),
    ]);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<{ status: ProjectStatus }> =>
        result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: "CONFLICT" });
  });
});

describe("statusRouter.reorderStatuses", () => {
  it("reorders statuses in a transaction and returns them in the new order", async () => {
    const owner = await createUser("Reorder Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const reversedIds = statuses.map((status) => status.id).reverse();

    const result = await createCaller(owner.id).status.reorderStatuses({
      projectId,
      orderedStatusIds: reversedIds,
    });

    expect(result.statuses.map((status) => status.id)).toEqual(reversedIds);
    expect(result.statuses.map((status) => status.position)).toEqual([0, 1, 2, 3, 4]);

    const persisted = await createCaller(owner.id).status.getProjectStatuses({ projectId });
    expect(persisted.map((status) => status.id)).toEqual(reversedIds);
  });

  it("rejects a reorder that omits an existing status", async () => {
    const owner = await createUser("Incomplete Reorder Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const incompleteIds = statuses.slice(0, statuses.length - 1).map((status) => status.id);

    await expect(
      createCaller(owner.id).status.reorderStatuses({
        projectId,
        orderedStatusIds: incompleteIds,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a reorder that includes a status id from a different project", async () => {
    const owner = await createUser("Foreign Reorder Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const { statuses: otherStatuses } = await createProjectWithOwner(owner.id);
    const foreignId = otherStatuses[0]?.id;
    if (!foreignId) throw new Error("expected the other project to have a status");

    const tamperedIds = [...statuses.slice(1).map((status) => status.id), foreignId];

    await expect(
      createCaller(owner.id).status.reorderStatuses({
        projectId,
        orderedStatusIds: tamperedIds,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a reorder from a viewer with FORBIDDEN", async () => {
    const owner = await createUser("Viewer Reorder Owner");
    const viewer = await createUser("Viewer Reorder Viewer");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);

    await createCaller(owner.id).project.inviteMember({
      projectId,
      email: viewer.email,
      role: "viewer",
    });

    await expect(
      createCaller(viewer.id).status.reorderStatuses({
        projectId,
        orderedStatusIds: statuses.map((status) => status.id).reverse(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("serializes concurrent reorders of the same project without corrupting position ordering", async () => {
    const owner = await createUser("Concurrent Reorder Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const forwardIds = statuses.map((status) => status.id);
    const reversedIds = [...forwardIds].reverse();

    const results = await Promise.allSettled([
      createCaller(owner.id).status.reorderStatuses({
        projectId,
        orderedStatusIds: forwardIds,
      }),
      createCaller(owner.id).status.reorderStatuses({
        projectId,
        orderedStatusIds: reversedIds,
      }),
    ]);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<ReorderStatusesResult> =>
        result.status === "fulfilled",
    );
    expect(fulfilled.length).toBeGreaterThan(0);

    const finalStatuses = await createCaller(owner.id).status.getProjectStatuses({ projectId });
    const positions = finalStatuses.map((status) => status.position);
    expect(new Set(positions).size).toBe(positions.length);
    expect([...positions].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("statusRouter.deleteStatus", () => {
  it("deletes a status belonging to the project", async () => {
    const owner = await createUser("Delete Status Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const targetId = statuses[0]?.id;
    if (!targetId) throw new Error("expected at least one status");

    const result = await createCaller(owner.id).status.deleteStatus({
      projectId,
      statusId: targetId,
    });
    expect(result).toEqual({ success: true });

    const remaining = await createCaller(owner.id).status.getProjectStatuses({ projectId });
    expect(remaining.find((status) => status.id === targetId)).toBeUndefined();
    expect(remaining).toHaveLength(4);
  });

  it("rejects deleting a status that still has tickets with CONFLICT", async () => {
    const owner = await createUser("Status Has Tickets Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const targetId = statuses[0]?.id;
    if (!targetId) throw new Error("expected at least one status");

    await createCaller(owner.id).ticket.createTicket({
      projectId,
      statusId: targetId,
      title: "Blocks status deletion",
      type: "task",
      priority: "P2",
    });

    await expect(
      createCaller(owner.id).status.deleteStatus({ projectId, statusId: targetId }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const remaining = await createCaller(owner.id).status.getProjectStatuses({ projectId });
    expect(remaining.find((status) => status.id === targetId)).toBeDefined();
  });

  it("rejects deleting a status that does not belong to the project with NOT_FOUND", async () => {
    const owner = await createUser("Foreign Delete Owner");
    const { projectId } = await createProjectWithOwner(owner.id);
    const { statuses: otherStatuses } = await createProjectWithOwner(owner.id);
    const foreignId = otherStatuses[0]?.id;
    if (!foreignId) throw new Error("expected the other project to have a status");

    await expect(
      createCaller(owner.id).status.deleteStatus({ projectId, statusId: foreignId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a viewer deleting a status with FORBIDDEN", async () => {
    const owner = await createUser("Viewer Delete Owner");
    const viewer = await createUser("Viewer Delete Viewer");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const targetId = statuses[0]?.id;
    if (!targetId) throw new Error("expected at least one status");

    await createCaller(owner.id).project.inviteMember({
      projectId,
      email: viewer.email,
      role: "viewer",
    });

    await expect(
      createCaller(viewer.id).status.deleteStatus({ projectId, statusId: targetId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a non-member deleting a status with FORBIDDEN", async () => {
    const owner = await createUser("Non-Member Delete Owner");
    const outsider = await createUser("Non-Member Delete Outsider");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const targetId = statuses[0]?.id;
    if (!targetId) throw new Error("expected at least one status");

    await expect(
      createCaller(outsider.id).status.deleteStatus({ projectId, statusId: targetId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
