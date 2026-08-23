import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  requestBacklogGeneration,
  validateBacklogReferences,
  MAX_EPICS,
  MAX_TICKETS_PER_EPIC,
  type TechPreferenceContext,
  type BacklogDraft,
  type GeneratedTicketDraft,
} from "./backlog-generator";
import { AiUnavailableError, AiResponseError, AiConfigurationError } from "./ai";

const NO_PREFERENCES: TechPreferenceContext = {
  frontend: null,
  backend: null,
  database: null,
  infra: null,
};

const originalKey = process.env.DEEPSEEK_API_KEY;

beforeEach(() => {
  process.env.DEEPSEEK_API_KEY = "test-key";
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalKey;
});

function completion(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function ticket(overrides: Partial<GeneratedTicketDraft> = {}): GeneratedTicketDraft {
  return {
    ref: "T1",
    title: "Add login form",
    type: "story",
    priority: "P1",
    storyPoints: 3,
    acceptanceCriteria: [{ given: "a visitor", when: "they submit valid credentials", expectedResult: "they are logged in" }],
    aiDevPrompt: "Implement a login form with email and password fields.",
    dependsOn: [],
    ...overrides,
  };
}

function backlogPayload(
  epics: Array<{ title: string; tickets: Array<Partial<GeneratedTicketDraft>> }>,
): string {
  return JSON.stringify({ epics });
}

describe("requestBacklogGeneration — happy path", () => {
  it("returns structured epics and tickets parsed from the model output", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      completion(
        backlogPayload([
          { title: "Authentication", tickets: [ticket({ ref: "T1" }), ticket({ ref: "T2", dependsOn: ["T1"] })] },
        ]),
      ),
    );

    const draft = await requestBacklogGeneration({
      brdText: "Users must be able to log in.",
      clarificationContext: "Auth method: email + password",
      techPreferences: NO_PREFERENCES,
      fetchImpl,
    });

    expect(draft.epics).toHaveLength(1);
    expect(draft.epics[0]?.title).toBe("Authentication");
    expect(draft.epics[0]?.tickets).toHaveLength(2);
    expect(draft.epics[0]?.tickets[1]?.dependsOn).toEqual(["T1"]);
  });

  it("defaults dependsOn to an empty array when the model omits it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      completion(backlogPayload([{ title: "Epic", tickets: [ticket({ dependsOn: undefined })] }])),
    );
    const draft = await requestBacklogGeneration({
      brdText: "content",
      clarificationContext: "context",
      techPreferences: NO_PREFERENCES,
      fetchImpl,
    });
    expect(draft.epics[0]?.tickets[0]?.dependsOn).toEqual([]);
  });

  it("posts to the DeepSeek completions endpoint with the API key and JSON mode", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(completion(backlogPayload([{ title: "Epic", tickets: [ticket()] }])));

    await requestBacklogGeneration({
      brdText: "content",
      clarificationContext: "context",
      techPreferences: NO_PREFERENCES,
      fetchImpl,
    });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toContain("/chat/completions");
    const request = init as RequestInit;
    const headers = request.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-key");
    const body: unknown = JSON.parse(String(request.body));
    expect(body).toMatchObject({ response_format: { type: "json_object" } });
  });

  it("includes the BRD text, clarification context and tech stack in the prompt", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(completion(backlogPayload([{ title: "Epic", tickets: [ticket()] }])));

    await requestBacklogGeneration({
      brdText: "Users must reset their password.",
      clarificationContext: "Reset method: email link",
      techPreferences: { frontend: "React", backend: "Fastify", database: null, infra: null },
      fetchImpl,
    });

    const request = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as { messages: Array<{ content: string }> };
    const userMessage = body.messages[1]?.content ?? "";
    expect(userMessage).toContain("Users must reset their password.");
    expect(userMessage).toContain("Reset method: email link");
    expect(userMessage).toContain("Frontend: React");
  });
});

