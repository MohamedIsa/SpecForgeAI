import { describe, it, expect } from "vitest";
import { formatBytes } from "./format-bytes";

describe("formatBytes", () => {
  it("renders bytes below 1KB verbatim", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("renders kilobytes with one decimal", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });

  it("renders megabytes with one decimal", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25.0 MB");
  });
});
