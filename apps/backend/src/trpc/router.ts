import { publicProcedure, router } from "./index";

export const appRouter = router({
  health: publicProcedure.query(() => ({
    status: "ok" as const,
    timestamp: Date.now(),
  })),
});

export type AppRouter = typeof appRouter;
