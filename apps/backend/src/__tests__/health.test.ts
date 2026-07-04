import { describe, it, expect } from "vitest";

import { buildApp } from "../server";

describe("health check", () => {
  it("returns status ok and timestamp", async () => {
    const server = await buildApp();
    await server.ready();

    const response = await server.inject({
      method: "GET",
      url: "/trpc/health",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as unknown;
    const data = (
      body as { result: { data: { status: string; timestamp: number } } }
    ).result.data;

    expect(data.status).toBe("ok");
    expect(typeof data.timestamp).toBe("number");
    await server.close();
  });

  it("returns 404 for invalid procedure", async () => {
    const server = await buildApp();
    await server.ready();

    const response = await server.inject({
      method: "GET",
      url: "/trpc/nonexistent",
    });

    expect(response.statusCode).toBe(404);
    await server.close();
  });
});
