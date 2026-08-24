import type { CookieSerializeOptions } from "@fastify/cookie";

export interface RequestLike {
  headers: { authorization?: string };
  cookies: Record<string, string | undefined>;
  /** Client IP, used to key the per-procedure rate limiters in trpc.ts. */
  ip: string;
}

export interface ReplyLike {
  setCookie(name: string, value: string, options?: CookieSerializeOptions): void;
  clearCookie(name: string, options?: CookieSerializeOptions): void;
}
