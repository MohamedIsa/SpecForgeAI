import { publicProcedure, router } from "./index";
import { brdRouter } from "../routers/brd";

export const appRouter = router({
  health: publicProcedure.query(() => ({
    status: "ok" as const,
    timestamp: Date.now(),
  })),
  brd: brdRouter,
});

export type AppRouter = typeof appRouter;
