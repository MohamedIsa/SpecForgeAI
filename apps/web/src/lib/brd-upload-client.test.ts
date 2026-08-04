import { describe, it, expect, vi } from "vitest";
import {
  interpretUploadResponse,
  validateFileBeforeUpload,
  uploadBrdFile,
  MALWARE_WARNING_MESSAGE,
} from "./brd-upload-client";

function makeFile(name: string, size: number): File {
  const file = new File(["x"], name, { type: "application/octet-stream" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("interpretUploadResponse", () => {
  it("maps a 201 clean result", () => {
    const body = JSON.stringify({ files: [{ status: "clean", fileName: "a.md", id: "file-1" }] });
    expect(interpretUploadResponse(201, body)).toEqual({ status: "clean", id: "file-1" });
  });

  it("maps a 400 infected result to the malware warning", () => {
    const body = JSON.stringify({
      files: [{ status: "infected", fileName: "bad.md", signature: "Win.Test.EICAR_HDB-1" }],
      error: "Malware signature detected",
    });
    expect(interpretUploadResponse(400, body)).toEqual({
      status: "infected",
      signature: "Win.Test.EICAR_HDB-1",
      message: MALWARE_WARNING_MESSAGE,
    });
  });

  it("treats an infected verdict as infected even on an unexpected status code", () => {
    const body = JSON.stringify({ files: [{ status: "infected", signature: "X" }] });
    expect(interpretUploadResponse(200, body).status).toBe("infected");
  });

  it("maps a rejected file to its server-provided reason", () => {
    const body = JSON.stringify({
      files: [{ status: "rejected", fileName: "a.exe", reason: "Only .pdf, .docx, .md accepted" }],
    });
    expect(interpretUploadResponse(400, body)).toEqual({
      status: "rejected",
      message: "Only .pdf, .docx, .md accepted",
    });
  });

  it("maps 401 to a session error", () => {
    expect(interpretUploadResponse(401, JSON.stringify({ error: "Authentication required" }))).toEqual(
      { status: "error", message: "Authentication required" },
    );
  });

  it("maps 403 to a rejection", () => {
    const result = interpretUploadResponse(403, JSON.stringify({ error: "Not a member" }));
    expect(result).toEqual({ status: "rejected", message: "Not a member" });
  });

  it("maps 503 to a scanner-unavailable error", () => {
    const result = interpretUploadResponse(
      503,
      JSON.stringify({ error: "Virus scanning is unavailable, please retry" }),
    );
    expect(result).toEqual({
      status: "error",
      message: "Virus scanning is unavailable, please retry",
    });
  });

  it("reports an error for unreadable JSON", () => {
    expect(interpretUploadResponse(200, "<html>oops</html>")).toEqual({
      status: "error",
      message: "The server returned an unreadable response",
    });
  });

  it("reports an error when a 2xx response contains no confirmed file", () => {
    expect(interpretUploadResponse(201, JSON.stringify({ files: [] }))).toEqual({
      status: "error",
      message: "The server did not confirm the upload",
    });
  });

  it("falls back to a generic message for an unexpected failure", () => {
    expect(interpretUploadResponse(500, "")).toEqual({ status: "error", message: "Upload failed" });
  });
});

describe("validateFileBeforeUpload", () => {
  it("accepts allowed extensions", () => {
    expect(validateFileBeforeUpload(makeFile("spec.pdf", 1024)).ok).toBe(true);
    expect(validateFileBeforeUpload(makeFile("spec.docx", 1024)).ok).toBe(true);
    expect(validateFileBeforeUpload(makeFile("spec.md", 1024)).ok).toBe(true);
  });

  it("rejects a disallowed extension", () => {
    const result = validateFileBeforeUpload(makeFile("malware.exe", 1024));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.reason).toMatch(/\.pdf/);
  });

  it("rejects an empty file", () => {
    const result = validateFileBeforeUpload(makeFile("empty.md", 0));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.reason).toMatch(/empty/i);
  });

  it("rejects a file over the 25MB limit", () => {
    const result = validateFileBeforeUpload(makeFile("huge.pdf", 26 * 1024 * 1024));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.reason).toMatch(/25MB/);
  });

  it("accepts a file exactly at the limit", () => {
    expect(validateFileBeforeUpload(makeFile("exact.pdf", 25 * 1024 * 1024)).ok).toBe(true);
  });
});

