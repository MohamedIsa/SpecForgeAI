import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { createTestCaller } from "./test-utils";

const pingDatabaseMock = vi.fn();

vi.mock("./db/pool", () => ({
  pingDatabase: () => pingDatabaseMock(),
}));

function createCaller() {
  return createTestCaller(null).caller;
}

let consoleErrorSpy: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  pingDatabaseMock.mockReset();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("health endpoint — database failure masking (SEC-T5)", () => {
  it("returns a generic message instead of the raw database error", async () => {
    const sensitiveError = new Error(
      "connect ECONNREFUSED 10.20.30.40:5432 (user=admin password=hunter2)",
    );
    pingDatabaseMock.mockRejectedValue(sensitiveError);

    const result = await createCaller().health();

    expect(result).toEqual({
      status: "error",
      database: "unreachable",
      message: "Database is unreachable",
    });
    // The generic message must not merely be prepended — the raw error text
    // must not appear anywhere in what the client receives.
    expect(JSON.stringify(result)).not.toContain("10.20.30.40");
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(JSON.stringify(result)).not.toContain("ECONNREFUSED");
  });

  it("still logs the raw error server-side for operators", async () => {
    const sensitiveError = new Error("connect ECONNREFUSED 10.20.30.40:5432");
    pingDatabaseMock.mockRejectedValue(sensitiveError);

    await createCaller().health();

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const loggedArgs = consoleErrorSpy.mock.calls[0];
    expect(loggedArgs).toBeDefined();
    expect(loggedArgs).toContain(sensitiveError);
  });

  it("returns the same generic message regardless of the underlying error's shape", async () => {
    pingDatabaseMock.mockRejectedValue("a plain string rejection, not even an Error instance");

    const result = await createCaller().health();

    expect(result).toEqual({
      status: "error",
      database: "unreachable",
      message: "Database is unreachable",
    });
  });

  it("returns status ok and database connected when the ping succeeds", async () => {
    pingDatabaseMock.mockResolvedValue(undefined);

    const result = await createCaller().health();

    expect(result).toEqual({ status: "ok", database: "connected" });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
