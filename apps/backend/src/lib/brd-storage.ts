import path from "node:path";
import type { BrdExtension } from "./brd-constants";

export {
  MAX_BRD_FILE_BYTES,
  ALLOWED_BRD_EXTENSIONS,
  extractExtension,
  isBrdExtension,
  type BrdExtension,
} from "./brd-constants";

const MAX_FILE_NAME_LENGTH = 255;
// C0 controls + DEL + C1 controls, written as escapes so the source stays readable.
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Normalises a client-supplied filename for *display and storage in the DB*.
 * The on-disk name is always a server-generated UUID, so this is defence in
 * depth rather than the only guard against path traversal.
 *
 * Unicode is preserved (e.g. `要件定義.pdf`); only path separators, control
 * characters and NUL bytes are stripped.
 */
export function sanitizeFileName(fileName: string): string {
  const withoutControlChars = fileName.replace(CONTROL_CHARACTERS, "");
  const withoutDirectories = path.basename(withoutControlChars.replaceAll("\\", "/"));
  const trimmed = withoutDirectories.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") return "unnamed";
  return trimmed.slice(0, MAX_FILE_NAME_LENGTH);
}

export function resolveUploadDir(): string {
  const configured = process.env.BRD_UPLOAD_DIR ?? "./uploads";
  return path.resolve(configured);
}

/**
 * Builds the absolute on-disk location for a stored file. `fileId` is a
 * server-generated UUID, so the resulting path can never escape the project
 * directory regardless of what the client called the file.
 */
export function buildStoragePath(
  uploadDir: string,
  projectId: string,
  fileId: string,
  extension: BrdExtension,
): string {
  return path.join(uploadDir, projectId, `${fileId}.${extension}`);
}
