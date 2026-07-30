import { initTRPC } from "@trpc/server";

export interface Context {
  req: object;
  res: object;
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const appRouter = router({
  health: publicProcedure.query(() => {
    return { status: "ok" as const };
  }),
});

export type AppRouter = typeof appRouter;
