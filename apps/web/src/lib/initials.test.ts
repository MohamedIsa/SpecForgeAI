import { describe, it, expect } from "vitest";
import { getInitials } from "./initials";

describe("getInitials", () => {
  it("returns first-and-last initials for a two-word name", () => {
    expect(getInitials("Ada Lovelace")).toBe("AL");
  });

  it("returns first-and-last initials for a name with a middle name", () => {
    expect(getInitials("Grace Brewster Hopper")).toBe("GH");
  });

  it("returns the first two letters for a single-word name", () => {
    expect(getInitials("Cher")).toBe("CH");
  });

  it("collapses extra whitespace between name parts", () => {
    expect(getInitials("  Ada   Lovelace  ")).toBe("AL");
  });

  it("returns a fallback for an empty string", () => {
    expect(getInitials("")).toBe("?");
  });

  it("returns a fallback for a whitespace-only string", () => {
    expect(getInitials("   ")).toBe("?");
  });
});
