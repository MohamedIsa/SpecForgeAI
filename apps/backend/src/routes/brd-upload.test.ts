import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, readdir, readFile, rename } from "node:fs/promises";

// `rename` is wrapped so the two EXDEV-fallback tests below can override its
// behaviour for a single call; every other test uses the real implementation
// untouched, since `mockImplementationOnce` is the only thing that changes it.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
import { createTestCaller } from "../test-utils";
import { pool } from "../db/pool";
import { signAccessToken } from "../lib/jwt";
import {
  registerBrdUploadRoute,
  BRD_UPLOAD_LIMITS,
  MALFORMED_UPLOAD_MESSAGE,
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
  // Short timeout so the stalled-multipart-body tests below run fast; every
  // other test in this file sends a complete body and finishes well under it.
  await registerBrdUploadRoute(app, { multipartTimeoutMs: 300 });
  await app.ready();

  // Also bind a real socket: app.inject() uses light-my-request's in-memory
  // mock, which does not model request.raw.destroy() the way a real
  // connection does. The stalled-body-over-a-real-socket test below needs an
  // actual listener to prove the client really reads the 400, not just that
  // the handler function returns one.
  await app.listen({ port: 0, host: "127.0.0.1" });
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

/**
 * Reproduces the exact structure that triggered the reported 500: a file
 * part whose content is missing the CRLF that must precede the closing
 * boundary. @fastify/multipart's parser stalls waiting for bytes that will
 * never arrive, so without a timeout guard the request hangs forever
 * (surfacing as a 500/504 behind any reverse proxy) instead of failing.
 */
function buildStalledMultipartBody(): Buffer {
  return Buffer.from(
    `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="files"; filename="Business Requirements Document.pdf"\r\n` +
      `Content-Type: application/pdf\r\n\r\n` +
      `--${BOUNDARY}--\r\n`,
    "utf8",
  );
}

/**
 * Sends a raw HTTP request over a real TCP socket and returns whatever bytes
 * come back before the connection closes. app.inject() cannot stand in here:
 * it never opens a real socket, so it cannot observe (or fail on) the client
 * seeing a bare connection reset instead of a response, or accurately model
 * a client that never finishes sending its declared body.
 */
function sendRawRequest(port: number, requestHead: string, body: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let received = "";
    socket.on("connect", () => {
      socket.write(requestHead);
      socket.write(body);
    });
    socket.on("data", (chunk: Buffer) => {
      received += chunk.toString("utf8");
    });
    socket.on("error", reject);
    socket.on("close", () => resolve(received));
  });
}

describe("POST /api/brd/upload — malformed multipart body (BUG-500-UPLOAD)", () => {

  it("sends a real HTTP 400 response over the socket instead of resetting the connection", async () => {
    const owner = await createUser("Stalled Body Real Socket Owner");
    const projectId = await createProject(owner.id);
    const body = buildStalledMultipartBody();

    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected the app to be listening on a TCP port");
    }

    const requestHead =
      `POST /api/brd/upload?projectId=${projectId} HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${address.port}\r\n` +
      `Authorization: Bearer ${owner.token}\r\n` +
      `Content-Type: multipart/form-data; boundary=${BOUNDARY}\r\n` +
      `Content-Length: ${body.byteLength}\r\n` +
      `Connection: close\r\n` +
      `\r\n`;

    const raw = await sendRawRequest(address.port, requestHead, body);

    // A reset connection yields no bytes at all — assert an actual status
    // line and body were read, not just that the socket eventually closed.
    expect(raw.startsWith("HTTP/1.1 400")).toBe(true);
    expect(raw).toContain(JSON.stringify(MALFORMED_UPLOAD_MESSAGE));
  });

  it("sends the same real HTTP 400 when the client stalls mid-body rather than sending a malformed-but-complete one", async () => {
    // A stricter reproduction than the one above: the client declares a
    // Content-Length it never satisfies and never closes its write side —
    // the request is genuinely incomplete at the HTTP layer, not just an
    // oddly-shaped multipart body. This is what actually distinguishes a
    // reply sent before request.raw is destroyed from one sent after: with
    // the body fully delivered (as above) the two orderings are hard to
    // tell apart in practice, but a truly stalled client exposes it reliably.
    const owner = await createUser("Stalled Mid-Body Real Socket Owner");
    const projectId = await createProject(owner.id);

    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected the app to be listening on a TCP port");
    }

    const partialBody = Buffer.from(
      `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="files"; filename="incomplete.pdf"\r\n` +
        `Content-Type: application/pdf\r\n\r\n`,
      "utf8",
    );
    // Claim far more bytes than will ever actually be sent.
    const claimedLength = partialBody.byteLength + 10_000;

    const requestHead =
      `POST /api/brd/upload?projectId=${projectId} HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${address.port}\r\n` +
      `Authorization: Bearer ${owner.token}\r\n` +
      `Content-Type: multipart/form-data; boundary=${BOUNDARY}\r\n` +
      `Content-Length: ${claimedLength}\r\n` +
      `\r\n`;

    const raw = await sendRawRequest(address.port, requestHead, partialBody);

    expect(raw.startsWith("HTTP/1.1 400")).toBe(true);
    expect(raw).toContain(JSON.stringify(MALFORMED_UPLOAD_MESSAGE));
  });

  it("stores nothing when the body stalls", async () => {
    const owner = await createUser("Stalled Body No Store Owner");
    const projectId = await createProject(owner.id);

    await app.inject({
      method: "POST",
      url: `/api/brd/upload?projectId=${projectId}`,
      headers: {
        "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
        authorization: `Bearer ${owner.token}`,
      },
      payload: buildStalledMultipartBody(),
    });

    expect(await storedFileCount(projectId)).toBe(0);
  });
});

