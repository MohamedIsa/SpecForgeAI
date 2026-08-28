import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * apps/web/nginx.conf is deploy configuration, not TypeScript — nothing else
 * in this repo typechecks or exercises it directly. These tests read the
 * real file (not a copy or a hardcoded expected string) so a future edit
 * that reintroduces the spoofable $proxy_add_x_forwarded_for pattern, or
 * accidentally widens the CSP back out, fails a real test instead of only
 * being caught by a human re-reading the diff.
 */
const nginxConfigPath = path.resolve(__dirname, "../../web/nginx.conf");
const nginxConfig = readFileSync(nginxConfigPath, "utf8");

/** Active `proxy_set_header` directive lines only — excludes comment prose
 *  (this file's own explanatory comments mention both header names and the
 *  vulnerable $proxy_add_x_forwarded_for variable by name, which a naive
 *  substring search would false-positive/false-negative on). */
function activeDirectiveLines(headerName: string): string[] {
  return nginxConfig
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("proxy_set_header") && line.includes(headerName));
}

describe("apps/web/nginx.conf — non-spoofable client IP (SEC-T6)", () => {
  it("replaces X-Forwarded-For with $remote_addr, never appending via $proxy_add_x_forwarded_for", () => {
    // The vulnerable pattern must not appear in an active directive: a
    // client sitting in front of this proxy could otherwise set its own
    // X-Forwarded-For with an arbitrary fake IP, which the backend's
    // trustProxy config would take as authoritative (leftmost value),
    // letting an attacker forge a different "IP" on every request and
    // bypass per-IP rate limiting entirely.
    const forwardedForLines = activeDirectiveLines("X-Forwarded-For");
    for (const line of forwardedForLines) {
      expect(line).not.toContain("$proxy_add_x_forwarded_for");
    }
  });

  it("sets X-Forwarded-For to the real, non-spoofable TCP peer address on both proxied routes", () => {
    const forwardedForLines = activeDirectiveLines("X-Forwarded-For");
    expect(forwardedForLines).toHaveLength(2); // /trpc/ and /api/
    for (const line of forwardedForLines) {
      expect(line).toContain("$remote_addr");
    }
  });

  it("still forwards the original request scheme via X-Forwarded-Proto on both proxied routes", () => {
    const forwardedProtoLines = activeDirectiveLines("X-Forwarded-Proto");
    expect(forwardedProtoLines).toHaveLength(2);
    for (const line of forwardedProtoLines) {
      expect(line).toContain("$scheme");
    }
  });
});

describe("apps/web/nginx.conf — Content-Security-Policy (SEC-T6)", () => {
  function extractCsp(): string {
    const match = /Content-Security-Policy\s+"([^"]+)"/.exec(nginxConfig);
    if (!match?.[1]) throw new Error("Could not find a Content-Security-Policy header in nginx.conf");
    return match[1];
  }

  it("does not allow 'unsafe-inline' in script-src", () => {
    const csp = extractCsp();
    const scriptSrc = /script-src\s+([^;]+);/.exec(csp)?.[1];
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain("unsafe-inline");
  });

  it("narrows connect-src to 'self' only", () => {
    const csp = extractCsp();
    const connectSrc = /connect-src\s+([^;]+);/.exec(csp)?.[1]?.trim();
    expect(connectSrc).toBe("'self'");
  });

  it("still blocks framing entirely (frame-ancestors 'none' unaffected by this ticket)", () => {
    const csp = extractCsp();
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe("apps/backend/src/app.ts — trustProxy (SEC-T6)", () => {
  it("configures Fastify with trustProxy so request.ip reflects the authoritative X-Forwarded-For", () => {
    const appTsPath = path.resolve(__dirname, "app.ts");
    const appTs = readFileSync(appTsPath, "utf8");
    expect(appTs).toMatch(/trustProxy:\s*true/);
  });
});
