import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import { router, protectedProcedure } from "../trpc";
import { pool } from "../db/pool";
import { createProjectInput, inviteMemberInput } from "../validation";

export type ProjectTemplate = "kanban" | "scrum";
export type MembershipRole = "owner" | "editor" | "viewer";

interface ProjectRow {
  id: string;
  name: string;
  key: string;
  description: string | null;
  template: string;
  next_ticket_number: number;
  owner_id: string;
  created_at: Date;
}

interface StatusRow {
  id: string;
  name: string;
  color: string;
  position: number;
}

interface MembershipRow {
  id: string;
  project_id: string;
  user_id: string;
  role: string;
}

export interface Project {
  id: string;
  name: string;
  key: string;
  description: string | null;
  template: ProjectTemplate;
  nextTicketNumber: number;
  createdAt: string;
}

export interface ProjectSummary extends Project {
  role: MembershipRole;
  memberCount: number;
}

export interface ProjectStatus {
  id: string;
  name: string;
  color: string;
  position: number;
}

export interface CreateProjectResult {
  project: Project;
  statuses: ProjectStatus[];
}

export interface Membership {
  id: string;
  projectId: string;
  userId: string;
  role: MembershipRole;
}

export interface InviteMemberResult {
  membership: Membership;
}

const POSTGRES_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  );
}

function isProjectTemplate(value: string): value is ProjectTemplate {
  return value === "kanban" || value === "scrum";
}

export function isMembershipRole(value: string): value is MembershipRole {
  return value === "owner" || value === "editor" || value === "viewer";
}

function toProject(row: ProjectRow): Project {
  if (!isProjectTemplate(row.template)) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unknown project template" });
  }
  return {
    id: row.id,
    name: row.name,
    key: row.key,
    description: row.description,
    template: row.template,
    nextTicketNumber: row.next_ticket_number,
    createdAt: row.created_at.toISOString(),
  };
}

function toMembership(row: MembershipRow): Membership {
  if (!isMembershipRole(row.role)) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unknown membership role" });
  }
  return { id: row.id, projectId: row.project_id, userId: row.user_id, role: row.role };
}

interface DefaultStatusDefinition {
  name: string;
  color: string;
}

const DEFAULT_STATUSES: Record<ProjectTemplate, DefaultStatusDefinition[]> = {
  kanban: [
    { name: "Backlog", color: "#71717a" },
    { name: "In Clarification", color: "#a78bfa" },
    { name: "In Progress", color: "#fbbf24" },
    { name: "Review", color: "#38bdf8" },
    { name: "Done", color: "#4ade80" },
  ],
  scrum: [
    { name: "Backlog", color: "#71717a" },
    { name: "Sprint Backlog", color: "#a78bfa" },
    { name: "In Progress", color: "#fbbf24" },
    { name: "QA / Review", color: "#38bdf8" },
    { name: "Done", color: "#4ade80" },
  ],
};

async function insertDefaultStatuses(
  client: PoolClient,
  projectId: string,
  template: ProjectTemplate,
): Promise<ProjectStatus[]> {
  const definitions = DEFAULT_STATUSES[template];
  const statuses: ProjectStatus[] = [];

  for (let position = 0; position < definitions.length; position++) {
    const definition = definitions[position];
    if (!definition) continue;
    const inserted = await client.query<StatusRow>(
      `INSERT INTO project_statuses (project_id, name, color, position)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, color, position`,
      [projectId, definition.name, definition.color, position],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create default statuses",
      });
    }
    statuses.push(row);
  }

  return statuses;
}

export const projectRouter = router({
  listUserProjects: protectedProcedure.query(async ({ ctx }): Promise<ProjectSummary[]> => {
    const result = await pool.query<ProjectRow & { role: string; member_count: string }>(
      `SELECT p.id, p.name, p.key, p.description, p.template, p.next_ticket_number,
              p.owner_id, p.created_at, pm.role,
              (SELECT COUNT(*)::text FROM project_memberships WHERE project_id = p.id) AS member_count
       FROM projects p
       JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $1
       ORDER BY p.created_at ASC`,
      [ctx.userId],
    );

    return result.rows.map((row) => {
      if (!isMembershipRole(row.role)) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unknown membership role" });
      }
      return {
        ...toProject(row),
        role: row.role,
        memberCount: Number(row.member_count),
      };
    });
  }),

  createProject: protectedProcedure
    .input(createProjectInput)
    .mutation(async ({ ctx, input }): Promise<CreateProjectResult> => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        let projectRow: ProjectRow;
        try {
          const inserted = await client.query<ProjectRow>(
            `INSERT INTO projects (name, key, description, template, owner_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, name, key, description, template, next_ticket_number, owner_id, created_at`,
            [input.name, input.key, input.description ?? null, input.template, ctx.userId],
          );
          const row = inserted.rows[0];
          if (!row) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to create project",
            });
          }
          projectRow = row;
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "A project with this key already exists",
            });
          }
          throw err;
        }

        await client.query(
          `INSERT INTO project_memberships (project_id, user_id, role) VALUES ($1, $2, 'owner')`,
          [projectRow.id, ctx.userId],
        );

        const statuses = await insertDefaultStatuses(client, projectRow.id, input.template);

        await client.query("COMMIT");

        return { project: toProject(projectRow), statuses };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }),

  inviteMember: protectedProcedure
    .input(inviteMemberInput)
    .mutation(async ({ ctx, input }): Promise<InviteMemberResult> => {
      const membershipResult = await pool.query<{ role: string }>(
        "SELECT role FROM project_memberships WHERE project_id = $1 AND user_id = $2",
        [input.projectId, ctx.userId],
      );
      const requesterRole = membershipResult.rows[0]?.role;
      if (!requesterRole || (requesterRole !== "owner" && requesterRole !== "editor")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to invite members to this project",
        });
      }

      const userResult = await pool.query<{ id: string }>(
        "SELECT id FROM users WHERE email = $1",
        [input.email],
      );
      const invitedUser = userResult.rows[0];
      if (!invitedUser) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No user found with that email" });
      }

      try {
        const inserted = await pool.query<MembershipRow>(
          `INSERT INTO project_memberships (project_id, user_id, role)
           VALUES ($1, $2, $3)
           RETURNING id, project_id, user_id, role`,
          [input.projectId, invitedUser.id, input.role],
        );
        const membership = inserted.rows[0];
        if (!membership) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to invite member",
          });
        }
        return { membership: toMembership(membership) };
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This user is already a member of the project",
          });
        }
        throw err;
      }
    }),
});
