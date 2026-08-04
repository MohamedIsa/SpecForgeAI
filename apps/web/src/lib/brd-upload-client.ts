import { MAX_BRD_FILE_BYTES, extractExtension } from "@specforge/backend/brd-constants";

export const MALWARE_WARNING_MESSAGE = "Malware signature detected — file was not stored";

export type UploadOutcome =
  | { status: "clean"; id: string }
  | { status: "infected"; signature: string; message: string }
  | { status: "rejected"; message: string }
  | { status: "error"; message: string };

interface ServerFileResult {
  status?: unknown;
  fileName?: unknown;
  id?: unknown;
  signature?: unknown;
  reason?: unknown;
}

interface ServerResponseBody {
  files?: unknown;
  error?: unknown;
}

function firstFileResult(body: ServerResponseBody): ServerFileResult | null {
  if (!Array.isArray(body.files)) return null;
  const first: unknown = body.files[0];
  if (typeof first !== "object" || first === null) return null;
  return first as ServerFileResult;
}

/**
 * Maps an upload HTTP response onto a UI outcome. Kept pure and separate from
 * the XHR plumbing so every branch is directly unit-testable.
 */
export function interpretUploadResponse(statusCode: number, rawBody: string): UploadOutcome {
  let body: ServerResponseBody = {};
  if (rawBody) {
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (typeof parsed === "object" && parsed !== null) {
        body = parsed as ServerResponseBody;
      }
    } catch {
      return { status: "error", message: "The server returned an unreadable response" };
    }
  }

  const file = firstFileResult(body);
  const serverError = typeof body.error === "string" ? body.error : null;

  if (file?.status === "infected") {
    return {
      status: "infected",
      signature: typeof file.signature === "string" ? file.signature : "unknown",
      message: MALWARE_WARNING_MESSAGE,
    };
  }

  if (statusCode >= 200 && statusCode < 300) {
    if (file?.status === "clean" && typeof file.id === "string") {
      return { status: "clean", id: file.id };
    }
    return { status: "error", message: "The server did not confirm the upload" };
  }

  if (file?.status === "rejected" && typeof file.reason === "string") {
    return { status: "rejected", message: file.reason };
  }

  if (statusCode === 401) {
    return { status: "error", message: serverError ?? "Your session expired, please sign in again" };
  }
  if (statusCode === 403) {
    return { status: "rejected", message: serverError ?? "You cannot upload to this project" };
  }
  if (statusCode === 503) {
    return { status: "error", message: serverError ?? "Virus scanning is unavailable, please retry" };
  }

  return { status: "error", message: serverError ?? "Upload failed" };
}

/**
 * Client-side pre-flight so obviously invalid files never leave the browser.
 * The server re-validates independently — this is purely for fast feedback.
 */
export function validateFileBeforeUpload(file: File): { ok: true } | { ok: false; reason: string } {
  if (extractExtension(file.name) === null) {
    return { ok: false, reason: "Only .pdf, .docx and .md files are accepted" };
  }
  if (file.size === 0) {
    return { ok: false, reason: "File is empty" };
  }
  if (file.size > MAX_BRD_FILE_BYTES) {
    return { ok: false, reason: `File exceeds the ${MAX_BRD_FILE_BYTES / (1024 * 1024)}MB limit` };
  }
  return { ok: true };
}

export interface UploadRequest {
  file: File;
  projectId: string;
  token: string | null;
  onProgress: (percent: number) => void;
  /** Injectable for tests; defaults to a real XMLHttpRequest. */
  createXhr?: () => XMLHttpRequest;
}

/**
 * Uploads a single file, reporting genuine byte-level progress via
 * `XMLHttpRequest.upload.onprogress` (fetch cannot report upload progress).
 * One request per file so each row on the page gets its own progress bar and
 * its own scan verdict.
 */
export function uploadBrdFile(request: UploadRequest): Promise<UploadOutcome> {
  return new Promise<UploadOutcome>((resolve) => {
    const xhr = request.createXhr ? request.createXhr() : new XMLHttpRequest();
    const body = new FormData();
    body.append("files", request.file, request.file.name);

    xhr.open("POST", `/api/brd/upload?projectId=${encodeURIComponent(request.projectId)}`);
    if (request.token) {
      xhr.setRequestHeader("Authorization", `Bearer ${request.token}`);
    }

    xhr.upload.onprogress = (event: ProgressEvent) => {
      if (!event.lengthComputable || event.total === 0) return;
      request.onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };

    xhr.upload.onload = () => {
      // Bytes are all on the wire; the server is now streaming them to ClamAV.
      request.onProgress(100);
    };

    xhr.onload = () => {
      resolve(interpretUploadResponse(xhr.status, xhr.responseText));
    };

    xhr.onerror = () => {
      resolve({ status: "error", message: "Network error while uploading" });
    };

    xhr.onabort = () => {
      resolve({ status: "error", message: "Upload cancelled" });
    };

    xhr.send(body);
  });
}
