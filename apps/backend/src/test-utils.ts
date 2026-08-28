import { randomUUID } from "node:crypto";
import type { CookieSerializeOptions } from "@fastify/cookie";
import { appRouter } from "./router";
import type { Context } from "./router";

export interface CapturedCookie {
  value: string;
  options: CookieSerializeOptions | undefined;
}

export class FakeReply {
  public setCookies: Record<string, CapturedCookie> = {};
  public clearedCookies: Record<string, CookieSerializeOptions | undefined> = {};

  setCookie(name: string, value: string, options?: CookieSerializeOptions): void {
    this.setCookies[name] = { value, options };
  }

  clearCookie(name: string, options?: CookieSerializeOptions): void {
    this.clearedCookies[name] = options;
    delete this.setCookies[name];
  }
}

export interface TestCallerResult {
  caller: ReturnType<typeof appRouter.createCaller>;
  reply: FakeReply;
}

/**
 * `ip` defaults to a fresh value on every call specifically so the
 * authProcedure/aiProcedure rate limiters (keyed by IP or userId — see
 * trpc.ts) never see two unrelated test cases as "the same client": each
 * call to this helper looks like a distinct caller unless a test explicitly
 * passes the same `ip` on purpose (e.g. to exercise the limiter itself).
 */
export function createTestCaller(
  userId: string | null,
  cookies: Record<string, string | undefined> = {},
  ip: string = randomUUID(),
  headers: { authorization?: string; "x-forwarded-proto"?: string } = {},
): TestCallerResult {
  const reply = new FakeReply();
  const ctx: Context = {
    req: { headers, cookies, ip },
    res: reply,
    userId,
  };
  return { caller: appRouter.createCaller(ctx), reply };
}
