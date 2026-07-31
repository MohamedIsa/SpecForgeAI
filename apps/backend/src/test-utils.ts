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

export function createTestCaller(
  userId: string | null,
  cookies: Record<string, string | undefined> = {},
): TestCallerResult {
  const reply = new FakeReply();
  const ctx: Context = {
    req: { headers: {}, cookies },
    res: reply,
    userId,
  };
  return { caller: appRouter.createCaller(ctx), reply };
}
