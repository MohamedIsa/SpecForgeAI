/**
 * BRD upload rules shared by the Fastify upload route and the web client.
 *
 * This module must stay free of Node built-ins so it can be imported directly
 * into the browser bundle — that is what keeps the accepted extensions and the
 * size limit from drifting between client-side and server-side validation.
 */

export const MAX_BRD_FILE_BYTES = 25 * 1024 * 1024;

export const ALLOWED_BRD_EXTENSIONS = ["pdf", "docx", "md"] as const;
export type BrdExtension = (typeof ALLOWED_BRD_EXTENSIONS)[number];

/** The `accept` attribute value for a file input restricted to BRD documents. */
export const BRD_ACCEPT_ATTRIBUTE = ALLOWED_BRD_EXTENSIONS.map((ext) => `.${ext}`).join(",");

export function isBrdExtension(value: string): value is BrdExtension {
  return ALLOWED_BRD_EXTENSIONS.some((allowed) => allowed === value);
}

/**
 * Returns the accepted extension for a filename, or null when the file type is
 * not allowed. Comparison is case-insensitive (`REQUIREMENTS.PDF` is fine).
 */
export function extractExtension(fileName: string): BrdExtension | null {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot === -1 || lastDot === fileName.length - 1) return null;
  const extension = fileName.slice(lastDot + 1).toLowerCase();
  return isBrdExtension(extension) ? extension : null;
}
