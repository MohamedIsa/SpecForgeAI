import { randomUUID, createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, copyFile, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import { pool } from "../db/pool";
import { verifyBearerToken } from "../lib/jwt";
import { getMembershipRole, canEditProject } from "../lib/project-access";
import {
  scanStream,
  ClamAvUnavailableError,
  ClamAvProtocolError,
  type ScanVerdict,
} from "../lib/clamav";
import {
  MAX_BRD_FILE_BYTES,
  ALLOWED_BRD_EXTENSIONS,
  extractExtension,
  sanitizeFileName,
  resolveUploadDir,
  buildStoragePath,
  type BrdExtension,
} from "../lib/brd-storage";

export const MALWARE_REJECTION_MESSAGE = "Malware signature detected";
export const MALFORMED_UPLOAD_MESSAGE = "The upload was malformed or stalled before it could be read";

/** Guards against a malformed or stalled multipart body (e.g. a part missing
 *  its terminating boundary) that would otherwise leave `request.files()`
 *  awaiting bytes that will never arrive, hanging the request forever. */
class MultipartStallError extends Error {
  constructor() {
    super(MALFORMED_UPLOAD_MESSAGE);
    this.name = "MultipartStallError";
  }
}

const DEFAULT_MULTIPART_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new MultipartStallError()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UploadedFileResult =
  | {
      status: "clean";
      fileName: string;
      id: string;
      extension: BrdExtension;
      byteSize: number;
      checksum: string;
    }
  | { status: "infected"; fileName: string; signature: string }
  | { status: "rejected"; fileName: string; reason: string };

export interface UploadResponseBody {
  files: UploadedFileResult[];
  error?: string;
}

interface ScannedUpload {
  tempPath: string;
  byteSize: number;
  checksum: string;
  truncated: boolean;
}

/**
 * Drains a multipart file part to a temporary file outside the storage
 * directory, computing its checksum and size on the way through.
 *
 * The bytes deliberately never reach permanent storage before ClamAV has
 * returned a verdict — the temp file is scanned and then either promoted into
 * the project's upload directory or unlinked.
 */
async function bufferToTempFile(part: MultipartFile): Promise<ScannedUpload> {
  const tempPath = path.join(os.tmpdir(), `specforge-brd-${randomUUID()}`);
  const hash = createHash("sha256");
  let byteSize = 0;

  part.file.on("data", (chunk: Buffer) => {
    byteSize += chunk.byteLength;
    hash.update(chunk);
  });

  try {
    await pipeline(part.file, createWriteStream(tempPath));
  } catch (error) {
    // processFilePart's cleanup only covers tempPath once this function has
    // successfully returned it — a rejection here (a stalled/aborted part,
    // via `withTimeout` abandoning this call) would otherwise leave the
    // partially-written file behind forever.
    await safeUnlink(tempPath);
    throw error;
  }

  return {
    tempPath,
    byteSize,
    checksum: hash.digest("hex"),
    // @fastify/multipart flags the part when it hit the configured size limit.
    truncated: part.file.truncated,
  };
}

/**
 * Promotes the temp file into permanent storage. `rename()` is preferred
 * (atomic, no window where the file half-exists) but fails with EXDEV when
 * the temp directory (os.tmpdir(), often tmpfs) and the upload directory are
 * on different filesystems/mounts — a real-world deployment shape rename()
 * simply cannot handle. That specific failure falls back to copy + unlink;
 * any other error is a genuine fault and is left to propagate.
 */
async function moveFile(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") throw error;
    try {
      await copyFile(source, destination);
    } catch (copyError) {
      // A partial copy (e.g. ENOSPC on the destination mount) must not leave
      // a half-written blob behind — same invariant the DB-insert failure
      // path below already enforces for storagePath.
      await safeUnlink(destination);
      throw copyError;
    }
    await unlink(source);
  }
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    // The temp file may already be gone (e.g. promoted via rename); anything
    // else is surfaced so a full disk or permission fault is never silent.
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
}

async function processFilePart(
  part: MultipartFile,
  projectId: string,
  userId: string,
): Promise<UploadedFileResult> {
  const fileName = sanitizeFileName(part.filename);
  const extension = extractExtension(fileName);

  if (!extension) {
    // The part still has to be drained or the request stalls.
    part.file.resume();
    return {
      status: "rejected",
      fileName,
      reason: `Only ${ALLOWED_BRD_EXTENSIONS.join(", ")} files are accepted`,
    };
  }

  const upload = await bufferToTempFile(part);

  try {
    if (upload.truncated) {
      return {
        status: "rejected",
        fileName,
        reason: `File exceeds the ${MAX_BRD_FILE_BYTES / (1024 * 1024)}MB limit`,
      };
    }

    if (upload.byteSize === 0) {
      return { status: "rejected", fileName, reason: "File is empty" };
    }

    const verdict: ScanVerdict = await scanStream(createReadStream(upload.tempPath));

    if (verdict.status === "infected") {
      return { status: "infected", fileName, signature: verdict.signature };
    }

    const fileId = randomUUID();
    const uploadDir = resolveUploadDir();
    const storagePath = buildStoragePath(uploadDir, projectId, fileId, extension);

    await mkdir(path.dirname(storagePath), { recursive: true });
    await moveFile(upload.tempPath, storagePath);

    try {
      await pool.query(
        `INSERT INTO brd_files
           (id, project_id, file_name, extension, byte_size, checksum,
            storage_path, scan_status, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'clean', $8)`,
        [
          fileId,
          projectId,
          fileName,
          extension,
          upload.byteSize,
          upload.checksum,
          storagePath,
          userId,
        ],
      );
    } catch (error) {
      // Never leave an orphaned blob on disk if the metadata insert fails.
      await safeUnlink(storagePath);
      throw error;
    }

    return {
      status: "clean",
      fileName,
      id: fileId,
      extension,
      byteSize: upload.byteSize,
      checksum: upload.checksum,
    };
  } finally {
    await safeUnlink(upload.tempPath);
  }
}

