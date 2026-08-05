import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  requestClarificationQuestions,
  truncateBrdText,
  AiUnavailableError,
  AiResponseError,
  AiConfigurationError,
  MAX_BRD_CHARS,
  MAX_QUESTIONS,
  type TechPreferenceContext,
} from "./ai";

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

/** Builds an OpenAI-compatible completion envelope wrapping `content`. */
function completion(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function questionsPayload(count: number): string {
  return JSON.stringify({
    questions: Array.from({ length: count }, (_, index) => ({
      ambiguity: `Ambiguity ${index + 1}`,
      question: `What exactly should behaviour ${index + 1} do?`,
      quickReplies: ["Option A", "Option B"],
    })),
  });
}

describe("requestClarificationQuestions — happy path", () => {
  it("returns structured questions parsed from the model output", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(completion(questionsPayload(2)));

    const questions = await requestClarificationQuestions({
      brdText: "# Requirements\nUsers must log in.",
      techPreferences: NO_PREFERENCES,
      fetchImpl,
    });

    expect(questions).toHaveLength(2);
    expect(questions[0]).toEqual({
      ambiguity: "Ambiguity 1",
      prompt: "What exactly should behaviour 1 do?",
      quickReplies: ["Option A", "Option B"],
    });
  });

  it("defaults quickReplies to an empty array when the model omits them", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      completion(
        JSON.stringify({ questions: [{ ambiguity: "Scope", question: "Which users?" }] }),
      ),
    );

    const questions = await requestClarificationQuestions({
      brdText: "content",
      techPreferences: NO_PREFERENCES,
      fetchImpl,
    });
    expect(questions[0]?.quickReplies).toEqual([]);
  });

  it("posts to the DeepSeek completions endpoint with the API key and JSON mode", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(completion(questionsPayload(1)));

    await requestClarificationQuestions({
      brdText: "content",
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

  it("includes supplied tech stack preferences in the prompt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(completion(questionsPayload(1)));

    await requestClarificationQuestions({
      brdText: "content",
      techPreferences: {
        frontend: "React",
        backend: "Fastify",
        database: null,
        infra: null,
      },
      fetchImpl,
    });

    const request = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as { messages: Array<{ content: string }> };
    const userMessage = body.messages[1]?.content ?? "";
    expect(userMessage).toContain("Frontend: React");
    expect(userMessage).toContain("Backend: Fastify");
  });

  it("states plainly when no tech preferences were supplied", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(completion(questionsPayload(1)));

    await requestClarificationQuestions({
      brdText: "content",
      techPreferences: NO_PREFERENCES,
      fetchImpl,
    });

    const request = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as { messages: Array<{ content: string }> };
    expect(body.messages[1]?.content).toContain("No preferred tech stack was supplied.");
  });
});

describe("requestClarificationQuestions — failure modes", () => {
  it("throws AiConfigurationError when the API key is missing", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    await expect(
      requestClarificationQuestions({
        brdText: "content",
        techPreferences: NO_PREFERENCES,
        fetchImpl: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(AiConfigurationError);
  });

  it("throws AiUnavailableError on a network failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      requestClarificationQuestions({
        brdText: "content",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("throws AiUnavailableError when the request times out", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("aborted", "TimeoutError"));
    await expect(
      requestClarificationQuestions({
        brdText: "content",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
        timeoutMs: 10,
      }),
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("throws AiUnavailableError on a 5xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 502 }));
    await expect(
      requestClarificationQuestions({
        brdText: "content",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("throws AiUnavailableError when rate limited", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("slow down", { status: 429 }));
    await expect(
      requestClarificationQuestions({
        brdText: "content",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it.each([401, 403])("throws AiConfigurationError on HTTP %i", async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status }));
    await expect(
      requestClarificationQuestions({
        brdText: "content",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiConfigurationError);
  });

  it("throws AiResponseError when the body is not JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("<html>gateway</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(
      requestClarificationQuestions({
        brdText: "content",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiResponseError);
  });

  it("throws AiResponseError when the completion envelope is malformed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ unexpected: true }), { status: 200 }));
    await expect(
      requestClarificationQuestions({
        brdText: "content",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiResponseError);
  });

  it("throws AiResponseError when the model content is not JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(completion("I cannot help with that."));
    await expect(
      requestClarificationQuestions({
        brdText: "content",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiResponseError);
  });

  it("throws AiResponseError when questions are missing required fields", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(completion(JSON.stringify({ questions: [{ ambiguity: "no question" }] })));
    await expect(
      requestClarificationQuestions({
        brdText: "content",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiResponseError);
  });

  it("throws AiResponseError when the model returns zero questions", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(completion(JSON.stringify({ questions: [] })));
    await expect(
      requestClarificationQuestions({
        brdText: "content",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiResponseError);
  });

  it("throws AiResponseError when the model returns more questions than allowed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(completion(questionsPayload(MAX_QUESTIONS + 1)));
    await expect(
      requestClarificationQuestions({
        brdText: "content",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiResponseError);
  });

  it("rejects an empty BRD without calling the provider", async () => {
    const fetchImpl = vi.fn();
    await expect(
      requestClarificationQuestions({
        brdText: "   \n  ",
        techPreferences: NO_PREFERENCES,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiResponseError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("truncateBrdText", () => {
  it("leaves a short document untouched", () => {
    expect(truncateBrdText("short")).toBe("short");
  });

  it("truncates an oversized document and marks it", () => {
    const huge = "x".repeat(MAX_BRD_CHARS + 5_000);
    const result = truncateBrdText(huge);
    expect(result.length).toBeLessThan(huge.length);
    expect(result).toContain("[document truncated for analysis]");
  });

  it("keeps an oversized document within the cap plus the marker", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(completion(questionsPayload(1)));
    await requestClarificationQuestions({
      brdText: "y".repeat(MAX_BRD_CHARS * 2),
      techPreferences: NO_PREFERENCES,
      fetchImpl,
    });

    const request = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as { messages: Array<{ content: string }> };
    expect(body.messages[1]?.content).toContain("[document truncated for analysis]");
  });
});
