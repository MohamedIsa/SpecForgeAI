import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool } from "pg";
import { initTRPC } from "@trpc/server";
import type { Context } from "../../trpc/context";

const mockPoolQuery = vi.fn().mockResolvedValue({ rows: [] });
const mockPool: Pool = { query: mockPoolQuery } as unknown as Pool;

vi.mock("../../db/pool", () => ({
  getPool: () => mockPool,
  createPool: () => mockPool,
}));

const mockAICreate = vi.fn().mockResolvedValue({
  choices: [{ message: { content: "{}" } }],
});

vi.mock("../../services/ai", () => ({
  createDeepSeekClient: () => ({
    chat: { completions: { create: mockAICreate } },
  }),
  extractBacklog: vi.fn(),
}));

const t = initTRPC.context<Context>().create();

import { backlogRouter } from "../backlog";

function createCaller() {
  return t
    .router({ backlog: backlogRouter })
    .createCaller({ req: {} as Context["req"], res: {} as Context["res"] });
}

describe("getBacklog", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
  });

  it("returns epics with their tickets", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "epic-0",
            title: "Foundation",
            description: "Setup",
            created_at: new Date(),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "EPIC-0-T1",
            epic_id: "epic-0",
            title: "Setup Monorepo",
            type: "setup",
            priority: "P0",
            story_points: 2,
            status: "backlog",
            dependencies: [],
            description: "Setup workspace",
            acceptance_criteria: ["AC1", "AC2"],
            ai_dev_prompt: "Implement",
            created_at: new Date(),
          },
        ],
      });

    const caller = createCaller();
    const result = await caller.backlog.getBacklog({});

    expect(result).toHaveLength(1);
    const epic = result[0];

    if (epic == null) throw new Error("epic missing");
    expect(epic.id).toBe("epic-0");
    expect(epic.title).toBe("Foundation");
    expect(epic.tickets).toHaveLength(1);
    expect(epic.tickets[0]?.id).toBe("EPIC-0-T1");
  });

  it("filters by epicId when provided", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "epic-1",
            title: "Features",
            description: null,
            created_at: new Date(),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const caller = createCaller();
    const result = await caller.backlog.getBacklog({ epicId: "epic-1" });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("epic-1");

    const firstCall = mockPoolQuery.mock.calls[0] as unknown[];
    expect(firstCall[0]).toContain("WHERE id = $1");
  });

  it("filters by projectId", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "epic-0",
            title: "Foundation",
            description: "Setup",
            brd_upload_id: "proj-123",
            created_at: new Date(),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const caller = createCaller();
    const result = await caller.backlog.getBacklog({ projectId: "proj-123" });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("epic-0");

    const firstCall = mockPoolQuery.mock.calls[0] as unknown[];
    expect(firstCall[0]).toContain("brd_upload_id = $1");
  });

  it("works without any input arguments", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] });

    const caller = createCaller();
    await caller.backlog.getBacklog();

    expect(mockPoolQuery).toHaveBeenCalled();
  });
});

describe("createTicket", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
    mockPoolQuery.mockResolvedValue({ rows: [] });
    mockAICreate.mockReset();
  });

  it("AI-assisted createTicket generates and persists a ticket", async () => {
    mockAICreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              type: "feature",
              priority: "P1",
              storyPoints: 3,
              dependencies: [],
              acceptanceCriteria: [
                "Given a request When called Then AI generates ticket",
                "Given generated data When validated Then it passes",
                "Given valid ticket When persisted Then it's in DB",
              ],
              aiDevPrompt: "Implement the feature with tests.",
            }),
          },
        },
      ],
    });

    const caller = createCaller();
    const result = await caller.backlog.createTicket({
      title: "New Feature",
      description: "Implement a new feature",
      epicId: "epic-0",
      projectId: "PROJ-1",
    });

    expect(result.id).toBeDefined();
    expect(result.title).toBe("New Feature");
  });

  it("throws TRPCError on foreign key violation", async () => {
    mockAICreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              type: "feature",
              priority: "P1",
              storyPoints: 3,
              dependencies: [],
              acceptanceCriteria: [
                "Given x When y Then z",
                "Given a When b Then c",
                "Given p When q Then r",
              ],
              aiDevPrompt: "Test prompt",
            }),
          },
        },
      ],
    });
    mockPoolQuery.mockRejectedValue(
      new Error("violates foreign key constraint"),
    );

    const caller = createCaller();

    await expect(
      caller.backlog.createTicket({
        title: "Orphan",
        description: "No matching epic",
        epicId: "nonexistent",
        projectId: "PROJ-1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("updateTicketStatus", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
  });

  it("updates status successfully when there are no dependencies", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [{ dependencies: [] }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: "EPIC-0-T1" }],
      });

    const caller = createCaller();

    await caller.backlog.updateTicketStatus({
      ticketId: "EPIC-0-T1",
      status: "done",
    });
  });

  it("rejects transition when dependencies are not done", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [{ dependencies: ["EPIC-0-T1"] }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: "EPIC-0-T1", status: "in_progress" }],
      });

    const caller = createCaller();

    await expect(
      caller.backlog.updateTicketStatus({
        ticketId: "EPIC-0-T2",
        status: "done",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("allows transition when all dependencies are done", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [{ dependencies: ["EPIC-0-T1"] }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: "EPIC-0-T1", status: "done" }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: "EPIC-0-T2" }],
      });

    const caller = createCaller();

    await caller.backlog.updateTicketStatus({
      ticketId: "EPIC-0-T2",
      status: "done",
    });
  });
});

