import { describe, it, expect, vi, afterEach } from "vitest";
import OpenAI from "openai";

import {
  extractBacklog,
  createDeepSeekClient,
  type ExtractionResult,
  type ExtractedTicket,
} from "../ai";

function buildMockResponse(result: ExtractionResult) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(result),
        },
      },
    ],
  };
}

function buildValidTicket(
  overrides: Partial<ExtractedTicket> = {},
): ExtractedTicket {
  return {
    id: "EPIC-0-T1",
    epicId: "epic-0",
    title: "Setup Monorepo",
    type: "setup",
    priority: "P0",
    storyPoints: 2,
    status: "backlog",
    dependencies: [],
    description: "Establish monorepo structure.",
    acceptanceCriteria: [
      "Given a workspace is initialized, When pnpm installs are run, Then all workspace dependencies are linked.",
      "Given shared tsconfig files exist, When backend, web, and mobile extend them, Then they compile successfully.",
      "Given a build is triggered, When syntax errors exist, Then the compiler catches them.",
      additionalAC(),
    ],
    aiDevPrompt:
      "You are implementing EPIC-0-T1. Setup a monorepo workspace using pnpm workspaces. Create base tsconfig in packages/config-typescript. Ensure strict TypeScript. Write tests for compilation.",
    ...overrides,
  };
}

function additionalAC(): string {
  return "Given production code, When tests run, Then all pass.";
}

function buildValidResult(): ExtractionResult {
  return {
    epics: [
      {
        id: "epic-0",
        title: "Foundation",
        description: "Project setup and infrastructure",
        tickets: [buildValidTicket()],
      },
    ],
    validationReport: {
      targetStack: "Fastify + React + Expo",
      stackProvided: true,
      matchScore: 95,
      compatibilityGaps: [],
      recommendations: ["Use pnpm for monorepo management."],
    },
  };
}

