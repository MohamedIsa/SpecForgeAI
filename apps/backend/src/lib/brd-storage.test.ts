import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import {
  extractExtension,
  sanitizeFileName,
  resolveUploadDir,
  buildStoragePath,
  matchesFileSignature,
  MAGIC_BYTES_HEADER_LENGTH,
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

describe("matchesFileSignature (SEC-T5)", () => {
  it("accepts a genuine PDF header", () => {
    expect(matchesFileSignature("pdf", Buffer.from("%PDF-1.7 rest of file"))).toBe(true);
  });

  it("rejects a .pdf claim whose bytes are plain text", () => {
    expect(matchesFileSignature("pdf", Buffer.from("just some text content"))).toBe(false);
  });

  it("accepts a genuine ZIP/OOXML (.docx) local-file-header signature", () => {
    const header = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("rest of the zip"),
    ]);
    expect(matchesFileSignature("docx", header)).toBe(true);
  });

  it("rejects a .docx claim whose bytes are plain text", () => {
    expect(matchesFileSignature("docx", Buffer.from("just some text content"))).toBe(false);
  });

  it("rejects a PE/executable header disguised with a .pdf extension", () => {
    const peHeader = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(matchesFileSignature("pdf", peHeader)).toBe(false);
  });

  it("rejects a header shorter than the expected signature rather than partially matching", () => {
    // "%PD" — a truncated/prefix match of "%PDF-" must never pass.
    expect(matchesFileSignature("pdf", Buffer.from("%PD"))).toBe(false);
  });

  it("rejects an empty buffer for a format that has a signature to check", () => {
    expect(matchesFileSignature("pdf", Buffer.alloc(0))).toBe(false);
    expect(matchesFileSignature("docx", Buffer.alloc(0))).toBe(false);
  });

  it("does not check .md — any content, including empty, is accepted", () => {
    expect(matchesFileSignature("md", Buffer.from("# just markdown"))).toBe(true);
    expect(matchesFileSignature("md", Buffer.alloc(0))).toBe(true);
    expect(matchesFileSignature("md", Buffer.from([0x4d, 0x5a]))).toBe(true);
  });

  it("does not false-accept a PDF header on a .docx claim or vice versa (cross-format confusion)", () => {
    expect(matchesFileSignature("docx", Buffer.from("%PDF-1.7"))).toBe(false);
    const zipHeader = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("x")]);
    expect(matchesFileSignature("pdf", zipHeader)).toBe(false);
  });
});

describe("MAGIC_BYTES_HEADER_LENGTH", () => {
  it("is at least as long as the longest signature it needs to check (.pdf's 5-byte %PDF-)", () => {
    expect(MAGIC_BYTES_HEADER_LENGTH).toBeGreaterThanOrEqual(5);
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
