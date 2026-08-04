import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { createTestCaller } from "../test-utils";
import { pool } from "../db/pool";
import { signAccessToken } from "../lib/jwt";
import {
  registerBrdUploadRoute,
  BRD_UPLOAD_LIMITS,
  type UploadResponseBody,
} from "./brd-upload";

const EICAR =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

let app: FastifyInstance;
let clamd: net.Server;
let uploadDir: string;
const originalEnv = {
  host: process.env.CLAMAV_HOST,
  port: process.env.CLAMAV_PORT,
  uploadDir: process.env.BRD_UPLOAD_DIR,
};

/** Fake clamd speaking the real INSTREAM protocol; flags anything containing EICAR. */
function createFakeClamd(): net.Server {
  return net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let handshakeSeen = false;
    let payload = Buffer.alloc(0);
    let replied = false;

    socket.on("error", () => {
      // The client destroys the socket as soon as it has a verdict.
    });

    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (!handshakeSeen) {
        const terminator = buffer.indexOf(0);
        if (terminator === -1) return;
        handshakeSeen = true;
        buffer = buffer.subarray(terminator + 1);
      }

      while (buffer.byteLength >= 4 && !replied) {
        const frameLength = buffer.readUInt32BE(0);
        if (frameLength === 0) {
          replied = true;
          socket.end("stream: OK\0");
          return;
        }
        if (buffer.byteLength < 4 + frameLength) return;
        payload = Buffer.concat([payload, buffer.subarray(4, 4 + frameLength)]);
        buffer = buffer.subarray(4 + frameLength);
        if (payload.includes(EICAR)) {
          replied = true;
          socket.end("stream: Win.Test.EICAR_HDB-1 FOUND\0");
          return;
        }
      }
    });
  });
}

interface MultipartFileSpec {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

const BOUNDARY = "----SpecForgeTestBoundary7MA4YWxkTrZu0gW";

function buildMultipartBody(files: MultipartFileSpec[]): Buffer {
  const parts: Buffer[] = [];
  for (const file of files) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\n` +
          `Content-Disposition: form-data; name="files"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType ?? "application/octet-stream"}\r\n\r\n`,
        "utf8",
      ),
    );
    parts.push(Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, "utf8"));
    parts.push(Buffer.from("\r\n", "utf8"));
  }
  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`, "utf8"));
  return Buffer.concat(parts);
}

async function upload(options: {
  token: string | null;
  projectId: string | null;
  files: MultipartFileSpec[];
  multipart?: boolean;
}): Promise<{ statusCode: number; body: UploadResponseBody }> {
  const headers: Record<string, string> = {
    "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
  };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.multipart === false) headers["content-type"] = "application/json";

  const response = await app.inject({
    method: "POST",
    url: options.projectId ? `/api/brd/upload?projectId=${options.projectId}` : "/api/brd/upload",
    headers,
    payload:
      options.multipart === false ? JSON.stringify({}) : buildMultipartBody(options.files),
  });

  const parsed: unknown = response.json();
  return { statusCode: response.statusCode, body: parsed as UploadResponseBody };
}