/** Minimal XHR stand-in: jsdom does not emit real upload progress events. */
class FakeXhr {
  public status = 0;
  public responseText = "";
  public upload = {
    onprogress: null as ((event: ProgressEvent) => void) | null,
    onload: null as (() => void) | null,
  };
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public onabort: (() => void) | null = null;
  public sentBody: FormData | null = null;
  public openedUrl = "";
  public headers: Record<string, string> = {};

  open(_method: string, url: string): void {
    this.openedUrl = url;
  }

  setRequestHeader(key: string, value: string): void {
    this.headers[key] = value;
  }

  send(body: FormData): void {
    this.sentBody = body;
  }

  emitProgress(loaded: number, total: number): void {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }

  respond(status: number, responseText: string): void {
    this.status = status;
    this.responseText = responseText;
    this.upload.onload?.();
    this.onload?.();
  }
}

function asXhr(fake: FakeXhr): XMLHttpRequest {
  return fake as unknown as XMLHttpRequest;
}

describe("uploadBrdFile", () => {
  it("reports real byte progress and resolves clean", async () => {
    const fake = new FakeXhr();
    const progress: number[] = [];

    const pending = uploadBrdFile({
      file: makeFile("spec.md", 1000),
      projectId: "11111111-1111-1111-1111-111111111111",
      token: "test-token",
      onProgress: (percent) => progress.push(percent),
      createXhr: () => asXhr(fake),
    });

    fake.emitProgress(250, 1000);
    fake.emitProgress(1000, 1000);
    fake.respond(201, JSON.stringify({ files: [{ status: "clean", id: "file-1" }] }));

    await expect(pending).resolves.toEqual({ status: "clean", id: "file-1" });
    expect(progress).toContain(25);
    expect(progress).toContain(100);
  });

  it("sends the bearer token and scopes the request to the project", async () => {
    const fake = new FakeXhr();
    const pending = uploadBrdFile({
      file: makeFile("spec.md", 10),
      projectId: "22222222-2222-2222-2222-222222222222",
      token: "secret-token",
      onProgress: () => {},
      createXhr: () => asXhr(fake),
    });
    fake.respond(201, JSON.stringify({ files: [{ status: "clean", id: "f" }] }));
    await pending;

    expect(fake.headers.Authorization).toBe("Bearer secret-token");
    expect(fake.openedUrl).toContain("projectId=22222222-2222-2222-2222-222222222222");
    expect(fake.sentBody).toBeInstanceOf(FormData);
  });

  it("omits the Authorization header when there is no token", async () => {
    const fake = new FakeXhr();
    const pending = uploadBrdFile({
      file: makeFile("spec.md", 10),
      projectId: "33333333-3333-3333-3333-333333333333",
      token: null,
      onProgress: () => {},
      createXhr: () => asXhr(fake),
    });
    fake.respond(401, JSON.stringify({ error: "Authentication required" }));
    await pending;
    expect(fake.headers.Authorization).toBeUndefined();
  });

  it("resolves infected for an EICAR rejection", async () => {
    const fake = new FakeXhr();
    const pending = uploadBrdFile({
      file: makeFile("bad.md", 100),
      projectId: "11111111-1111-1111-1111-111111111111",
      token: "t",
      onProgress: () => {},
      createXhr: () => asXhr(fake),
    });
    fake.respond(
      400,
      JSON.stringify({
        files: [{ status: "infected", signature: "Win.Test.EICAR_HDB-1" }],
        error: "Malware signature detected",
      }),
    );

    await expect(pending).resolves.toMatchObject({
      status: "infected",
      message: MALWARE_WARNING_MESSAGE,
    });
  });

  it("resolves an error on network failure rather than rejecting", async () => {
    const fake = new FakeXhr();
    const pending = uploadBrdFile({
      file: makeFile("spec.md", 10),
      projectId: "11111111-1111-1111-1111-111111111111",
      token: "t",
      onProgress: () => {},
      createXhr: () => asXhr(fake),
    });
    fake.onerror?.();
    await expect(pending).resolves.toEqual({
      status: "error",
      message: "Network error while uploading",
    });
  });

  it("ignores progress events that are not length-computable", async () => {
    const fake = new FakeXhr();
    const onProgress = vi.fn();
    const pending = uploadBrdFile({
      file: makeFile("spec.md", 10),
      projectId: "11111111-1111-1111-1111-111111111111",
      token: "t",
      onProgress,
      createXhr: () => asXhr(fake),
    });

    fake.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 } as ProgressEvent);
    expect(onProgress).not.toHaveBeenCalled();

    fake.respond(201, JSON.stringify({ files: [{ status: "clean", id: "f" }] }));
    await pending;
  });
});
