import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import {
  extractExtension,
  sanitizeFileName,
  resolveUploadDir,
  buildStoragePath,
  MAX_BRD_FILE_BYTES,
} from "./brd-storage";

describe("MAX_BRD_FILE_BYTES", () => {
  it("is 25MB", () => {
    expect(MAX_BRD_FILE_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe("extractExtension", () => {
  it.each(["requirements.pdf", "spec.docx", "notes.md"])("accepts %s", (fileName) => {
    expect(extractExtension(fileName)).not.toBeNull();
  });

  it("is case-insensitive", () => {
    expect(extractExtension("REQUIREMENTS.PDF")).toBe("pdf");
    expect(extractExtension("Spec.DocX")).toBe("docx");
  });

  it("uses the final extension of a multi-dot filename", () => {
    expect(extractExtension("v1.2.final.md")).toBe("md");
  });

  it.each(["malware.exe", "archive.zip", "script.sh", "image.png"])(
    "rejects disallowed type %s",
    (fileName) => {
      expect(extractExtension(fileName)).toBeNull();
    },
  );

  it("rejects a filename with no extension", () => {
    expect(extractExtension("README")).toBeNull();
  });

  it("rejects a filename ending in a bare dot", () => {
    expect(extractExtension("weird.")).toBeNull();
  });

  it("rejects a double-extension attempt whose final extension is disallowed", () => {
    expect(extractExtension("payload.md.exe")).toBeNull();
  });
});

describe("sanitizeFileName", () => {
  it("keeps an ordinary filename unchanged", () => {
    expect(sanitizeFileName("requirements.pdf")).toBe("requirements.pdf");
  });

  it("preserves unicode filenames", () => {
    expect(sanitizeFileName("要件定義.pdf")).toBe("要件定義.pdf");
    expect(sanitizeFileName("спецификация.md")).toBe("спецификация.md");
    expect(sanitizeFileName("café-brief.docx")).toBe("café-brief.docx");
  });

  it("strips POSIX path traversal segments", () => {
    expect(sanitizeFileName("../../etc/passwd.md")).toBe("passwd.md");
    expect(sanitizeFileName("/absolute/path/spec.pdf")).toBe("spec.pdf");
  });

  it("strips Windows path traversal segments", () => {
    expect(sanitizeFileName("..\\..\\windows\\system32\\evil.md")).toBe("evil.md");
    expect(sanitizeFileName("C:\\Users\\me\\spec.docx")).toBe("spec.docx");
  });

  it("strips NUL bytes and control characters", () => {
    expect(sanitizeFileName("spec\u0000.pdf")).toBe("spec.pdf");
    expect(sanitizeFileName("re\u0007port\u001b.md")).toBe("report.md");
  });

  it("falls back to a placeholder for empty or dot-only names", () => {
    expect(sanitizeFileName("")).toBe("unnamed");
    expect(sanitizeFileName("   ")).toBe("unnamed");
    expect(sanitizeFileName(".")).toBe("unnamed");
    expect(sanitizeFileName("..")).toBe("unnamed");
  });

  it("clamps absurdly long filenames to 255 characters", () => {
    const long = `${"a".repeat(500)}.pdf`;
    expect(sanitizeFileName(long)).toHaveLength(255);
  });
});

describe("resolveUploadDir", () => {
  const original = process.env.BRD_UPLOAD_DIR;
  afterEach(() => {
    if (original === undefined) delete process.env.BRD_UPLOAD_DIR;
    else process.env.BRD_UPLOAD_DIR = original;
  });

  it("resolves the configured directory to an absolute path", () => {
    process.env.BRD_UPLOAD_DIR = "./tmp-uploads";
    expect(path.isAbsolute(resolveUploadDir())).toBe(true);
  });

  it("defaults to ./uploads when unset", () => {
    delete process.env.BRD_UPLOAD_DIR;
    expect(resolveUploadDir().endsWith("uploads")).toBe(true);
  });
});

describe("buildStoragePath", () => {
  it("nests the server-generated file id under the project directory", () => {
    const result = buildStoragePath(
      "/srv/uploads",
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      "pdf",
    );
    expect(result).toBe(
      "/srv/uploads/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.pdf",
    );
  });

  it("stays inside the upload directory", () => {
    const uploadDir = "/srv/uploads";
    const result = buildStoragePath(uploadDir, "project", "file-id", "md");
    expect(result.startsWith(`${uploadDir}${path.sep}`)).toBe(true);
  });
});
