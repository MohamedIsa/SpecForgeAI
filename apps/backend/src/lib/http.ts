import type { CookieSerializeOptions } from "@fastify/cookie";

export interface RequestLike {
  headers: { authorization?: string };
  cookies: Record<string, string | undefined>;
}

export interface ReplyLike {
  setCookie(name: string, value: string, options?: CookieSerializeOptions): void;
  clearCookie(name: string, options?: CookieSerializeOptions): void;
}
