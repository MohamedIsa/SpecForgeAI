import { describe, it, expect } from "vitest";
import { appRouter } from "./router";
import type { Context } from "./router";

function createCaller() {
  const ctx: Context = { req: {} as object, res: {} as object };
  return appRouter.createCaller(ctx);
}

describe("health endpoint", () => {
  it("returns status ok", async () => {
    const caller = createCaller();
    const result = await caller.health();
    expect(result).toEqual({ status: "ok" });
  });

  it("returns an object with status key", async () => {
    const caller = createCaller();
    const result = await caller.health();
    expect(result).toHaveProperty("status");
    expect(result.status).toBe("ok");
  });
});
