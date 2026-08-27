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

/**
 * Magic bytes for the extensions that have a reliable binary signature.
 * .md has none — it's plain text, so any byte sequence is "valid" — and is
 * intentionally absent here; matchesFileSignature() trusts .md uploads based
 * on extension alone. Kept in this Node-only module (not brd-constants.ts)
 * because Buffer isn't available in the browser bundle brd-constants.ts is
 * shared into.
 */
const MAGIC_BYTES: Partial<Record<BrdExtension, Buffer>> = {
  pdf: Buffer.from("%PDF-", "ascii"),
  docx: Buffer.from([0x50, 0x4b, 0x03, 0x04]), // "PK\x03\x04" — the ZIP local-file-header
  // signature; a .docx is a ZIP archive under the hood, so this is the same
  // check that would catch any other ZIP-based format masquerading as one.
};

/** Longest magic byte sequence checked — callers only need to buffer this
 *  many leading bytes of the upload before a signature check is possible. */
export const MAGIC_BYTES_HEADER_LENGTH = Math.max(
  ...Object.values(MAGIC_BYTES).map((sig) => sig.length),
);

/**
 * Verifies a file's actual leading bytes match what its claimed extension
 * says it should be — defense against a renamed/disguised file (e.g. an
 * executable saved as `payload.pdf`) slipping past extension-only
 * validation. `header` may be shorter than the expected signature (e.g. a
 * truncated/empty upload); that never matches, it's never a false accept.
 */
export function matchesFileSignature(extension: BrdExtension, header: Buffer): boolean {
  const expected = MAGIC_BYTES[extension];
  if (!expected) return true;
  return header.length >= expected.length && header.subarray(0, expected.length).equals(expected);
}