describe("extractTicketFromPrompt", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
    mockPoolQuery.mockResolvedValue({ rows: [] });
    mockAICreate.mockReset();
  });

  it("extracts and persists a ticket from a prompt", async () => {
    mockAICreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              id: "EPIC-0-T3",
              title: "Add Dark Mode",
              type: "feature",
              priority: "P2",
              storyPoints: 3,
              dependencies: [],
              description: "Add dark mode",
              acceptanceCriteria: [
                "Given x When y Then z",
                "Given a When b Then c",
                "Given p When q Then r",
              ],
              aiDevPrompt: "Implement dark mode",
            }),
          },
        },
      ],
    });

    const caller = createCaller();

    const result = await caller.backlog.extractTicketFromPrompt({
      prompt: "Add dark mode",
      epicId: "epic-0",
    });

    expect(result.id).toBe("EPIC-0-T3");
    expect(result.title).toBe("Add Dark Mode");
  });

  it("generates fallback ID when AI returns missing id", async () => {
    mockAICreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "Untitled Ticket",
              type: "feature",
              priority: "P1",
              storyPoints: 2,
              dependencies: [],
              description: "Test",
              acceptanceCriteria: [
                "Given x When y Then z",
                "Given a When b Then c",
                "Given p When q Then r",
              ],
              aiDevPrompt: "Test prompt",
            }),
          },
        },
      ],
    });

    const caller = createCaller();

    const result = await caller.backlog.extractTicketFromPrompt({
      prompt: "Test",
      epicId: "epic-0",
    });

    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
  });

  it("rejects AI output with invalid type enum", async () => {
    mockAICreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              id: "EPIC-0-T4",
              title: "Bad Type",
              type: "task",
              priority: "P1",
              storyPoints: 2,
              dependencies: [],
              description: "Test",
              acceptanceCriteria: [
                "Given x When y Then z",
                "Given a When b Then c",
                "Given p When q Then r",
              ],
              aiDevPrompt: "Test",
            }),
          },
        },
      ],
    });

    const caller = createCaller();

    await expect(
      caller.backlog.extractTicketFromPrompt({
        prompt: "Test",
        epicId: "epic-0",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("rejects AI output with invalid priority", async () => {
    mockAICreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              id: "EPIC-0-T5",
              title: "Bad Priority",
              type: "feature",
              priority: "P9",
              storyPoints: 2,
              dependencies: [],
              description: "Test",
              acceptanceCriteria: [
                "Given x When y Then z",
                "Given a When b Then c",
                "Given p When q Then r",
              ],
              aiDevPrompt: "Test",
            }),
          },
        },
      ],
    });

    const caller = createCaller();

    await expect(
      caller.backlog.extractTicketFromPrompt({
        prompt: "Test",
        epicId: "epic-0",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects AI output with non-array acceptanceCriteria", async () => {
    mockAICreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              id: "EPIC-0-T6",
              title: "Bad AC",
              type: "feature",
              priority: "P1",
              storyPoints: 2,
              dependencies: [],
              description: "Test",
              acceptanceCriteria: "not an array",
              aiDevPrompt: "Test",
            }),
          },
        },
      ],
    });

    const caller = createCaller();

    await expect(
      caller.backlog.extractTicketFromPrompt({
        prompt: "Test",
        epicId: "epic-0",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("brd.getUploadStatus", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
  });

  it("accepts a plain string uploadId", async () => {
    const { brdRouter } = await import("../brd");
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "upload-1",
          file_name: "doc.txt",
          file_path: "/uploads/doc.txt",
          status: "completed",
          validation_report: { matchScore: 90 },
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    });

    const caller = t
      .router({ brd: brdRouter })
      .createCaller({ req: {} as Context["req"], res: {} as Context["res"] });
    const result = await caller.brd.getUploadStatus("upload-1");

    expect(result.status).toBe("completed");
  });

  it("throws NOT_FOUND for unknown upload ID", async () => {
    const { brdRouter } = await import("../brd");
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const caller = t
      .router({ brd: brdRouter })
      .createCaller({ req: {} as Context["req"], res: {} as Context["res"] });

    await expect(
      caller.brd.getUploadStatus("unknown-id"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("listProjects returns uploaded projects", async () => {
    const { brdRouter } = await import("../brd");
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "proj-1",
          file_name: "spec.pdf",
          status: "completed",
          created_at: new Date("2026-01-01"),
        },
        {
          id: "proj-2",
          file_name: "requirements.docx",
          status: "pending",
          created_at: new Date("2026-01-02"),
        },
      ],
    });

    const caller = t
      .router({ brd: brdRouter })
      .createCaller({ req: {} as Context["req"], res: {} as Context["res"] });

    const projects = await caller.brd.listProjects();

    expect(projects).toHaveLength(2);
    expect(projects[0]?.id).toBe("proj-1");
    expect(projects[0]?.fileName).toBe("spec.pdf");
    expect(projects[0]?.status).toBe("completed");
  });
});
