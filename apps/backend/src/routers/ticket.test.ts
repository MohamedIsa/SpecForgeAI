import { describe, it, expect, afterEach } from "vitest";
import { createTestCaller } from "../test-utils";
import { pool } from "../db/pool";
import type { ProjectStatus } from "./status";

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
    // Cascades to owned projects, memberships, statuses, and tickets via FK constraints.
    await pool.query("DELETE FROM users WHERE id = $1", [id]);
  }
});

async function createProjectWithOwner(ownerId: string): Promise<{
  projectId: string;
  projectKey: string;
  statuses: ProjectStatus[];
}> {
  const key = uniqueKey();
  const created = await createCaller(ownerId).project.createProject({
    name: "Ticket Test Project",
    key,
    template: "kanban",
  });
  return { projectId: created.project.id, projectKey: created.project.key, statuses: created.statuses };
}

function baseTicketInput(projectId: string, statusId: string) {
  return {
    projectId,
    statusId,
    title: "Implement login flow",
    type: "story" as const,
    priority: "P1" as const,
  };
}

describe("ticketRouter.createTicket", () => {
  it("creates a ticket with an auto-generated sequential key starting at -101", async () => {
    const owner = await createUser("Create Ticket Owner");
    const { projectId, projectKey, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");

    const result = await createCaller(owner.id).ticket.createTicket(
      baseTicketInput(projectId, firstStatus.id),
    );

    expect(result.ticket.key).toBe(`${projectKey}-101`);
    expect(result.ticket.title).toBe("Implement login flow");
    expect(result.ticket.type).toBe("story");
    expect(result.ticket.priority).toBe("P1");
    expect(result.ticket.statusId).toBe(firstStatus.id);
    expect(result.ticket.acceptanceCriteria).toEqual([]);
    expect(result.ticket.dependencies).toEqual([]);
  });

  it("increments the ticket number for each subsequent ticket in the project", async () => {
    const owner = await createUser("Sequential Ticket Owner");
    const { projectId, projectKey, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");

    const first = await createCaller(owner.id).ticket.createTicket(
      baseTicketInput(projectId, firstStatus.id),
    );
    const second = await createCaller(owner.id).ticket.createTicket(
      baseTicketInput(projectId, firstStatus.id),
    );

    expect(first.ticket.key).toBe(`${projectKey}-101`);
    expect(second.ticket.key).toBe(`${projectKey}-102`);
  });

  it("assigns distinct sequential keys under concurrent creation in the same project", async () => {
    const owner = await createUser("Concurrent Ticket Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        createCaller(owner.id).ticket.createTicket(baseTicketInput(projectId, firstStatus.id)),
      ),
    );

    const keys = results.map((result) => result.ticket.key);
    expect(new Set(keys).size).toBe(5);
  });

  it("accepts an optional assignee who is a project member", async () => {
    const owner = await createUser("Assignee Owner");
    const assignee = await createUser("Assignee Member");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");

    await createCaller(owner.id).project.inviteMember({
      projectId,
      email: assignee.email,
      role: "editor",
    });

    const result = await createCaller(owner.id).ticket.createTicket({
      ...baseTicketInput(projectId, firstStatus.id),
      assigneeId: assignee.id,
    });
    expect(result.ticket.assigneeId).toBe(assignee.id);
  });

  it("rejects an assignee who is not a project member", async () => {
    const owner = await createUser("Non-Member Assignee Owner");
    const outsider = await createUser("Non-Member Assignee Outsider");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");

    await expect(
      createCaller(owner.id).ticket.createTicket({
        ...baseTicketInput(projectId, firstStatus.id),
        assigneeId: outsider.id,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a status that belongs to a different project", async () => {
    const owner = await createUser("Foreign Status Owner");
    const { projectId } = await createProjectWithOwner(owner.id);
    const { statuses: otherStatuses } = await createProjectWithOwner(owner.id);
    const foreignStatus = otherStatuses[0];
    if (!foreignStatus) throw new Error("expected the other project to have a status");

    await expect(
      createCaller(owner.id).ticket.createTicket(baseTicketInput(projectId, foreignStatus.id)),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("accepts dependencies that belong to the same project", async () => {
    const owner = await createUser("Valid Dependency Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");

    const dependency = await createCaller(owner.id).ticket.createTicket(
      baseTicketInput(projectId, firstStatus.id),
    );
    const result = await createCaller(owner.id).ticket.createTicket({
      ...baseTicketInput(projectId, firstStatus.id),
      dependencies: [dependency.ticket.id],
    });

    expect(result.ticket.dependencies).toEqual([dependency.ticket.id]);
  });

  it("rejects a dependency ticket belonging to a different project", async () => {
    const owner = await createUser("Foreign Dependency Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");
    const { projectId: otherProjectId, statuses: otherStatuses } = await createProjectWithOwner(
      owner.id,
    );
    const otherFirstStatus = otherStatuses[0];
    if (!otherFirstStatus) throw new Error("expected the other project to have a status");

    const foreignTicket = await createCaller(owner.id).ticket.createTicket(
      baseTicketInput(otherProjectId, otherFirstStatus.id),
    );

    await expect(
      createCaller(owner.id).ticket.createTicket({
        ...baseTicketInput(projectId, firstStatus.id),
        dependencies: [foreignTicket.ticket.id],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("allows an editor to create a ticket", async () => {
    const owner = await createUser("Editor Ticket Owner");
    const editor = await createUser("Editor Ticket Editor");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");

    await createCaller(owner.id).project.inviteMember({
      projectId,
      email: editor.email,
      role: "editor",
    });

    const result = await createCaller(editor.id).ticket.createTicket(
      baseTicketInput(projectId, firstStatus.id),
    );
    expect(result.ticket.title).toBe("Implement login flow");
  });

  it("rejects a viewer creating a ticket with FORBIDDEN", async () => {
    const owner = await createUser("Viewer Ticket Owner");
    const viewer = await createUser("Viewer Ticket Viewer");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");

    await createCaller(owner.id).project.inviteMember({
      projectId,
      email: viewer.email,
      role: "viewer",
    });

    await expect(
      createCaller(viewer.id).ticket.createTicket(baseTicketInput(projectId, firstStatus.id)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a non-member creating a ticket with FORBIDDEN", async () => {
    const owner = await createUser("Non-Member Ticket Owner");
    const outsider = await createUser("Non-Member Ticket Outsider");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");

    await expect(
      createCaller(outsider.id).ticket.createTicket(baseTicketInput(projectId, firstStatus.id)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects an invalid ticket type via Zod validation", async () => {
    const owner = await createUser("Invalid Type Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");

    await expect(
      createCaller(owner.id).ticket.createTicket({
        projectId,
        statusId: firstStatus.id,
        title: "Bad type",
        type: "epic" as unknown as "story",
        priority: "P1",
      }),
    ).rejects.toThrow();
  });

  it("rejects an empty title via Zod validation", async () => {
    const owner = await createUser("Empty Title Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");

    await expect(
      createCaller(owner.id).ticket.createTicket({
        ...baseTicketInput(projectId, firstStatus.id),
        title: "   ",
      }),
    ).rejects.toThrow();
  });
});

describe("ticketRouter.updateTicketStatus", () => {
  it("moves a ticket with no dependencies freely between statuses", async () => {
    const owner = await createUser("Free Move Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    const secondStatus = statuses[1];
    if (!firstStatus || !secondStatus) throw new Error("expected at least two statuses");

    const created = await createCaller(owner.id).ticket.createTicket(
      baseTicketInput(projectId, firstStatus.id),
    );
    const result = await createCaller(owner.id).ticket.updateTicketStatus({
      projectId,
      ticketId: created.ticket.id,
      statusId: secondStatus.id,
    });
    expect(result.ticket.statusId).toBe(secondStatus.id);
  });

  it("blocks moving a ticket whose dependency has not reached the last status", async () => {
    const owner = await createUser("Blocked Move Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    const secondStatus = statuses[1];
    if (!firstStatus || !secondStatus) throw new Error("expected at least two statuses");

    const dependency = await createCaller(owner.id).ticket.createTicket(
      baseTicketInput(projectId, firstStatus.id),
    );
    const dependent = await createCaller(owner.id).ticket.createTicket({
      ...baseTicketInput(projectId, firstStatus.id),
      dependencies: [dependency.ticket.id],
    });

    await expect(
      createCaller(owner.id).ticket.updateTicketStatus({
        projectId,
        ticketId: dependent.ticket.id,
        statusId: secondStatus.id,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("allows moving once the dependency has reached the project's last status", async () => {
    const owner = await createUser("Unblocked Move Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    const lastStatus = statuses[statuses.length - 1];
    if (!firstStatus || !lastStatus) throw new Error("expected at least one status");

    const dependency = await createCaller(owner.id).ticket.createTicket(
      baseTicketInput(projectId, firstStatus.id),
    );
    const dependent = await createCaller(owner.id).ticket.createTicket({
      ...baseTicketInput(projectId, firstStatus.id),
      dependencies: [dependency.ticket.id],
    });

    await createCaller(owner.id).ticket.updateTicketStatus({
      projectId,
      ticketId: dependency.ticket.id,
      statusId: lastStatus.id,
    });

    const result = await createCaller(owner.id).ticket.updateTicketStatus({
      projectId,
      ticketId: dependent.ticket.id,
      statusId: lastStatus.id,
    });
    expect(result.ticket.statusId).toBe(lastStatus.id);
  });

  it("rejects a status from a different project", async () => {
    const owner = await createUser("Foreign Move Status Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");
    const { statuses: otherStatuses } = await createProjectWithOwner(owner.id);
    const foreignStatus = otherStatuses[0];
    if (!foreignStatus) throw new Error("expected the other project to have a status");

    const created = await createCaller(owner.id).ticket.createTicket(
      baseTicketInput(projectId, firstStatus.id),
    );

    await expect(
      createCaller(owner.id).ticket.updateTicketStatus({
        projectId,
        ticketId: created.ticket.id,
        statusId: foreignStatus.id,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a non-existent ticket with NOT_FOUND", async () => {
    const owner = await createUser("Missing Ticket Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");

    await expect(
      createCaller(owner.id).ticket.updateTicketStatus({
        projectId,
        ticketId: "00000000-0000-0000-0000-000000000000",
        statusId: firstStatus.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a viewer moving a ticket with FORBIDDEN", async () => {
    const owner = await createUser("Viewer Move Owner");
    const viewer = await createUser("Viewer Move Viewer");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    const secondStatus = statuses[1];
    if (!firstStatus || !secondStatus) throw new Error("expected at least two statuses");

    await createCaller(owner.id).project.inviteMember({
      projectId,
      email: viewer.email,
      role: "viewer",
    });
    const created = await createCaller(owner.id).ticket.createTicket(
      baseTicketInput(projectId, firstStatus.id),
    );

    await expect(
      createCaller(viewer.id).ticket.updateTicketStatus({
        projectId,
        ticketId: created.ticket.id,
        statusId: secondStatus.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a non-member moving a ticket with FORBIDDEN", async () => {
    const owner = await createUser("Non-Member Move Owner");
    const outsider = await createUser("Non-Member Move Outsider");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    const secondStatus = statuses[1];
    if (!firstStatus || !secondStatus) throw new Error("expected at least two statuses");

    const created = await createCaller(owner.id).ticket.createTicket(
      baseTicketInput(projectId, firstStatus.id),
    );

    await expect(
      createCaller(outsider.id).ticket.updateTicketStatus({
        projectId,
        ticketId: created.ticket.id,
        statusId: secondStatus.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("ticketRouter.updateTicket", () => {
  it("updates title, description, priority, and story points", async () => {
    const owner = await createUser("Update Ticket Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");

    const created = await createCaller(owner.id).ticket.createTicket(
      baseTicketInput(projectId, firstStatus.id),
    );

    const result = await createCaller(owner.id).ticket.updateTicket({
      projectId,
      ticketId: created.ticket.id,
      title: "Updated title",
      description: "Updated description",
      priority: "P0",
      storyPoints: 5,
    });

    expect(result.ticket.title).toBe("Updated title");
    expect(result.ticket.description).toBe("Updated description");
    expect(result.ticket.priority).toBe("P0");
    expect(result.ticket.storyPoints).toBe(5);
  });

  it("clears description, story points, and assignee via explicit null", async () => {
    const owner = await createUser("Clear Fields Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");

    const created = await createCaller(owner.id).ticket.createTicket({
      ...baseTicketInput(projectId, firstStatus.id),
      description: "Initial description",
      storyPoints: 3,
      assigneeId: owner.id,
    });

    const result = await createCaller(owner.id).ticket.updateTicket({
      projectId,
      ticketId: created.ticket.id,
      description: null,
      storyPoints: null,
      assigneeId: null,
    });

    expect(result.ticket.description).toBeNull();
    expect(result.ticket.storyPoints).toBeNull();
    expect(result.ticket.assigneeId).toBeNull();
  });

  it("rejects assigning a non-member with BAD_REQUEST", async () => {
    const owner = await createUser("Update Assignee Owner");
    const outsider = await createUser("Update Assignee Outsider");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");

    const created = await createCaller(owner.id).ticket.createTicket(
      baseTicketInput(projectId, firstStatus.id),
    );

    await expect(
      createCaller(owner.id).ticket.updateTicket({
        projectId,
        ticketId: created.ticket.id,
        assigneeId: outsider.id,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects an update with no fields provided", async () => {
    const owner = await createUser("No Fields Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");

    const created = await createCaller(owner.id).ticket.createTicket(
      baseTicketInput(projectId, firstStatus.id),
    );

    await expect(
      createCaller(owner.id).ticket.updateTicket({ projectId, ticketId: created.ticket.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a viewer updating a ticket with FORBIDDEN", async () => {
    const owner = await createUser("Viewer Update Owner");
    const viewer = await createUser("Viewer Update Viewer");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");

    await createCaller(owner.id).project.inviteMember({
      projectId,
      email: viewer.email,
      role: "viewer",
    });
    const created = await createCaller(owner.id).ticket.createTicket(
      baseTicketInput(projectId, firstStatus.id),
    );

    await expect(
      createCaller(viewer.id).ticket.updateTicket({
        projectId,
        ticketId: created.ticket.id,
        title: "Nope",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects updating a non-existent ticket with NOT_FOUND", async () => {
    const owner = await createUser("Missing Update Owner");
    const { projectId } = await createProjectWithOwner(owner.id);

    await expect(
      createCaller(owner.id).ticket.updateTicket({
        projectId,
        ticketId: "00000000-0000-0000-0000-000000000000",
        title: "Nope",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("ticketRouter.getTicketDetails", () => {
  it("returns ticket details with resolved assignee info and dependency summaries", async () => {
    const owner = await createUser("Details Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");

    const dependency = await createCaller(owner.id).ticket.createTicket(
      baseTicketInput(projectId, firstStatus.id),
    );
    const ticket = await createCaller(owner.id).ticket.createTicket({
      ...baseTicketInput(projectId, firstStatus.id),
      assigneeId: owner.id,
      dependencies: [dependency.ticket.id],
    });

    const details = await createCaller(owner.id).ticket.getTicketDetails({
      projectId,
      ticketId: ticket.ticket.id,
    });

    expect(details.assignee?.id).toBe(owner.id);
    expect(details.dependencySummaries).toHaveLength(1);
    expect(details.dependencySummaries[0]?.id).toBe(dependency.ticket.id);
    expect(details.dependencySummaries[0]?.key).toBe(dependency.ticket.key);
  });

  it("returns a null assignee and empty dependency summaries when none are set", async () => {
    const owner = await createUser("No Assignee Details Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");

    const ticket = await createCaller(owner.id).ticket.createTicket(
      baseTicketInput(projectId, firstStatus.id),
    );
    const details = await createCaller(owner.id).ticket.getTicketDetails({
      projectId,
      ticketId: ticket.ticket.id,
    });

    expect(details.assignee).toBeNull();
    expect(details.dependencySummaries).toEqual([]);
  });

  it("rejects a non-member with FORBIDDEN", async () => {
    const owner = await createUser("Details Forbidden Owner");
    const outsider = await createUser("Details Forbidden Outsider");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");

    const ticket = await createCaller(owner.id).ticket.createTicket(
      baseTicketInput(projectId, firstStatus.id),
    );

    await expect(
      createCaller(outsider.id).ticket.getTicketDetails({
        projectId,
        ticketId: ticket.ticket.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects an unauthenticated caller with UNAUTHORIZED", async () => {
    await expect(
      createCaller(null).ticket.getTicketDetails({
        projectId: "00000000-0000-0000-0000-000000000000",
        ticketId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects a non-existent ticket with NOT_FOUND", async () => {
    const owner = await createUser("Missing Details Owner");
    const { projectId } = await createProjectWithOwner(owner.id);

    await expect(
      createCaller(owner.id).ticket.getTicketDetails({
        projectId,
        ticketId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("ticketRouter.getProjectTickets", () => {
  it("returns all tickets for the project with resolved assignee info", async () => {
    const owner = await createUser("List Tickets Owner");
    const { projectId, statuses } = await createProjectWithOwner(owner.id);
    const firstStatus = statuses[0];
    if (!firstStatus) throw new Error("expected at least one status");

    await createCaller(owner.id).ticket.createTicket({
      ...baseTicketInput(projectId, firstStatus.id),
      assigneeId: owner.id,
    });
    await createCaller(owner.id).ticket.createTicket(baseTicketInput(projectId, firstStatus.id));

    const tickets = await createCaller(owner.id).ticket.getProjectTickets({ projectId });
    expect(tickets).toHaveLength(2);
    const withAssignee = tickets.find((ticket) => ticket.assignee !== null);
    expect(withAssignee?.assignee?.id).toBe(owner.id);
  });

  it("rejects a non-member with FORBIDDEN", async () => {
    const owner = await createUser("List Forbidden Owner");
    const outsider = await createUser("List Forbidden Outsider");
    const { projectId } = await createProjectWithOwner(owner.id);

    await expect(
      createCaller(outsider.id).ticket.getProjectTickets({ projectId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
