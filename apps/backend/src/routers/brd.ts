import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { pool } from "../db/pool";
import {
  getBrdFilesInput,
  getTechPreferencesInput,
  saveTechPreferencesInput,
} from "../validation";
import { getMembershipRole, canEditProject } from "../lib/project-access";
import type { BrdExtension } from "../lib/brd-storage";

interface BrdFileRow {
  id: string;
  project_id: string;
  file_name: string;
  extension: string;
  byte_size: string;
  checksum: string;
  scan_status: string;
  created_at: Date;
}

interface TechPreferencesRow {
  frontend: string | null;
  backend: string | null;
  database: string | null;
  infra: string | null;
  updated_at: Date;
}

export interface BrdFile {
  id: string;
  projectId: string;
  fileName: string;
  extension: BrdExtension;
  byteSize: number;
  checksum: string;
  scanStatus: "clean";
  createdAt: string;
}

export interface TechPreferences {
  frontend: string | null;
  backend: string | null;
  database: string | null;
  infra: string | null;
  updatedAt: string | null;
}

function isBrdExtension(value: string): value is BrdExtension {
  return value === "pdf" || value === "docx" || value === "md";
}

function toBrdFile(row: BrdFileRow): BrdFile {
  if (!isBrdExtension(row.extension)) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unknown BRD file extension" });
  }
  if (row.scan_status !== "clean") {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unknown BRD scan status" });
  }
  return {
    id: row.id,
    projectId: row.project_id,
    fileName: row.file_name,
    extension: row.extension,
    // bigint columns are returned as strings by node-postgres to avoid
    // precision loss; file sizes are capped at 25MB so Number is safe here.
    byteSize: Number(row.byte_size),
    checksum: row.checksum,
    scanStatus: "clean",
    createdAt: row.created_at.toISOString(),
  };
}

async function requireMembership(projectId: string, userId: string): Promise<void> {
  const role = await getMembershipRole(projectId, userId);
  if (!role) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this project" });
  }
}

async function requireEditor(projectId: string, userId: string): Promise<void> {
  const role = await getMembershipRole(projectId, userId);
  if (!role) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this project" });
  }
  if (!canEditProject(role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to modify this project's BRD context",
    });
  }
}

export const brdRouter = router({
  listFiles: protectedProcedure
    .input(getBrdFilesInput)
    .query(async ({ ctx, input }): Promise<BrdFile[]> => {
      await requireMembership(input.projectId, ctx.userId);

      const result = await pool.query<BrdFileRow>(
        `SELECT id, project_id, file_name, extension, byte_size, checksum, scan_status, created_at
         FROM brd_files
         WHERE project_id = $1
         ORDER BY created_at ASC`,
        [input.projectId],
      );
      return result.rows.map(toBrdFile);
    }),

  getTechPreferences: protectedProcedure
    .input(getTechPreferencesInput)
    .query(async ({ ctx, input }): Promise<TechPreferences> => {
      await requireMembership(input.projectId, ctx.userId);

      const result = await pool.query<TechPreferencesRow>(
        `SELECT frontend, backend, database, infra, updated_at
         FROM project_tech_preferences
         WHERE project_id = $1`,
        [input.projectId],
      );
      const row = result.rows[0];
      if (!row) {
        return { frontend: null, backend: null, database: null, infra: null, updatedAt: null };
      }
      return {
        frontend: row.frontend,
        backend: row.backend,
        database: row.database,
        infra: row.infra,
        updatedAt: row.updated_at.toISOString(),
      };
    }),

  saveTechPreferences: protectedProcedure
    .input(saveTechPreferencesInput)
    .mutation(async ({ ctx, input }): Promise<TechPreferences> => {
      await requireEditor(input.projectId, ctx.userId);

      // Empty strings are treated as "cleared" so the UI can blank a field.
      const normalise = (value: string | null | undefined): string | null =>
        value === undefined || value === null || value === "" ? null : value;

      const result = await pool.query<TechPreferencesRow>(
        `INSERT INTO project_tech_preferences
           (project_id, frontend, backend, database, infra, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (project_id) DO UPDATE SET
           frontend = EXCLUDED.frontend,
           backend = EXCLUDED.backend,
           database = EXCLUDED.database,
           infra = EXCLUDED.infra,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()
         RETURNING frontend, backend, database, infra, updated_at`,
        [
          input.projectId,
          normalise(input.frontend),
          normalise(input.backend),
          normalise(input.database),
          normalise(input.infra),
          ctx.userId,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save tech stack preferences",
        });
      }
      return {
        frontend: row.frontend,
        backend: row.backend,
        database: row.database,
        infra: row.infra,
        updatedAt: row.updated_at.toISOString(),
      };
    }),
});
