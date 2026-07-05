import { publicProcedure, router } from "./index";
import { brdRouter } from "../routers/brd";
import { backlogRouter } from "../routers/backlog";

export const appRouter = router({
  health: publicProcedure.query(() => ({
    status: "ok" as const,
    timestamp: Date.now(),
  })),
  brd: brdRouter,
  backlog: backlogRouter,
});

export type AppRouter = typeof appRouter;
