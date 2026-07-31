import { initTRPC } from "@trpc/server";

export interface Context {
  req: object;
  res: object;
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
