import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { pool } from "../db/pool";
import {
  getProjectStatusesInput,
  createStatusInput,
  reorderStatusesInput,
  deleteStatusInput,
} from "../validation";
import { isMembershipRole, type MembershipRole } from "./project";

interface StatusRow {
  id: string;
  name: string;
  color: string;
  position: number;
}

export interface ProjectStatus {
  id: string;
  name: string;
  color: string;
  position: number;
}

export interface CreateStatusResult {
  status: ProjectStatus;
}

export interface ReorderStatusesResult {
  statuses: ProjectStatus[];
}

export interface DeleteStatusResult {
  success: true;
}

const POSTGRES_UNIQUE_VIOLATION = "23505";
const POSTGRES_FOREIGN_KEY_VIOLATION = "23503";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  );
}

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === POSTGRES_FOREIGN_KEY_VIOLATION
  );
}

function toProjectStatus(row: StatusRow): ProjectStatus {
  return { id: row.id, name: row.name, color: row.color, position: row.position };
}

async function requireMembership(projectId: string, userId: string): Promise<MembershipRole> {
  const result = await pool.query<{ role: string }>(
    "SELECT role FROM project_memberships WHERE project_id = $1 AND user_id = $2",
    [projectId, userId],
  );
  const role = result.rows[0]?.role;
  if (!role || !isMembershipRole(role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this project" });
  }
  return role;
}

function requireEditorOrOwner(role: MembershipRole): void {
  if (role !== "owner" && role !== "editor") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to modify this project's statuses",
    });
  }
}

const AUTO_COLOR_PALETTE = ["#71717a", "#a78bfa", "#fbbf24", "#38bdf8", "#4ade80"];

export const statusRouter = router({
  getProjectStatuses: protectedProcedure
    .input(getProjectStatusesInput)
    .query(async ({ ctx, input }): Promise<ProjectStatus[]> => {
      await requireMembership(input.projectId, ctx.userId);

      const result = await pool.query<StatusRow>(
        `SELECT id, name, color, position
         FROM project_statuses
         WHERE project_id = $1
         ORDER BY position ASC`,
        [input.projectId],
      );
      return result.rows.map(toProjectStatus);
    }),

  createStatus: protectedProcedure
    .input(createStatusInput)
    .mutation(async ({ ctx, input }): Promise<CreateStatusResult> => {
      const role = await requireMembership(input.projectId, ctx.userId);
      requireEditorOrOwner(role);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Locks existing status rows for this project so a concurrent
        // createStatus/reorderStatuses/deleteStatus can't compute a stale
        // MAX(position) — or reorder against a stale row set — before this
        // transaction commits.
        await client.query("SELECT id FROM project_statuses WHERE project_id = $1 FOR UPDATE", [
          input.projectId,
        ]);

        const maxPositionResult = await client.query<{ max: number | null }>(
          "SELECT MAX(position) AS max FROM project_statuses WHERE project_id = $1",
          [input.projectId],
        );
        const nextPosition = (maxPositionResult.rows[0]?.max ?? -1) + 1;
        const color =
          input.color ?? AUTO_COLOR_PALETTE[nextPosition % AUTO_COLOR_PALETTE.length];

        let statusRow: StatusRow;
        try {
          const inserted = await client.query<StatusRow>(
            `INSERT INTO project_statuses (project_id, name, color, position)
             VALUES ($1, $2, $3, $4)
             RETURNING id, name, color, position`,
            [input.projectId, input.name, color, nextPosition],
          );
          const row = inserted.rows[0];
          if (!row) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to create status",
            });
          }
          statusRow = row;
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "A status with this name already exists in this project",
            });
          }
          throw err;
        }

        await client.query("COMMIT");
        return { status: toProjectStatus(statusRow) };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }),

  reorderStatuses: protectedProcedure
    .input(reorderStatusesInput)
    .mutation(async ({ ctx, input }): Promise<ReorderStatusesResult> => {
      const role = await requireMembership(input.projectId, ctx.userId);
      requireEditorOrOwner(role);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const existingResult = await client.query<{ id: string }>(
          "SELECT id FROM project_statuses WHERE project_id = $1 FOR UPDATE",
          [input.projectId],
        );
        const existingIds = new Set(existingResult.rows.map((row) => row.id));
        const providedIds = new Set(input.orderedStatusIds);

        if (
          existingIds.size !== providedIds.size ||
          input.orderedStatusIds.some((id) => !existingIds.has(id))
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "orderedStatusIds must contain exactly the project's current statuses",
          });
        }

        for (let position = 0; position < input.orderedStatusIds.length; position++) {
          const statusId = input.orderedStatusIds[position];
          if (!statusId) continue;
          await client.query(
            "UPDATE project_statuses SET position = $1 WHERE id = $2 AND project_id = $3",
            [position, statusId, input.projectId],
          );
        }

        const updated = await client.query<StatusRow>(
          `SELECT id, name, color, position
           FROM project_statuses
           WHERE project_id = $1
           ORDER BY position ASC`,
          [input.projectId],
        );

        await client.query("COMMIT");
        return { statuses: updated.rows.map(toProjectStatus) };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }),

  deleteStatus: protectedProcedure
    .input(deleteStatusInput)
    .mutation(async ({ ctx, input }): Promise<DeleteStatusResult> => {
      const role = await requireMembership(input.projectId, ctx.userId);
      requireEditorOrOwner(role);

      let deleted;
      try {
        deleted = await pool.query(
          "DELETE FROM project_statuses WHERE id = $1 AND project_id = $2",
          [input.statusId, input.projectId],
        );
      } catch (err) {
        if (isForeignKeyViolation(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Cannot delete a status that still has tickets. Move or delete its tickets first.",
          });
        }
        throw err;
      }
      if (deleted.rowCount === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Status not found in this project" });
      }
      return { success: true };
    }),
});