describe("requestBacklogGeneration — failure modes", () => {
  it("throws AiConfigurationError when the API key is missing", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    await expect(
      requestBacklogGeneration({
        brdText: "content",
        clarificationContext: "context",
        techPreferences: NO_PREFERENCES,
        fetchImpl: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(AiConfigurationError);
  });

  it("throws AiUnavailableError on a network failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      requestBacklogGeneration({
        brdText: "content",
        clarificationContext: "context",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("throws AiUnavailableError on a 5xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 502 }));
    await expect(
      requestBacklogGeneration({
        brdText: "content",
        clarificationContext: "context",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it.each([401, 403])("throws AiConfigurationError on HTTP %i", async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status }));
    await expect(
      requestBacklogGeneration({
        brdText: "content",
        clarificationContext: "context",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiConfigurationError);
  });

  it("throws AiResponseError when the body is not JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<html></html>", { status: 200 }));
    await expect(
      requestBacklogGeneration({
        brdText: "content",
        clarificationContext: "context",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiResponseError);
  });

  it("throws AiResponseError when the model content is not JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(completion("not json"));
    await expect(
      requestBacklogGeneration({
        brdText: "content",
        clarificationContext: "context",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiResponseError);
  });

  it("throws AiResponseError when a ticket is missing required fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      completion(JSON.stringify({ epics: [{ title: "Epic", tickets: [{ ref: "T1" }] }] })),
    );
    await expect(
      requestBacklogGeneration({
        brdText: "content",
        clarificationContext: "context",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiResponseError);
  });

  it("throws AiResponseError when the model returns zero epics", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(completion(JSON.stringify({ epics: [] })));
    await expect(
      requestBacklogGeneration({
        brdText: "content",
        clarificationContext: "context",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiResponseError);
  });

  it("throws AiResponseError when the model returns more epics than allowed", async () => {
    const epics = Array.from({ length: MAX_EPICS + 1 }, (_, index) => ({
      title: `Epic ${index}`,
      tickets: [ticket({ ref: `T${index}` })],
    }));
    const fetchImpl = vi.fn().mockResolvedValue(completion(backlogPayload(epics)));
    await expect(
      requestBacklogGeneration({
        brdText: "content",
        clarificationContext: "context",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiResponseError);
  });

  it("throws AiResponseError when an epic has more tickets than allowed", async () => {
    const tickets = Array.from({ length: MAX_TICKETS_PER_EPIC + 1 }, (_, index) =>
      ticket({ ref: `T${index}` }),
    );
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(completion(backlogPayload([{ title: "Epic", tickets }])));
    await expect(
      requestBacklogGeneration({
        brdText: "content",
        clarificationContext: "context",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiResponseError);
  });

  it("throws AiResponseError on a duplicate ticket ref across epics", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      completion(
        backlogPayload([
          { title: "Epic A", tickets: [ticket({ ref: "T1" })] },
          { title: "Epic B", tickets: [ticket({ ref: "T1" })] },
        ]),
      ),
    );
    await expect(
      requestBacklogGeneration({
        brdText: "content",
        clarificationContext: "context",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toThrow(/duplicate ticket reference/);
  });

  it("throws AiResponseError when a ticket depends on itself", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      completion(backlogPayload([{ title: "Epic", tickets: [ticket({ ref: "T1", dependsOn: ["T1"] })] }])),
    );
    await expect(
      requestBacklogGeneration({
        brdText: "content",
        clarificationContext: "context",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toThrow(/cannot depend on itself/);
  });

  it("throws AiResponseError when a ticket depends on an unknown reference", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      completion(
        backlogPayload([{ title: "Epic", tickets: [ticket({ ref: "T1", dependsOn: ["T99"] })] }]),
      ),
    );
    await expect(
      requestBacklogGeneration({
        brdText: "content",
        clarificationContext: "context",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toThrow(/unknown reference/);
  });

  it("rejects an empty BRD without calling the provider", async () => {
    const fetchImpl = vi.fn();
    await expect(
      requestBacklogGeneration({
        brdText: "   ",
        clarificationContext: "context",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiResponseError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an empty clarification context without calling the provider", async () => {
    const fetchImpl = vi.fn();
    await expect(
      requestBacklogGeneration({
        brdText: "content",
        clarificationContext: "   ",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiResponseError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("validateBacklogReferences", () => {
  it("passes for a well-formed backlog", () => {
    const draft: BacklogDraft = {
      epics: [
        {
          title: "Epic",
          tickets: [ticket({ ref: "T1" }), ticket({ ref: "T2", dependsOn: ["T1"] })],
        },
      ],
    };
    expect(() => validateBacklogReferences(draft)).not.toThrow();
  });
});
