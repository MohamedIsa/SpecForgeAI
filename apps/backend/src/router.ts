import { router, publicProcedure } from "./trpc";
import { pingDatabase } from "./db/pool";
import { authRouter } from "./routers/auth";
import { projectRouter } from "./routers/project";

export type { Context } from "./trpc";

export type HealthResult =
  | { status: "ok"; database: "connected" }
  | { status: "error"; database: "unreachable"; message: string };

export const appRouter = router({
  health: publicProcedure.query(async (): Promise<HealthResult> => {
    try {
      await pingDatabase();
      return { status: "ok", database: "connected" };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown database error";
      return { status: "error", database: "unreachable", message };
    }
  }),
  auth: authRouter,
  project: projectRouter,
});

export type AppRouter = typeof appRouter;
