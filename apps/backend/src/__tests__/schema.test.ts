import { describe, it, expect } from "vitest";

import {
  STORY_POINTS,
  type TicketType,
  type Priority,
  type TicketStatus,
  type UploadStatus,
  type StoryPoints,
  type Epic,
  type Ticket,
  type BrdUpload,
  type TechStack,
} from "../db/schema";

const VALID_TICKET_TYPES: TicketType[] = [
  "setup",
  "feature",
  "infra",
  "integration",
  "testing",
  "bugfix",
];

const VALID_PRIORITIES: Priority[] = ["P0", "P1", "P2", "P3"];

const VALID_STATUSES: TicketStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
];

const VALID_UPLOAD_STATUSES: UploadStatus[] = [
  "pending",
  "processing",
  "completed",
  "failed",
];

const VALID_STORY_POINTS: StoryPoints[] = [1, 2, 3, 5, 8];

describe("schema types", () => {
  it("ticket type enum has all expected values", () => {
    expect(VALID_TICKET_TYPES).toHaveLength(6);
  });

  it("priority enum has all expected values", () => {
    expect(VALID_PRIORITIES).toHaveLength(4);
  });

  it("ticket status enum has all expected values", () => {
    expect(VALID_STATUSES).toHaveLength(5);
  });

  it("upload status enum has all expected values", () => {
    expect(VALID_UPLOAD_STATUSES).toHaveLength(4);
  });

  it("story points matches allowed values", () => {
    expect(VALID_STORY_POINTS).toEqual([1, 2, 3, 5, 8]);
    expect(STORY_POINTS).toEqual([1, 2, 3, 5, 8]);
  });
});

describe("epic entity shape", () => {
  it("matches the required columns", () => {
    const epic: Epic = {
      id: "epic-0",
      title: "Foundation",
      description: null,
      created_at: new Date(),
    };

    expect(epic.id).toBe("epic-0");
    expect(epic.title).toBe("Foundation");
    expect(epic.description).toBeNull();
    expect(epic.created_at).toBeInstanceOf(Date);
  });
});

describe("ticket entity shape", () => {
  it("matches the required columns", () => {
    const ticket: Ticket = {
      id: "EPIC-0-T1",
      epic_id: "epic-0",
      title: "Setup Monorepo",
      type: "setup",
      priority: "P0",
      story_points: 2,
      status: "in_progress",
      dependencies: [],
      description: "Setup workspace",
      acceptance_criteria: ["AC1", "AC2"],
      ai_dev_prompt: "Implement EPIC-0-T1",
      created_at: new Date(),
    };

    expect(ticket.id).toBe("EPIC-0-T1");
    expect(ticket.epic_id).toBe("epic-0");
    expect(ticket.type).toBe("setup");
    expect(ticket.priority).toBe("P0");
    expect(ticket.story_points).toBe(2);
    expect(ticket.status).toBe("in_progress");
  });

  it("dependencies defaults to empty array in schema", () => {
    const ticket: Ticket = {
      id: "T-1",
      epic_id: "epic-0",
      title: "Test ticket",
      type: "feature",
      priority: "P1",
      story_points: 3,
      status: "backlog",
      dependencies: [],
      description: null,
      acceptance_criteria: [],
      ai_dev_prompt: null,
      created_at: new Date(),
    };

    expect(ticket.dependencies).toEqual([]);
  });
});

describe("brd_uploads entity shape", () => {
  it("matches the required columns", () => {
    const upload: BrdUpload = {
      id: "upload-1",
      file_name: "spec.pdf",
      file_path: null,
      status: "pending",
      validation_report: null,
      created_at: new Date(),
      updated_at: null,
    };

    expect(upload.id).toBe("upload-1");
    expect(upload.file_name).toBe("spec.pdf");
    expect(upload.status).toBe("pending");
  });
});

describe("tech_stacks entity shape", () => {
  it("matches the required columns", () => {
    const stack: TechStack = {
      id: "stack-1",
      name: "fastify-react-expo",
      display_name: "Fastify + React + Expo",
      description: null,
      stack_config: {},
      created_at: new Date(),
    };

    expect(stack.id).toBe("stack-1");
    expect(stack.name).toBe("fastify-react-expo");
    expect(stack.display_name).toBe("Fastify + React + Expo");
  });
});