describe("POST /api/brd/upload — temp file cleanup on failure (BUG-500-UPLOAD)", () => {
  /** Counts specforge-brd-* temp files currently in os.tmpdir(). */
  async function countTempUploadFiles(): Promise<number> {
    const entries = await readdir(os.tmpdir());
    return entries.filter((name) => name.startsWith("specforge-brd-")).length;
  }

  /** Waits for a predicate to hold, polling briefly — cleanup runs
   *  asynchronously after the response is sent, not synchronously with it. */
  async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("condition was never met within the wait window");
  }

  it("leaves no temp file behind when the body stalls", async () => {
    // A real socket, not app.inject(): the mock socket app.inject() uses
    // finalizes the request stream in a way that does not reproduce an
    // actually-stuck client, so it cannot be trusted to catch a leak here
    // (verified: this exact scenario passed under inject() even without the
    // bufferToTempFile cleanup fix in place).
    //
    // The part must include real file bytes, not just headers: fs.createWriteStream
    // only actually creates the file on its first write, so a stall before any
    // content arrives has nothing to leak regardless of the fix (verified this
    // too — a header-only stall passes even on unfixed code, which is why it
    // is not a usable regression guard on its own). Sending some bytes and then
    // going silent — without the client closing its own socket, unlike the
    // "aborts mid-upload" case below — is what actually exercises the
    // server-side multipartTimeoutMs path against a real open temp file.
    const owner = await createUser("Stall Temp Cleanup Owner");
    const projectId = await createProject(owner.id);
    const before = await countTempUploadFiles();

    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected the app to be listening on a TCP port");
    }

    const partial = Buffer.from(
      `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="files"; filename="stall.pdf"\r\n` +
        `Content-Type: application/pdf\r\n\r\n` +
        "%PDF-1.4 some real bytes that are never followed by a closing boundary",
      "utf8",
    );
    const claimedLength = partial.byteLength + 10_000;
    const requestHead =
      `POST /api/brd/upload?projectId=${projectId} HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${address.port}\r\n` +
      `Authorization: Bearer ${owner.token}\r\n` +
      `Content-Type: multipart/form-data; boundary=${BOUNDARY}\r\n` +
      `Content-Length: ${claimedLength}\r\n` +
      `\r\n`;

    await sendRawRequest(address.port, requestHead, partial);

    await waitFor(async () => (await countTempUploadFiles()) === before);
    expect(await countTempUploadFiles()).toBe(before);
  });

  it("leaves no temp file behind when the client aborts mid-upload", async () => {
    const owner = await createUser("Abort Temp Cleanup Owner");
    const projectId = await createProject(owner.id);
    const before = await countTempUploadFiles();

    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected the app to be listening on a TCP port");
    }

    const partial = Buffer.from(
      `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="files"; filename="abort.pdf"\r\n` +
        `Content-Type: application/pdf\r\n\r\n` +
        "some bytes, but nowhere near the declared Content-Length",
      "utf8",
    );
    const claimedLength = partial.byteLength + 50_000;
    const requestHead =
      `POST /api/brd/upload?projectId=${projectId} HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${address.port}\r\n` +
      `Authorization: Bearer ${owner.token}\r\n` +
      `Content-Type: multipart/form-data; boundary=${BOUNDARY}\r\n` +
      `Content-Length: ${claimedLength}\r\n` +
      `\r\n`;

    await new Promise<void>((resolve, reject) => {
      const socket = net.connect({ host: "127.0.0.1", port: address.port });
      socket.on("connect", () => {
        socket.write(requestHead);
        socket.write(partial);
        // A real client disconnecting mid-upload (closed laptop, dropped
        // network) — not waiting for the server's stall timeout at all.
        setTimeout(() => socket.destroy(), 150);
      });
      socket.on("close", () => resolve());
      socket.on("error", reject);
    });

    await waitFor(async () => (await countTempUploadFiles()) === before);
    expect(await countTempUploadFiles()).toBe(before);
  });
});