function uniqueEmail(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueKey(): string {
  return `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

const createdUserIds: string[] = [];

async function createUser(fullName: string): Promise<{ id: string; email: string; token: string }> {
  const email = uniqueEmail();
  const result = await createTestCaller(null).caller.auth.signup({
    fullName,
    email,
    password: "a-strong-password",
  });
  createdUserIds.push(result.user.id);
  return { id: result.user.id, email, token: signAccessToken(result.user.id) };
}

async function createProject(ownerId: string): Promise<string> {
  const created = await createTestCaller(ownerId).caller.project.createProject({
    name: "BRD Upload Test Project",
    key: uniqueKey(),
    template: "kanban",
  });
  return created.project.id;
}

beforeAll(async () => {
  clamd = createFakeClamd();
  await new Promise<void>((resolve) => clamd.listen(0, "127.0.0.1", resolve));
  const address = clamd.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected the fake clamd server to bind a TCP port");
  }
  process.env.CLAMAV_HOST = "127.0.0.1";
  process.env.CLAMAV_PORT = String(address.port);

  uploadDir = await mkdtemp(path.join(os.tmpdir(), "specforge-upload-test-"));
  process.env.BRD_UPLOAD_DIR = uploadDir;

  app = Fastify();
  await app.register(multipart, { limits: BRD_UPLOAD_LIMITS });
  await registerBrdUploadRoute(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await new Promise<void>((resolve) => clamd.close(() => resolve()));
  await rm(uploadDir, { recursive: true, force: true });

  if (originalEnv.host === undefined) delete process.env.CLAMAV_HOST;
  else process.env.CLAMAV_HOST = originalEnv.host;
  if (originalEnv.port === undefined) delete process.env.CLAMAV_PORT;
  else process.env.CLAMAV_PORT = originalEnv.port;
  if (originalEnv.uploadDir === undefined) delete process.env.BRD_UPLOAD_DIR;
  else process.env.BRD_UPLOAD_DIR = originalEnv.uploadDir;
});

afterEach(async () => {
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop();
    await pool.query("DELETE FROM users WHERE id = $1", [id]);
  }
});

async function storedFileCount(projectId: string): Promise<number> {
  try {
    const entries = await readdir(path.join(uploadDir, projectId));
    return entries.length;
  } catch {
    return 0;
  }
}

describe("POST /api/brd/upload — authentication and authorisation", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const owner = await createUser("Unauth Owner");
    const projectId = await createProject(owner.id);
    const response = await upload({
      token: null,
      projectId,
      files: [{ filename: "spec.md", content: "# Spec" }],
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects a non-member with 403", async () => {
    const owner = await createUser("Member Owner");
    const outsider = await createUser("Outsider");
    const projectId = await createProject(owner.id);

    const response = await upload({
      token: outsider.token,
      projectId,
      files: [{ filename: "spec.md", content: "# Spec" }],
    });
    expect(response.statusCode).toBe(403);
    expect(await storedFileCount(projectId)).toBe(0);
  });

  it("rejects a viewer with 403", async () => {
    const owner = await createUser("Viewer Test Owner");
    const viewer = await createUser("Viewer");
    const projectId = await createProject(owner.id);
    await createTestCaller(owner.id).caller.project.inviteMember({
      projectId,
      email: viewer.email,
      role: "viewer",
    });

    const response = await upload({
      token: viewer.token,
      projectId,
      files: [{ filename: "spec.md", content: "# Spec" }],
    });
    expect(response.statusCode).toBe(403);
    expect(await storedFileCount(projectId)).toBe(0);
  });

  it("allows an editor to upload", async () => {
    const owner = await createUser("Editor Test Owner");
    const editor = await createUser("Editor");
    const projectId = await createProject(owner.id);
    await createTestCaller(owner.id).caller.project.inviteMember({
      projectId,
      email: editor.email,
      role: "editor",
    });

    const response = await upload({
      token: editor.token,
      projectId,
      files: [{ filename: "spec.md", content: "# Spec" }],
    });
    expect(response.statusCode).toBe(201);
  });

  it("rejects a missing or malformed projectId with 400", async () => {
    const owner = await createUser("Bad Project Owner");
    const missing = await upload({
      token: owner.token,
      projectId: null,
      files: [{ filename: "spec.md", content: "# Spec" }],
    });
    expect(missing.statusCode).toBe(400);

    const malformed = await upload({
      token: owner.token,
      projectId: "not-a-uuid",
      files: [{ filename: "spec.md", content: "# Spec" }],
    });
    expect(malformed.statusCode).toBe(400);
  });

  it("rejects a non-multipart request with 400", async () => {
    const owner = await createUser("Non Multipart Owner");
    const projectId = await createProject(owner.id);
    const response = await upload({
      token: owner.token,
      projectId,
      files: [],
      multipart: false,
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("POST /api/brd/upload — clean files", () => {
  it("stores a clean file on disk and records its metadata", async () => {
    const owner = await createUser("Clean Upload Owner");
    const projectId = await createProject(owner.id);

    const response = await upload({
      token: owner.token,
      projectId,
      files: [{ filename: "requirements.md", content: "# Business Requirements\nAll good." }],
    });

    expect(response.statusCode).toBe(201);
    expect(response.body.files).toHaveLength(1);
    const [file] = response.body.files;
    expect(file?.status).toBe("clean");
    expect(file?.fileName).toBe("requirements.md");

    expect(await storedFileCount(projectId)).toBe(1);

    const rows = await pool.query<{ file_name: string; scan_status: string; byte_size: string }>(
      "SELECT file_name, scan_status, byte_size FROM brd_files WHERE project_id = $1",
      [projectId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.file_name).toBe("requirements.md");
    expect(rows.rows[0]?.scan_status).toBe("clean");
  });

  it("accepts all three permitted extensions in one multi-file request", async () => {
    const owner = await createUser("Multi File Owner");
    const projectId = await createProject(owner.id);

    const response = await upload({
      token: owner.token,
      projectId,
      files: [
        { filename: "brief.pdf", content: "%PDF-1.4 fake pdf body" },
        { filename: "spec.docx", content: "PK fake docx body" },
        { filename: "notes.md", content: "# Notes" },
      ],
    });

    expect(response.statusCode).toBe(201);
    expect(response.body.files).toHaveLength(3);
    expect(response.body.files.every((file) => file.status === "clean")).toBe(true);
    expect(await storedFileCount(projectId)).toBe(3);
  });

  it("preserves unicode filenames", async () => {
    const owner = await createUser("Unicode Owner");
    const projectId = await createProject(owner.id);

    const response = await upload({
      token: owner.token,
      projectId,
      files: [{ filename: "要件定義.md", content: "# 要件" }],
    });

    expect(response.statusCode).toBe(201);
    const rows = await pool.query<{ file_name: string }>(
      "SELECT file_name FROM brd_files WHERE project_id = $1",
      [projectId],
    );
    expect(rows.rows[0]?.file_name).toBe("要件定義.md");
  });

  it("records a sha256 checksum and the true byte size", async () => {
    const owner = await createUser("Checksum Owner");
    const projectId = await createProject(owner.id);
    const content = "# Deterministic content";

    const response = await upload({
      token: owner.token,
      projectId,
      files: [{ filename: "spec.md", content }],
    });

    const [file] = response.body.files;
    expect(file?.status).toBe("clean");
    if (file?.status !== "clean") throw new Error("expected a clean verdict");
    expect(file.byteSize).toBe(Buffer.byteLength(content, "utf8"));
    expect(file.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("POST /api/brd/upload — infected files", () => {
  it("rejects an EICAR file with 400 and the malware message, storing nothing", async () => {
    const owner = await createUser("EICAR Owner");
    const projectId = await createProject(owner.id);

    const response = await upload({
      token: owner.token,
      projectId,
      files: [{ filename: "infected.md", content: EICAR }],
    });

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe("Malware signature detected");
    const [file] = response.body.files;
    expect(file?.status).toBe("infected");
    if (file?.status !== "infected") throw new Error("expected an infected verdict");
    expect(file.signature).toBe("Win.Test.EICAR_HDB-1");

    expect(await storedFileCount(projectId)).toBe(0);
    const rows = await pool.query("SELECT id FROM brd_files WHERE project_id = $1", [projectId]);
    expect(rows.rows).toHaveLength(0);
  });

  it("stores the clean sibling but still returns 400 when one file in a batch is infected", async () => {
    const owner = await createUser("Mixed Batch Owner");
    const projectId = await createProject(owner.id);

    const response = await upload({
      token: owner.token,
      projectId,
      files: [
        { filename: "good.md", content: "# Perfectly fine" },
        { filename: "bad.md", content: EICAR },
      ],
    });

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe("Malware signature detected");
    expect(response.body.files.map((file) => file.status)).toEqual(["clean", "infected"]);

    const rows = await pool.query<{ file_name: string }>(
      "SELECT file_name FROM brd_files WHERE project_id = $1",
      [projectId],
    );
    expect(rows.rows.map((row) => row.file_name)).toEqual(["good.md"]);
  });
});

describe("POST /api/brd/upload — scanner outage", () => {
  it("returns 503 and stores nothing when ClamAV is unreachable", async () => {
    const owner = await createUser("Scanner Down Owner");
    const projectId = await createProject(owner.id);

    const workingPort = process.env.CLAMAV_PORT;
    // Port 1 is privileged and never bound, so the connection is refused.
    process.env.CLAMAV_PORT = "1";
    try {
      const response = await upload({
        token: owner.token,
        projectId,
        files: [{ filename: "spec.md", content: "# Spec" }],
      });

      expect(response.statusCode).toBe(503);
      expect(response.body.error).toMatch(/unavailable/i);
      expect(await storedFileCount(projectId)).toBe(0);
      const rows = await pool.query("SELECT id FROM brd_files WHERE project_id = $1", [projectId]);
      expect(rows.rows).toHaveLength(0);
    } finally {
      process.env.CLAMAV_PORT = workingPort;
    }
  });
});

describe("POST /api/brd/upload — input validation", () => {
  it("rejects a disallowed extension without storing it", async () => {
    const owner = await createUser("Bad Extension Owner");
    const projectId = await createProject(owner.id);

    const response = await upload({
      token: owner.token,
      projectId,
      files: [{ filename: "malware.exe", content: "MZ binary" }],
    });

    expect(response.statusCode).toBe(400);
    const [file] = response.body.files;
    expect(file?.status).toBe("rejected");
    expect(await storedFileCount(projectId)).toBe(0);
  });

  it("rejects an empty file", async () => {
    const owner = await createUser("Empty File Owner");
    const projectId = await createProject(owner.id);

    const response = await upload({
      token: owner.token,
      projectId,
      files: [{ filename: "empty.md", content: "" }],
    });

    expect(response.statusCode).toBe(400);
    const [file] = response.body.files;
    expect(file?.status).toBe("rejected");
    if (file?.status !== "rejected") throw new Error("expected a rejected verdict");
    expect(file.reason).toMatch(/empty/i);
  });

  it("rejects a request with no files at all", async () => {
    const owner = await createUser("No Files Owner");
    const projectId = await createProject(owner.id);

    const response = await upload({ token: owner.token, projectId, files: [] });
    expect(response.statusCode).toBe(400);
    expect(response.body.error).toMatch(/no files/i);
  });

  it("neutralises a path traversal filename before storing", async () => {
    const owner = await createUser("Traversal Owner");
    const projectId = await createProject(owner.id);

    const response = await upload({
      token: owner.token,
      projectId,
      files: [{ filename: "../../../etc/evil.md", content: "# nope" }],
    });

    expect(response.statusCode).toBe(201);
    const rows = await pool.query<{ file_name: string; storage_path: string }>(
      "SELECT file_name, storage_path FROM brd_files WHERE project_id = $1",
      [projectId],
    );
    expect(rows.rows[0]?.file_name).toBe("evil.md");
    expect(rows.rows[0]?.storage_path.startsWith(uploadDir)).toBe(true);
  });
});
