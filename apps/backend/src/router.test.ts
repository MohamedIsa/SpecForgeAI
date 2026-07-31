import { describe, it, expect } from "vitest";
import { createTestCaller } from "./test-utils";

function createCaller() {
  return createTestCaller(null).caller;
}

describe("health endpoint", () => {
  it("returns status ok and database connected when Postgres is reachable", async () => {
    const caller = createCaller();
    const result = await caller.health();
    expect(result).toEqual({ status: "ok", database: "connected" });
  });

  it("returns an object with status and database keys", async () => {
    const caller = createCaller();
    const result = await caller.health();
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("database");
    expect(result.status).toBe("ok");
  });
});