describe("POST /api/brd/upload — BUG-500-UPLOAD regression sweep", () => {
  it("never returns a 500 across auth, validation, scanner-outage and malformed-body failure modes", async () => {
    const owner = await createUser("Sweep Owner");
    const viewer = await createUser("Sweep Viewer");
    const projectId = await createProject(owner.id);
    await createTestCaller(owner.id).caller.project.inviteMember({
      projectId,
      email: viewer.email,
      role: "viewer",
    });

    const outcomes: Array<{ label: string; statusCode: number }> = [];

    outcomes.push({
      label: "unauthenticated",
      statusCode: (await upload({ token: null, projectId, files: [{ filename: "a.md", content: "x" }] }))
        .statusCode,
    });
    outcomes.push({
      label: "viewer forbidden",
      statusCode: (
        await upload({ token: viewer.token, projectId, files: [{ filename: "a.md", content: "x" }] })
      ).statusCode,
    });
    outcomes.push({
      label: "missing projectId",
      statusCode: (
        await upload({ token: owner.token, projectId: null, files: [{ filename: "a.md", content: "x" }] })
      ).statusCode,
    });
    outcomes.push({
      label: "non-multipart",
      statusCode: (await upload({ token: owner.token, projectId, files: [], multipart: false })).statusCode,
    });
    outcomes.push({
      label: "empty file",
      statusCode: (await upload({ token: owner.token, projectId, files: [{ filename: "a.md", content: "" }] }))
        .statusCode,
    });
    outcomes.push({
      label: "disallowed extension",
      statusCode: (
        await upload({ token: owner.token, projectId, files: [{ filename: "a.exe", content: "x" }] })
      ).statusCode,
    });
    outcomes.push({
      label: "clean file",
      statusCode: (
        await upload({ token: owner.token, projectId, files: [{ filename: `${randomTag()}.md`, content: "# Spec" }] })
      ).statusCode,
    });
    outcomes.push({
      label: "infected file",
      statusCode: (
        await upload({ token: owner.token, projectId, files: [{ filename: "eicar.md", content: EICAR }] })
      ).statusCode,
    });

    const workingPort = process.env.CLAMAV_PORT;
    process.env.CLAMAV_PORT = "1";
    outcomes.push({
      label: "scanner outage",
      statusCode: (
        await upload({ token: owner.token, projectId, files: [{ filename: `${randomTag()}.md`, content: "# Spec" }] })
      ).statusCode,
    });
    process.env.CLAMAV_PORT = workingPort;

    const stalled = await app.inject({
      method: "POST",
      url: `/api/brd/upload?projectId=${projectId}`,
      headers: {
        "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
        authorization: `Bearer ${owner.token}`,
      },
      payload: Buffer.from(
        `--${BOUNDARY}\r\n` +
          `Content-Disposition: form-data; name="files"; filename="stalled.pdf"\r\n` +
          `Content-Type: application/pdf\r\n\r\n` +
          `--${BOUNDARY}--\r\n`,
        "utf8",
      ),
    });
    outcomes.push({ label: "malformed/stalled body", statusCode: stalled.statusCode });

    // 503 (scanner outage) is the correct, intentional response for that case —
    // only a bare 500 Internal Server Error is the bug this sweep guards against.
    const fiveHundreds = outcomes.filter((outcome) => outcome.statusCode === 500);
    expect(fiveHundreds).toEqual([]);
    expect(outcomes.find((outcome) => outcome.label === "scanner outage")?.statusCode).toBe(503);
  });
});

function randomTag(): string {
  return Math.random().toString(36).slice(2, 10);
}

describe("POST /api/brd/upload — cross-device promotion (BUG-500-UPLOAD)", () => {
  /**
   * Reproduces the production 500: os.tmpdir() and the configured upload
   * directory can live on different filesystems/mounts (e.g. a tmpfs /tmp),
   * where fs.rename() fails with EXDEV instead of moving the file. Forcing
   * that exact error here — rather than trying to contrive two real mounts
   * in CI — is what actually exercises the copy+unlink fallback.
   */
  it("falls back to copy+unlink and still stores the file when rename() reports EXDEV", async () => {
    const owner = await createUser("EXDEV Owner");
    const projectId = await createProject(owner.id);

    vi.mocked(rename).mockImplementationOnce(async () => {
      throw Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" });
    });

    const response = await upload({
      token: owner.token,
      projectId,
      files: [{ filename: "spec.md", content: "# Cross-device spec" }],
    });

    expect(response.statusCode).toBe(201);
    expect(response.body.files[0]?.status).toBe("clean");

    const rows = await pool.query<{ storage_path: string }>(
      "SELECT storage_path FROM brd_files WHERE project_id = $1",
      [projectId],
    );
    const storagePath = rows.rows[0]?.storage_path;
    expect(storagePath).toBeDefined();
    const stored = await readFile(storagePath as string, "utf8");
    expect(stored).toBe("# Cross-device spec");
  });

  it("still surfaces a genuine rename failure that is not EXDEV", async () => {
    const owner = await createUser("Non-EXDEV Rename Owner");
    const projectId = await createProject(owner.id);

    vi.mocked(rename).mockImplementationOnce(async () => {
      throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    });

    const response = await upload({
      token: owner.token,
      projectId,
      files: [{ filename: "spec.md", content: "# Spec" }],
    });

    // Not EXDEV, so the copy+unlink fallback must not mask it — it's a
    // genuine fault, and the existing generic error handling applies.
    expect(response.statusCode).toBe(500);
    expect(await storedFileCount(projectId)).toBe(0);
  });
});
