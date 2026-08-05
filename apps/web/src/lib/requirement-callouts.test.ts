import { describe, it, expect } from "vitest";
import { segmentDocumentText, countRequirements } from "./requirement-callouts";

describe("segmentDocumentText", () => {
  it("splits text into one segment per non-empty line", () => {
    const segments = segmentDocumentText("First line\n\nSecond line\n");
    expect(segments).toHaveLength(2);
    expect(segments[0]?.text).toBe("First line");
    expect(segments[1]?.text).toBe("Second line");
  });

  it("trims surrounding whitespace from each line", () => {
    const segments = segmentDocumentText("   padded line   ");
    expect(segments[0]?.text).toBe("padded line");
  });

  it("handles CRLF line endings", () => {
    const segments = segmentDocumentText("line one\r\nline two");
    expect(segments).toHaveLength(2);
  });

  it("returns an empty array for empty or whitespace-only text", () => {
    expect(segmentDocumentText("")).toEqual([]);
    expect(segmentDocumentText("   \n  \n ")).toEqual([]);
  });

  it.each([
    "The system must authenticate users",
    "Users shall receive an email",
    "The API should return 404",
    "A password is required for login",
    "This requirement covers billing",
    "The service needs to scale",
    "The client has to retry",
  ])("flags requirement phrasing: %s", (line) => {
    expect(segmentDocumentText(line)[0]?.isRequirement).toBe(true);
  });

  it("is case-insensitive when detecting requirements", () => {
    expect(segmentDocumentText("The system MUST log audit events")[0]?.isRequirement).toBe(true);
  });

  it("does not flag ordinary prose", () => {
    const segments = segmentDocumentText("This document describes the billing project.");
    expect(segments[0]?.isRequirement).toBe(false);
  });

  it("does not flag words that merely contain a keyword substring", () => {
    // "mustard" contains "must" but is not a requirement.
    expect(segmentDocumentText("The mustard colour is used for badges")[0]?.isRequirement).toBe(
      false,
    );
  });

  it("assigns stable unique ids per segment", () => {
    const segments = segmentDocumentText("one\ntwo\nthree");
    expect(new Set(segments.map((segment) => segment.id)).size).toBe(3);
  });
});

describe("countRequirements", () => {
  it("counts only the requirement segments", () => {
    const segments = segmentDocumentText(
      "Intro paragraph\nThe system must log in users\nAnother note\nUsers shall be notified",
    );
    expect(countRequirements(segments)).toBe(2);
  });

  it("returns zero when there are no requirements", () => {
    expect(countRequirements(segmentDocumentText("just prose here"))).toBe(0);
  });
});
