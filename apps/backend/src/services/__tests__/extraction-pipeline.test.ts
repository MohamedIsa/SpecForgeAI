import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool, PoolClient } from "pg";
import type { StorageService } from "../storage";
import type OpenAI from "openai";
import { ExtractionPipeline, type UploadInput } from "../extraction-pipeline";
import { randomUUID } from "crypto";

interface MockRow {
  id: string;
  file_name: string;
  file_path: string | null;
  status: string;
  validation_report: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date | null;
}

function createMockPool(rows: MockRow[] = []): Pool {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  } as unknown as PoolClient;

  const mockQuery = vi.fn().mockResolvedValue({ rows });

  return {
    query: mockQuery,
    connect: vi.fn().mockResolvedValue(mockClient),
  } as unknown as Pool;
}

function createMockStorage(): StorageService {
  return {
    uploadFile: vi.fn().mockResolvedValue("/uploads/test.txt"),
    getFile: vi.fn(),
  };
}

function createMockAI(): OpenAI {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  epics: [
                    {
                      id: "epic-0",
                      title: "Foundation",
                      description: "Setup",
                      tickets: [
                        {
                          id: "EPIC-0-T1",
                          epicId: "epic-0",
                          title: "Setup Monorepo",
                          type: "setup",
                          priority: "P0",
                          storyPoints: 2,
                          status: "backlog",
                          dependencies: [],
                          description: "Establish monorepo.",
                          acceptanceCriteria: [
                            "Given a workspace, When initialized, Then deps are linked.",
                            "Given tsconfig files, When apps extend them, Then they compile.",
                            "Given a build, When errors exist, Then compiler catches them.",
                            "Given code exists, When lint runs, Then violations are caught.",
                            "Given tests exist, When test runner runs, Then they pass.",
                          ],
                          aiDevPrompt:
                            "Implement monorepo setup. Use pnpm workspaces. Create tsconfig in packages/config-typescript. Run typecheck to verify. Write compilation tests.",
                        },
                      ],
                    },
                  ],
                  validationReport: {
                    targetStack: "Fastify + React",
                    stackProvided: true,
                    matchScore: 90,
                    compatibilityGaps: [],
                    recommendations: ["Use pnpm"],
                  },
                }),
              },
            },
          ],
        }),
      },
    },
  } as unknown as OpenAI;
}

const validInput: UploadInput = {
  fileBase64: Buffer.from("Sample BRD content").toString("base64"),
  fileName: "requirements.txt",
  targetTechStack: "Fastify + React",
};

function getPrivateMethod<T extends object, K extends string>(
  obj: T,
  method: K,
): (...args: unknown[]) => unknown {
  const fn = (obj as Record<string, unknown>)[method] as (...args: unknown[]) => unknown;

  return fn.bind(obj);
}

describe("ExtractionPipeline.initiate", () => {
  let pool: Pool;
  let storage: StorageService;
  let aiClient: OpenAI;
  let pipeline: ExtractionPipeline;

  beforeEach(() => {
    pool = createMockPool();
    storage = createMockStorage();
    aiClient = createMockAI();
    pipeline = new ExtractionPipeline(pool, storage, aiClient);
  });

  it("returns an upload ID immediately", async () => {
    const uploadId = await pipeline.initiate(validInput);

    expect(uploadId).toBeDefined();
    expect(typeof uploadId).toBe("string");
    expect(uploadId.length).toBeGreaterThan(0);
  });

  it("inserts upload record with pending status", async () => {
    await pipeline.initiate(validInput);

    const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
    const insertCall = calls.find(
      (c: unknown[]) => (c[0] as string).includes("INSERT INTO brd_uploads"),
    );

    expect(insertCall).toBeDefined();

    const params = insertCall?.[1] as unknown[];
    expect(params?.[2]).toBe("pending");
  });

  it("records failed status for empty base64 input", async () => {
    const emptyInput: UploadInput = {
      fileBase64: "",
      fileName: "empty.txt",
    };

    const uploadId = randomUUID().replace(/-/g, "").slice(0, 16);

    const runPipeline = getPrivateMethod(
      pipeline,
      "runPipeline",
    ) as (
      uploadId: string,
      input: UploadInput,
    ) => Promise<void>;

    await runPipeline(uploadId, emptyInput);

    const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
    const failedUpdate = calls
      .filter(
        (c: unknown[]) => (c[0] as string).includes("UPDATE brd_uploads"),
      )
      .at(-1);

    expect((failedUpdate?.[1] as unknown[])?.[0]).toBe("failed");
  });
});

