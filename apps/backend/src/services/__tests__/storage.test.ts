import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFile, rm, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

import {
  createStorageService,
  LocalStorageService,
  S3StorageService,
} from "../storage";

const savedEnv = { ...process.env };

function resetEnv() {
  process.env = { ...savedEnv };
}

describe("LocalStorageService", () => {
  let uploadDir: string;
  let service: LocalStorageService;

  beforeEach(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), "specforge-test-"));
    service = new LocalStorageService(uploadDir);
  });

  afterEach(async () => {
    await rm(uploadDir, { recursive: true, force: true });
    resetEnv();
  });

  it("uploads a file and returns the file path", async () => {
    const buffer = Buffer.from("hello world", "utf-8");
    const key = `test-${randomUUID()}.txt`;

    const path = await service.uploadFile(key, buffer, "text/plain");

    expect(path).toContain(uploadDir);
    expect(path).toContain(key);
  });

  it("retrieves an uploaded file by key", async () => {
    const buffer = Buffer.from("test content", "utf-8");
    const key = `doc-${randomUUID()}.txt`;

    await service.uploadFile(key, buffer, "text/plain");
    const result = await service.getFile(key);

    expect(result).toEqual(buffer);
  });

  it("creates nested directories when uploading", async () => {
    const buffer = Buffer.from("nested", "utf-8");
    const key = `deep/nested/test-${randomUUID()}.txt`;

    const path = await service.uploadFile(key, buffer, "text/plain");

    const saved = await readFile(path, "utf-8");
    expect(saved).toBe("nested");
  });

  it("throws when getting a nonexistent file", async () => {
    await expect(service.getFile("nonexistent.txt")).rejects.toThrow();
  });

  it("preserves binary content round-trip", async () => {
    const buffer = Buffer.from([0x00, 0xff, 0x42, 0x7a, 0xfe]);
    const key = `binary-${randomUUID()}.bin`;

    await service.uploadFile(key, buffer, "application/octet-stream");
    const result = await service.getFile(key);

    expect(result).toEqual(buffer);
  });

  it("rejects path traversal via ../ in key", async () => {
    const buffer = Buffer.from("escape", "utf-8");

    await expect(
      service.uploadFile("../outside.txt", buffer, "text/plain"),
    ).rejects.toThrow("Path traversal detected");
  });

  it("rejects path traversal via absolute path in key", async () => {
    const buffer = Buffer.from("escape", "utf-8");

    await expect(
      service.uploadFile("/etc/passwd", buffer, "text/plain"),
    ).rejects.toThrow("Path traversal detected");
  });

  it("rejects getFile with traversal key", async () => {
    await expect(service.getFile("../outside.txt")).rejects.toThrow(
      "Path traversal detected",
    );
  });
});

describe("S3StorageService", () => {
  const sentCommands: (PutObjectCommand | GetObjectCommand)[] = [];
  const testBucket = "specforge-test-bucket";
  const testBody = Buffer.from("s3-test-body", "utf-8");

  const mockSend = vi.fn(
    async (command: PutObjectCommand | GetObjectCommand) => {
      sentCommands.push(command);

      if (command instanceof GetObjectCommand) {
        const stream = (async function* () {
          yield testBody;
        })();

        return { Body: stream };
      }

      return {};
    },
  );

  const mockClient = {
    send: mockSend,
    destroy: () => {},
  };

  const service = new S3StorageService(
    mockClient as unknown as NonNullable<
      ConstructorParameters<typeof S3StorageService>[0]
    >,
    testBucket,
  );

  it("sends PutObjectCommand with correct bucket, key, and content type", async () => {
    const key = "test-upload.json";
    const buffer = Buffer.from('{"ok":true}', "utf-8");

    const result = await service.uploadFile(key, buffer, "application/json");

    expect(result).toBe(`s3://${testBucket}/${key}`);
    expect(mockSend).toHaveBeenCalled();

    const cmd = sentCommands.at(-1);

    if (!(cmd instanceof PutObjectCommand)) {
      throw new Error("Expected PutObjectCommand");
    }

    const input = cmd.input as {
      Bucket: string;
      Key: string;
      Body: Buffer;
      ContentType: string;
    };

    expect(input.Bucket).toBe(testBucket);
    expect(input.Key).toBe(key);
    expect(input.Body).toEqual(buffer);
    expect(input.ContentType).toBe("application/json");
  });

  it("sends PutObjectCommand with different mime types", async () => {
    const key = "doc.pdf";
    const buffer = Buffer.from("pdf-content", "utf-8");

    await service.uploadFile(key, buffer, "application/pdf");

    const cmd = sentCommands.at(-1);

    if (!(cmd instanceof PutObjectCommand)) {
      throw new Error("Expected PutObjectCommand");
    }

    expect((cmd.input as { ContentType: string }).ContentType).toBe(
      "application/pdf",
    );
  });

  it("getFile returns the object body as Buffer", async () => {
    const key = "retrieve/test.json";

    const result = await service.getFile(key);

    expect(result).toEqual(testBody);

    const cmd = sentCommands.at(-1);

    if (!(cmd instanceof GetObjectCommand)) {
      throw new Error("Expected GetObjectCommand");
    }

    const input = cmd.input as { Bucket: string; Key: string };

    expect(input.Bucket).toBe(testBucket);
    expect(input.Key).toBe(key);
  });
});

describe("createStorageService factory", () => {
  afterEach(() => {
    resetEnv();
  });

  it("returns local service by default", () => {
    delete process.env["STORAGE_PROVIDER"];

    const service = createStorageService();
    expect(service).toBeDefined();
    expect(typeof service.uploadFile).toBe("function");
    expect(typeof service.getFile).toBe("function");
  });

  it("returns local service when STORAGE_PROVIDER=local", () => {
    process.env["STORAGE_PROVIDER"] = "local";

    const service = createStorageService();
    expect(service).toBeDefined();
  });

  it("throws when S3_BUCKET is not set with STORAGE_PROVIDER=s3", () => {
    process.env["STORAGE_PROVIDER"] = "s3";
    delete process.env["S3_BUCKET"];

    expect(() => createStorageService()).toThrow(
      "S3_BUCKET environment variable is required",
    );
  });
});