function readProjectId(request: FastifyRequest): string | null {
  const query: unknown = request.query;
  if (typeof query !== "object" || query === null) return null;
  const value = (query as Record<string, unknown>).projectId;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  return value;
}

interface UploadRejection {
  code: number;
  error: string;
}

type UploadAuthorization =
  | { ok: true; userId: string; projectId: string }
  | { ok: false; rejection: UploadRejection };

/** Runs every guard before a single byte of the multipart body is read:
 *  authentication, a valid projectId, membership, and edit permission. */
async function authorizeUpload(request: FastifyRequest): Promise<UploadAuthorization> {
  const userId = verifyBearerToken(request.headers.authorization);
  if (!userId) {
    return { ok: false, rejection: { code: 401, error: "Authentication required" } };
  }

  const projectId = readProjectId(request);
  if (!projectId) {
    return {
      ok: false,
      rejection: { code: 400, error: "A valid projectId query parameter is required" },
    };
  }

  const role = await getMembershipRole(projectId, userId);
  if (!role) {
    return { ok: false, rejection: { code: 403, error: "You are not a member of this project" } };
  }
  if (!canEditProject(role)) {
    return {
      ok: false,
      rejection: { code: 403, error: "You do not have permission to upload files to this project" },
    };
  }

  return { ok: true, userId, projectId };
}

/** Maps an error thrown while draining/scanning the multipart body onto a
 *  response. Rethrows anything it doesn't recognize so the caller's
 *  try/catch still surfaces unexpected failures as a 500. */
function classifyUploadError(
  error: unknown,
  results: UploadedFileResult[],
): { code: number; body: UploadResponseBody } {
  if (error instanceof ClamAvUnavailableError || error instanceof ClamAvProtocolError) {
    return {
      code: 503,
      body: { files: results, error: "Virus scanning is unavailable, please retry" },
    };
  }
  if (error instanceof MultipartStallError) {
    return { code: 400, body: { files: results, error: MALFORMED_UPLOAD_MESSAGE } };
  }
  throw error;
}

/** Classifies the finished batch of per-file scan results into the overall
 *  HTTP response, once every part has been drained. */
function buildUploadResponse(results: UploadedFileResult[]): {
  code: number;
  body: UploadResponseBody;
} {
  if (results.length === 0) {
    return { code: 400, body: { files: [], error: "No files were provided" } };
  }

  const infected = results.find((result) => result.status === "infected");
  if (infected) {
    return { code: 400, body: { files: results, error: MALWARE_REJECTION_MESSAGE } };
  }

  const rejected = results.find((result) => result.status === "rejected");
  if (rejected) {
    return {
      code: 400,
      body: {
        files: results,
        error: rejected.status === "rejected" ? rejected.reason : "Upload rejected",
      },
    };
  }

  return { code: 201, body: { files: results } };
}

export interface RegisterBrdUploadRouteOptions {
  /** Injectable purely so tests can exercise the stall path without a real 30s wait. */
  multipartTimeoutMs?: number;
}

export async function registerBrdUploadRoute(
  fastify: FastifyInstance,
  options: RegisterBrdUploadRouteOptions = {},
): Promise<void> {
  const multipartTimeoutMs = options.multipartTimeoutMs ?? DEFAULT_MULTIPART_TIMEOUT_MS;

  fastify.post(
    "/api/brd/upload",
    {
      // Documentation only (DEV-TEMP-T1) — deliberately no body/querystring
      // keys here, so Fastify's schema validation is not applied to this
      // route; the manual multipart handling and projectId check below are
      // unchanged.
      schema: {
        description: "Uploads one or more BRD files, scanning each with ClamAV before storing it.",
        summary: "Upload BRD files",
        tags: ["brd"],
        consumes: ["multipart/form-data"],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<UploadResponseBody> => {
      const auth = await authorizeUpload(request);
      if (!auth.ok) {
        void reply.code(auth.rejection.code);
        return { files: [], error: auth.rejection.error };
      }
      const { userId, projectId } = auth;

      if (!request.isMultipart()) {
        void reply.code(400);
        return { files: [], error: "Request must be multipart/form-data" };
      }

      const results: UploadedFileResult[] = [];

      try {
        await withTimeout(
          (async () => {
            for await (const part of request.files()) {
              results.push(await processFilePart(part, projectId, userId));
            }
          })(),
          multipartTimeoutMs,
        );
      } catch (error) {
        if (error instanceof MultipartStallError) {
          // The parser is stuck waiting on bytes that will never arrive, so
          // the connection is unusable and must eventually be torn down —
          // but destroying it now, before the reply below has been written,
          // takes the response with it and the client gets a bare connection
          // reset instead of this 400. Deferring the destroy until Fastify
          // has actually finished flushing the reply is what lets both
          // happen: the client reads the error, then the stuck connection
          // is freed.
          reply.raw.once("finish", () => request.raw.destroy());
        }
        const { code, body } = classifyUploadError(error, results);
        void reply.code(code);
        return body;
      }

      const { code, body } = buildUploadResponse(results);
      void reply.code(code);
      return body;
    },
  );
}

export const BRD_UPLOAD_LIMITS = {
  fileSize: MAX_BRD_FILE_BYTES,
} as const;
