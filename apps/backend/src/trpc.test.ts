import { describe, it, expect } from "vitest";
import { TRPCError, type TRPCDefaultErrorShape } from "@trpc/server";
import { z } from "zod";
import { formatZodValidationError } from "./trpc";
import { createProjectInput } from "./validation";

function baseShape(message: string): TRPCDefaultErrorShape {
  return { code: -32600, message, data: { code: "BAD_REQUEST", httpStatus: 400 } };
}

describe("formatZodValidationError", () => {
  it("replaces tRPC's default raw JSON issue dump with the first issue's human-readable message", () => {
    const parseResult = createProjectInput.safeParse({
      name: "Spec Forge",
      key: "1BAD",
      template: "kanban",
    });
    if (parseResult.success) throw new Error("expected the key to fail validation");

    // This mirrors what tRPC's internal input-parsing middleware actually does:
    // it wraps the ZodError as `cause` without an explicit `message`, so
    // TRPCError.message becomes the ZodError's raw stringified issue array.
    const error = new TRPCError({ code: "BAD_REQUEST", cause: parseResult.error });
    expect(error.message).toContain('"validation"'); // sanity check: this is the JSON blob bug

    const shape = formatZodValidationError({ shape: baseShape(error.message), error });

    expect(shape.message).toBe("Key must be 2-10 uppercase letters/numbers, starting with a letter");
    expect(shape.message).not.toContain("{");
    expect(shape.message).not.toContain('"path"');
  });

  it("leaves non-Zod-caused error shapes untouched", () => {
    const error = new TRPCError({ code: "CONFLICT", message: "A project with this key already exists" });
    const shape = formatZodValidationError({ shape: baseShape(error.message), error });
    expect(shape.message).toBe("A project with this key already exists");
  });

  it("falls back to the original shape if the ZodError somehow has no issues", () => {
    const emptyZodError = new z.ZodError([]);
    const error = new TRPCError({ code: "BAD_REQUEST", cause: emptyZodError });
    const shape = formatZodValidationError({ shape: baseShape(error.message), error });
    expect(shape.message).toBe(error.message);
  });
});
