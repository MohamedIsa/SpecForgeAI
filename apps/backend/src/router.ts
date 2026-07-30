import { initTRPC } from "@trpc/server";
import { pingDatabase } from "./db/pool";

export interface Context {
  req: object;
  res: object;
}

export type HealthResult =
  | { status: "ok"; database: "connected" }
  | { status: "error"; database: "unreachable"; message: string };

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

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
});

export type AppRouter = typeof appRouter;
