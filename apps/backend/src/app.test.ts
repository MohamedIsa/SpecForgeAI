import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import { pool } from "./db/pool";

const originalEnableSwagger = process.env.ENABLE_SWAGGER;
const createdUserIds: string[] = [];

afterEach(async () => {
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop();
    await pool.query("DELETE FROM users WHERE id = $1", [id]);
  }
});

afterAll(() => {
  if (originalEnableSwagger === undefined) delete process.env.ENABLE_SWAGGER;
  else process.env.ENABLE_SWAGGER = originalEnableSwagger;
});

function uniqueEmail(): string {
  return `app-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

/**
 * light-my-request defaults every injected request's source IP to
 * 127.0.0.1, which would make every signup/login call below look like the
 * same client to authProcedure's per-IP rate limiter. Each call needs a
 * distinct address so this suite's incidental auth-call volume never trips it.
 */
let ipCounter = 0;
function uniqueIp(): string {
  ipCounter += 1;
  return `10.1.${Math.floor(ipCounter / 255)}.${ipCounter % 255}`;
}

describe("buildApp — DEV-TEMP-T1 Swagger docs (enabled by default)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    delete process.env.ENABLE_SWAGGER;
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves the interactive UI at /docs", async () => {
    const response = await app.inject({ method: "GET", url: "/docs" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
  });

  it("serves a valid OpenAPI document at /docs/json", async () => {
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    expect(response.statusCode).toBe(200);

    const document: { openapi: string; paths: Record<string, unknown> } = JSON.parse(
      response.payload,
    );
    expect(document.openapi).toMatch(/^3\./);
    expect(document.paths).toHaveProperty("/api/brd/upload");
    expect(document.paths).toHaveProperty("/api/health");
    expect(document.paths).toHaveProperty("/api/auth/signup");
    expect(document.paths).toHaveProperty("/api/auth/login");
    expect(document.paths).toHaveProperty("/api/projects");
  });

  it("still serves the real tRPC endpoint alongside the docs", async () => {
    const response = await app.inject({ method: "GET", url: "/trpc/health" });
    expect(response.statusCode).toBe(200);
  });

  describe("representative REST wrappers", () => {
    it("GET /api/health reports database connectivity", async () => {
      const response = await app.inject({ method: "GET", url: "/api/health" });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toMatchObject({ status: "ok", database: "connected" });
    });

    it("POST /api/auth/signup creates an account and returns an access token", async () => {
      const email = uniqueEmail();
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/signup",
        remoteAddress: uniqueIp(),
        payload: { fullName: "Docs Test", email, password: "a-strong-password" },
      });
      expect(response.statusCode).toBe(200);

      const body: { accessToken: string; user: { id: string; email: string } } = JSON.parse(
        response.payload,
      );
      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.user.email).toBe(email);
      createdUserIds.push(body.user.id);
    });

    it("POST /api/auth/signup rejects an invalid body with 400", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/signup",
        remoteAddress: uniqueIp(),
        payload: { fullName: "", email: "not-an-email", password: "short" },
      });
      expect(response.statusCode).toBe(400);
    });

    it("POST /api/auth/login authenticates a signed-up account", async () => {
      const email = uniqueEmail();
      const signupResponse = await app.inject({
        method: "POST",
        url: "/api/auth/signup",
        remoteAddress: uniqueIp(),
        payload: { fullName: "Docs Login Test", email, password: "a-strong-password" },
      });
      const signupBody: { user: { id: string } } = JSON.parse(signupResponse.payload);
      createdUserIds.push(signupBody.user.id);

      const loginResponse = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        remoteAddress: uniqueIp(),
        payload: { email, password: "a-strong-password" },
      });
      expect(loginResponse.statusCode).toBe(200);
      expect(JSON.parse(loginResponse.payload)).toHaveProperty("accessToken");
    });

    it("POST /api/auth/login rejects the wrong password with 401", async () => {
      const email = uniqueEmail();
      const signupResponse = await app.inject({
        method: "POST",
        url: "/api/auth/signup",
        remoteAddress: uniqueIp(),
        payload: { fullName: "Docs Wrong Password", email, password: "a-strong-password" },
      });
      const signupBody: { user: { id: string } } = JSON.parse(signupResponse.payload);
      createdUserIds.push(signupBody.user.id);

      const loginResponse = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        remoteAddress: uniqueIp(),
        payload: { email, password: "the-wrong-password" },
      });
      expect(loginResponse.statusCode).toBe(401);
    });

    it("GET /api/projects requires authentication", async () => {
      const response = await app.inject({ method: "GET", url: "/api/projects" });
      expect(response.statusCode).toBe(401);
    });

    it("GET /api/projects returns the caller's projects when authenticated", async () => {
      const email = uniqueEmail();
      const signupResponse = await app.inject({
        method: "POST",
        url: "/api/auth/signup",
        remoteAddress: uniqueIp(),
        payload: { fullName: "Docs Projects Test", email, password: "a-strong-password" },
      });
      const signupBody: { accessToken: string; user: { id: string } } = JSON.parse(
        signupResponse.payload,
      );
      createdUserIds.push(signupBody.user.id);

      const response = await app.inject({
        method: "GET",
        url: "/api/projects",
        headers: { authorization: `Bearer ${signupBody.accessToken}` },
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual([]);
    });
  });
});

describe("buildApp — ENABLE_SWAGGER=false", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.ENABLE_SWAGGER = "false";
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.ENABLE_SWAGGER;
  });

  it("removes /docs entirely", async () => {
    const response = await app.inject({ method: "GET", url: "/docs" });
    expect(response.statusCode).toBe(404);
  });

  it("removes the representative REST wrappers", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(404);
  });

  it("leaves the production BRD upload route in place", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/brd/upload?projectId=11111111-1111-1111-1111-111111111111",
    });
    // 401 (auth required), not 404 — the real route is still registered.
    expect(response.statusCode).toBe(401);
  });

  it("leaves /trpc in place", async () => {
    const response = await app.inject({ method: "GET", url: "/trpc/health" });
    expect(response.statusCode).toBe(200);
  });
});

describe("buildApp — ENABLE_SWAGGER unset in production", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let app: FastifyInstance;

  beforeAll(async () => {
    delete process.env.ENABLE_SWAGGER;
    process.env.NODE_ENV = "production";
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.ENABLE_SWAGGER;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it("fails closed: a deployment that never set ENABLE_SWAGGER does not expose /docs", async () => {
    const response = await app.inject({ method: "GET", url: "/docs" });
    expect(response.statusCode).toBe(404);
  });

  it("fails closed: the REST wrappers are absent too", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(404);
  });
});

describe("buildApp — ENABLE_SWAGGER=true overrides production", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.ENABLE_SWAGGER = "true";
    process.env.NODE_ENV = "production";
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.ENABLE_SWAGGER;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it("exposes /docs when explicitly opted in, even in production", async () => {
    const response = await app.inject({ method: "GET", url: "/docs" });
    expect(response.statusCode).toBe(200);
  });
});

describe("buildApp — ENABLE_SWAGGER value normalization", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterAll(() => {
    delete process.env.ENABLE_SWAGGER;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it.each(["FALSE", "False", " false ", "false"])(
    "treats %j as disabled regardless of case or surrounding whitespace",
    async (value) => {
      process.env.ENABLE_SWAGGER = value;
      delete process.env.NODE_ENV;
      const app = await buildApp();
      await app.ready();
      const response = await app.inject({ method: "GET", url: "/docs" });
      await app.close();
      expect(response.statusCode).toBe(404);
    },
  );

  it.each(["TRUE", "True", " true ", "true"])(
    "treats %j as enabled regardless of case or surrounding whitespace",
    async (value) => {
      process.env.ENABLE_SWAGGER = value;
      process.env.NODE_ENV = "production";
      const app = await buildApp();
      await app.ready();
      const response = await app.inject({ method: "GET", url: "/docs" });
      await app.close();
      expect(response.statusCode).toBe(200);
    },
  );

  it.each(["0", "no", "off", "1", "yes", ""])(
    "treats the unrecognized value %j the same as unset (production fails closed)",
    async (value) => {
      process.env.ENABLE_SWAGGER = value;
      process.env.NODE_ENV = "production";
      const app = await buildApp();
      await app.ready();
      const response = await app.inject({ method: "GET", url: "/docs" });
      await app.close();
      expect(response.statusCode).toBe(404);
    },
  );
});