describe("ExtractionPipeline processing", () => {
  let pool: Pool;
  let storage: StorageService;
  let aiClient: OpenAI;
  let pipeline: ExtractionPipeline;

  beforeEach(() => {
    pool = createMockPool();
    storage = createMockStorage();
    aiClient = createMockAI();
    pipeline = new ExtractionPipeline(pool, storage, aiClient);
  });

  it("completes full pipeline with status transitions", async () => {
    const uploadId = randomUUID().replace(/-/g, "").slice(0, 16);

    const runPipeline = getPrivateMethod(
      pipeline,
      "runPipeline",
    ) as (
      uploadId: string,
      input: UploadInput,
    ) => Promise<void>;

    await runPipeline(uploadId, validInput);

    const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
    const updateCalls = calls.filter(
      (c: unknown[]) =>
        (c[0] as string).includes("UPDATE brd_uploads") &&
        (c[0] as string).includes("SET status"),
    );

    expect(updateCalls.length).toBeGreaterThanOrEqual(2);

    const firstStatus = (updateCalls[0]?.[1] as unknown[])?.[0];
    const lastStatus = (updateCalls[updateCalls.length - 1]?.[1] as unknown[])?.[0];

    expect(firstStatus).toBe("processing");
    expect(lastStatus).toBe("completed");
  });

  it("stores epics and tickets in a transaction", async () => {
    const uploadId = randomUUID().replace(/-/g, "").slice(0, 16);

    const runPipeline = getPrivateMethod(
      pipeline,
      "runPipeline",
    ) as (
      uploadId: string,
      input: UploadInput,
    ) => Promise<void>;

    await runPipeline(uploadId, validInput);

    const client = await (pool as unknown as { connect: () => Promise<PoolClient> }).connect();
    const insertCalls = (client.query as ReturnType<typeof vi.fn>).mock.calls;
    const hasEpicInsert = insertCalls.some(
      (c: unknown[]) =>
        (c[0] as string).includes("INSERT INTO epics"),
    );
    const hasTicketInsert = insertCalls.some(
      (c: unknown[]) =>
        (c[0] as string).includes("INSERT INTO tickets"),
    );

    expect(hasEpicInsert).toBe(true);
    expect(hasTicketInsert).toBe(true);
    expect(client.query).toHaveBeenCalledWith("BEGIN");
    expect(client.query).toHaveBeenCalledWith("COMMIT");
  });

  it("rolls back transaction on insertion failure", async () => {
    const mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if ((sql as string).includes("INSERT INTO tickets")) {
          return Promise.reject(new Error("DB write failed"));
        }

        return Promise.resolve();
      }),
      release: vi.fn(),
    };

    (pool as unknown as { connect: () => Promise<PoolClient> }).connect = vi.fn().mockResolvedValue(mockClient);

    const uploadId = randomUUID().replace(/-/g, "").slice(0, 16);

    const runPipeline = getPrivateMethod(
      pipeline,
      "runPipeline",
    ) as (
      uploadId: string,
      input: UploadInput,
    ) => Promise<void>;

    await runPipeline(uploadId, validInput);

    expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");

    const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
    const failedUpdate = calls
      .filter(
        (c: unknown[]) => (c[0] as string).includes("UPDATE brd_uploads"),
      )
      .at(-1);

    expect((failedUpdate?.[1] as unknown[])?.[0]).toBe("failed");
  });

  it("calls storage.uploadFile with decoded buffer", async () => {
    const uploadId = randomUUID().replace(/-/g, "").slice(0, 16);

    const runPipeline = getPrivateMethod(
      pipeline,
      "runPipeline",
    ) as (
      uploadId: string,
      input: UploadInput,
    ) => Promise<void>;

    await runPipeline(uploadId, validInput);

    expect(storage.uploadFile).toHaveBeenCalled();
    const call = (storage.uploadFile as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, Buffer, string];

    expect(call[2]).toBe("application/octet-stream");
    expect(call[1]).toBeInstanceOf(Buffer);
    expect(call[1].toString("utf-8")).toBe("Sample BRD content");
  });
});

describe("ExtractionPipeline.getStatus", () => {
  let pool: Pool;

  beforeEach(() => {
    const now = new Date();
    const mockRows: MockRow[] = [
      {
        id: "upload-1",
        file_name: "doc.txt",
        file_path: "/uploads/doc.txt",
        status: "completed",
        validation_report: { matchScore: 90 },
        created_at: now,
        updated_at: now,
      },
    ];

    pool = createMockPool(mockRows);
  });

  it("returns upload record via static method", async () => {
    const status = await ExtractionPipeline.getStatus(pool, "upload-1");

    expect(status.uploadId).toBe("upload-1");
    expect(status.status).toBe("completed");
    expect(status.validationReport).toEqual({ matchScore: 90 });
  });

  it("throws for unknown upload ID", async () => {
    pool = createMockPool([]);

    await expect(
      ExtractionPipeline.getStatus(pool, "unknown-id"),
    ).rejects.toThrow("not found");
  });
});
