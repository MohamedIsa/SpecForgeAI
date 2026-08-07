import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
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

  await pipeline(part.file, createWriteStream(tempPath));

  return {
    tempPath,
    byteSize,
    checksum: hash.digest("hex"),
    // @fastify/multipart flags the part when it hit the configured size limit.
    truncated: part.file.truncated,
  };
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
    await rename(upload.tempPath, storagePath);

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

export async function registerBrdUploadRoute(fastify: FastifyInstance): Promise<void> {
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
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<UploadResponseBody> => {
      const userId = verifyBearerToken(request.headers.authorization);
      if (!userId) {
        void reply.code(401);
        return { files: [], error: "Authentication required" };
      }

      const projectId = readProjectId(request);
      if (!projectId) {
        void reply.code(400);
        return { files: [], error: "A valid projectId query parameter is required" };
      }

      const role = await getMembershipRole(projectId, userId);
      if (!role) {
        void reply.code(403);
        return { files: [], error: "You are not a member of this project" };
      }
      if (!canEditProject(role)) {
        void reply.code(403);
        return { files: [], error: "You do not have permission to upload files to this project" };
      }

      if (!request.isMultipart()) {
        void reply.code(400);
        return { files: [], error: "Request must be multipart/form-data" };
      }

      const results: UploadedFileResult[] = [];

      try {
        for await (const part of request.files()) {
          results.push(await processFilePart(part, projectId, userId));
        }
      } catch (error) {
        if (error instanceof ClamAvUnavailableError || error instanceof ClamAvProtocolError) {
          void reply.code(503);
          return { files: results, error: "Virus scanning is unavailable, please retry" };
        }
        throw error;
      }

      if (results.length === 0) {
        void reply.code(400);
        return { files: [], error: "No files were provided" };
      }

      const hasInfected = results.some((result) => result.status === "infected");
      const hasRejected = results.some((result) => result.status === "rejected");

      if (hasInfected) {
        void reply.code(400);
        return { files: results, error: MALWARE_REJECTION_MESSAGE };
      }
      if (hasRejected) {
        void reply.code(400);
        const rejected = results.find((result) => result.status === "rejected");
        return {
          files: results,
          error: rejected && rejected.status === "rejected" ? rejected.reason : "Upload rejected",
        };
      }

      void reply.code(201);
      return { files: results };
    },
  );
}

export const BRD_UPLOAD_LIMITS = {
  fileSize: MAX_BRD_FILE_BYTES,
} as const;
