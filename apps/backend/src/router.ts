import { router, publicProcedure } from "./trpc";
import { pingDatabase } from "./db/pool";
import { authRouter } from "./routers/auth";
import { projectRouter } from "./routers/project";
import { statusRouter } from "./routers/status";
import { ticketRouter } from "./routers/ticket";
import { brdRouter } from "./routers/brd";
import { clarificationRouter } from "./routers/clarification";
import { backlogRouter } from "./routers/backlog";

export type { Context } from "./trpc";

export type HealthResult =
  | { status: "ok"; database: "connected" }
  | { status: "error"; database: "unreachable"; message: "Database is unreachable" };

const GENERIC_DATABASE_ERROR_MESSAGE = "Database is unreachable";

export const appRouter = router({
  health: publicProcedure.query(async (): Promise<HealthResult> => {
    try {
      await pingDatabase();
      return { status: "ok", database: "connected" };
    } catch (err) {
      // The raw error (connection string details, driver internals, table
      // names) is logged server-side for operators, but never reaches the
      // client — an unauthenticated caller must not learn anything about
      // the database's internals from a health-check failure.
      console.error("Health check: database is unreachable", err);
      return {
        status: "error",
        database: "unreachable",
        message: GENERIC_DATABASE_ERROR_MESSAGE,
      };
    }
  }),
  auth: authRouter,
  project: projectRouter,
  status: statusRouter,
  ticket: ticketRouter,
  brd: brdRouter,
  clarification: clarificationRouter,
  backlog: backlogRouter,
});

export type AppRouter = typeof appRouter;