describe("extractBacklog", () => {
  it("parses a valid LLM response correctly", async () => {
    const result = buildValidResult();
    const mockCreate = vi.fn().mockResolvedValue(buildMockResponse(result));
    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as unknown as OpenAI;

    const extracted = await extractBacklog(mockClient, {
      brdText: "Sample BRD text",
    });

    expect(extracted.epics).toHaveLength(1);
    expect(extracted.epics[0]?.id).toBe("epic-0");
    expect(extracted.epics[0]?.tickets).toHaveLength(1);
    expect(extracted.epics[0]?.tickets[0]?.id).toBe("EPIC-0-T1");
    expect(extracted.validationReport.stackProvided).toBe(true);
    expect(extracted.validationReport.matchScore).toBe(95);
  });

  it("sends targetTechStack in the user prompt", async () => {
    const result = buildValidResult();
    const mockCreate = vi.fn().mockResolvedValue(buildMockResponse(result));
    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as unknown as OpenAI;

    await extractBacklog(mockClient, {
      brdText: "Sample BRD",
      targetTechStack: "Fastify + React + Expo",
    });

    const userContent = mockCreate.mock.calls[0]?.[0]?.messages?.[1]
      ?.content as string | undefined;

    expect(userContent).toContain("Fastify + React + Expo");
    expect(userContent).toContain("Do NOT recommend alternative stacks");
  });

  it("recommends a stack when none is provided", async () => {
    const result = buildValidResult();
    const mockCreate = vi.fn().mockResolvedValue(buildMockResponse(result));
    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as unknown as OpenAI;

    await extractBacklog(mockClient, {
      brdText: "Sample BRD",
    });

    const userContent = mockCreate.mock.calls[0]?.[0]?.messages?.[1]
      ?.content as string | undefined;

    expect(userContent).toContain("recommend an appropriate technology stack");
  });

  it("returns multiple epics with tickets", async () => {
    const ticket2 = buildValidTicket({
      id: "EPIC-1-T1",
      epicId: "epic-1",
      dependencies: ["EPIC-0-T1"],
    });

    const result: ExtractionResult = {
      epics: [
        {
          id: "epic-0",
          title: "Setup",
          description: "Foundation",
          tickets: [buildValidTicket()],
        },
        {
          id: "epic-1",
          title: "Features",
          description: "Core features",
          tickets: [ticket2],
        },
      ],
      validationReport: {
        targetStack: null,
        stackProvided: false,
        matchScore: 0,
        compatibilityGaps: [],
        recommendations: ["Use Fastify and React"],
      },
    };

    const mockCreate = vi.fn().mockResolvedValue(buildMockResponse(result));
    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as unknown as OpenAI;

    const extracted = await extractBacklog(mockClient, {
      brdText: "Large BRD",
    });

    expect(extracted.epics).toHaveLength(2);
    expect(extracted.epics[1]?.tickets[0]?.dependencies).toContain(
      "EPIC-0-T1",
    );
  });

  it("throws when response is empty", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "" } }],
    });
    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as unknown as OpenAI;

    await expect(
      extractBacklog(mockClient, { brdText: "BRD" }),
    ).rejects.toThrow("empty response");
  });

  it("throws when response is not valid JSON", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "not json" } }],
    });
    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as unknown as OpenAI;

    await expect(
      extractBacklog(mockClient, { brdText: "BRD" }),
    ).rejects.toThrow(/valid JSON/);
  });

  it("throws when ticket has fewer than 3 acceptance criteria", async () => {
    const ticket = buildValidTicket();
    ticket.acceptanceCriteria = ["AC1", "AC2"];

    const result: ExtractionResult = {
      epics: [{ id: "epic-0", title: "E", description: "D", tickets: [ticket] }],
      validationReport: {
        targetStack: null,
        stackProvided: false,
        matchScore: 0,
        compatibilityGaps: [],
        recommendations: [],
      },
    };

    const mockCreate = vi.fn().mockResolvedValue(buildMockResponse(result));
    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as unknown as OpenAI;

    await expect(
      extractBacklog(mockClient, { brdText: "BRD" }),
    ).rejects.toThrow("fewer than 3 acceptance criteria");
  });

  it("throws when ticket has short aiDevPrompt", async () => {
    const ticket = buildValidTicket();
    ticket.aiDevPrompt = "Too short";

    const result: ExtractionResult = {
      epics: [{ id: "epic-0", title: "E", description: "D", tickets: [ticket] }],
      validationReport: {
        targetStack: null,
        stackProvided: false,
        matchScore: 0,
        compatibilityGaps: [],
        recommendations: [],
      },
    };

    const mockCreate = vi.fn().mockResolvedValue(buildMockResponse(result));
    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as unknown as OpenAI;

    await expect(
      extractBacklog(mockClient, { brdText: "BRD" }),
    ).rejects.toThrow("insufficient aiDevPrompt");
  });

  it("throws when epics array is empty", async () => {
    const result: ExtractionResult = {
      epics: [],
      validationReport: {
        targetStack: null,
        stackProvided: false,
        matchScore: 0,
        compatibilityGaps: [],
        recommendations: [],
      },
    };

    const mockCreate = vi.fn().mockResolvedValue(buildMockResponse(result));
    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as unknown as OpenAI;

    await expect(
      extractBacklog(mockClient, { brdText: "BRD" }),
    ).rejects.toThrow("at least one epic");
  });

  it("throws when ticket type is not a valid enum value", async () => {
    const ticket = buildValidTicket();
    ticket.type = "invalid" as unknown as Extract<ExtractedTicket, "type">;

    const result: ExtractionResult = {
      epics: [{ id: "epic-0", title: "E", description: "D", tickets: [ticket] }],
      validationReport: {
        targetStack: null,
        stackProvided: false,
        matchScore: 50,
        compatibilityGaps: [],
        recommendations: [],
      },
    };

    const mockCreate = vi.fn().mockResolvedValue(buildMockResponse(result));
    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as unknown as OpenAI;

    await expect(
      extractBacklog(mockClient, { brdText: "BRD" }),
    ).rejects.toThrow("invalid type");
  });

  it("throws when ticket priority is invalid", async () => {
    const ticket = buildValidTicket();
    ticket.priority = "P9" as unknown as Extract<ExtractedTicket, "priority">;

    const result: ExtractionResult = {
      epics: [{ id: "epic-0", title: "E", description: "D", tickets: [ticket] }],
      validationReport: {
        targetStack: null,
        stackProvided: false,
        matchScore: 50,
        compatibilityGaps: [],
        recommendations: [],
      },
    };

    const mockCreate = vi.fn().mockResolvedValue(buildMockResponse(result));
    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as unknown as OpenAI;

    await expect(
      extractBacklog(mockClient, { brdText: "BRD" }),
    ).rejects.toThrow("invalid priority");
  });

  it("throws when ticket storyPoints is invalid", async () => {
    const ticket = buildValidTicket();
    void Object.assign(ticket, { storyPoints: 13 });

    const result: ExtractionResult = {
      epics: [{ id: "epic-0", title: "E", description: "D", tickets: [ticket] }],
      validationReport: {
        targetStack: null,
        stackProvided: false,
        matchScore: 50,
        compatibilityGaps: [],
        recommendations: [],
      },
    };

    const mockCreate = vi.fn().mockResolvedValue(buildMockResponse(result));
    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as unknown as OpenAI;

    await expect(
      extractBacklog(mockClient, { brdText: "BRD" }),
    ).rejects.toThrow("invalid storyPoints");
  });

  it("throws when ticket status is not 'backlog'", async () => {
    const ticket = buildValidTicket();
    ticket.status = "done";

    const result: ExtractionResult = {
      epics: [{ id: "epic-0", title: "E", description: "D", tickets: [ticket] }],
      validationReport: {
        targetStack: null,
        stackProvided: false,
        matchScore: 50,
        compatibilityGaps: [],
        recommendations: [],
      },
    };

    const mockCreate = vi.fn().mockResolvedValue(buildMockResponse(result));
    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as unknown as OpenAI;

    await expect(
      extractBacklog(mockClient, { brdText: "BRD" }),
    ).rejects.toThrow('status "backlog"');
  });

  it("throws when acceptance criteria lacks Given/When/Then format", async () => {
    const ticket = buildValidTicket();
    ticket.acceptanceCriteria = [
      "Some text without GWT",
      "Another line that is wrong",
      "Third improper one",
      "Given x When y Then z",
    ];

    const result: ExtractionResult = {
      epics: [{ id: "epic-0", title: "E", description: "D", tickets: [ticket] }],
      validationReport: {
        targetStack: null,
        stackProvided: false,
        matchScore: 50,
        compatibilityGaps: [],
        recommendations: [],
      },
    };

    const mockCreate = vi.fn().mockResolvedValue(buildMockResponse(result));
    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as unknown as OpenAI;

    await expect(
      extractBacklog(mockClient, { brdText: "BRD" }),
    ).rejects.toThrow("Given/When/Then");
  });

  it("throws when validationReport.matchScore is out of range", async () => {
    const ticket = buildValidTicket();

    const result: ExtractionResult = {
      epics: [{ id: "epic-0", title: "E", description: "D", tickets: [ticket] }],
      validationReport: {
        targetStack: null,
        stackProvided: false,
        matchScore: 150,
        compatibilityGaps: [],
        recommendations: [],
      },
    };

    const mockCreate = vi.fn().mockResolvedValue(buildMockResponse(result));
    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as unknown as OpenAI;

    await expect(
      extractBacklog(mockClient, { brdText: "BRD" }),
    ).rejects.toThrow("between 0 and 100");
  });

  it("throws when validationReport.compatibilityGaps is not an array", async () => {
    const ticket = buildValidTicket();

    const result = {
      epics: [{ id: "epic-0", title: "E", description: "D", tickets: [ticket] }],
      validationReport: {
        targetStack: null,
        stackProvided: false,
        matchScore: 50,
        compatibilityGaps: "not an array",
        recommendations: [],
      },
    };

    const mockCreate = vi
      .fn()
      .mockResolvedValue(buildMockResponse(result as unknown as ExtractionResult));
    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as unknown as OpenAI;

    await expect(
      extractBacklog(mockClient, { brdText: "BRD" }),
    ).rejects.toThrow("compatibilityGaps must be an array");
  });
});

describe("createDeepSeekClient", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when DEEPSEEK_API_KEY is not set", () => {
    delete process.env["DEEPSEEK_API_KEY"];

    expect(() => createDeepSeekClient()).toThrow("DEEPSEEK_API_KEY");
  });

  it("creates client with custom base URL", () => {
    process.env["DEEPSEEK_API_KEY"] = "test-key";
    process.env["DEEPSEEK_BASE_URL"] = "https://custom.api/v1";

    const client = createDeepSeekClient();
    expect(client).toBeDefined();
  });
});
