import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../trpc";
import { createStorageService } from "../services/storage";
import { createDeepSeekClient } from "../services/ai";
import { ExtractionPipeline } from "../services/extraction-pipeline";
import { createPool, getPool } from "../db/pool";

function pipelineForUpload() {
  return new ExtractionPipeline(
    createPool(),
    createStorageService(),
    createDeepSeekClient(),
  );
}

export const brdRouter = router({
  uploadBrd: publicProcedure
    .input(
      z.object({
        fileBase64: z.string().min(1),
        fileName: z.string().min(1),
        targetTechStack: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const pipeline = pipelineForUpload();
      const uploadId = await pipeline.initiate(input);

      return { uploadId };
    }),

  getUploadStatus: publicProcedure
    .input(z.string().min(1))
    .query(async ({ input }) => {
      const pool = getPool();

      try {
        const status = await ExtractionPipeline.getStatus(pool, input);

        return status;
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Upload not found")) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: err.message,
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Failed to get upload status.",
        });
      }
    }),

  listProjects: publicProcedure
    .query(async () => {
      const pool = getPool();

      const result = await pool.query(
        `SELECT id, file_name, status, created_at
         FROM brd_uploads
         ORDER BY created_at DESC`,
      );

      const projects = (result.rows as Array<Record<string, unknown>>).map(
        (r) => ({
          id: r["id"],
          fileName: r["file_name"],
          status: r["status"],
          createdAt: r["created_at"],
        }),
      );

      return projects;
    }),
});
