import { pool } from "../db/pool";
import { isMembershipRole, type MembershipRole } from "../routers/project";

/**
 * Returns the caller's role in a project, or null when they are not a member.
 *
 * Kept free of transport concerns so both tRPC procedures (which map it to a
 * TRPCError) and the raw Fastify upload route (which maps it to an HTTP
 * status) can share exactly one membership lookup.
 */
export async function getMembershipRole(
  projectId: string,
  userId: string,
): Promise<MembershipRole | null> {
  const result = await pool.query<{ role: string }>(
    "SELECT role FROM project_memberships WHERE project_id = $1 AND user_id = $2",
    [projectId, userId],
  );
  const role = result.rows[0]?.role;
  if (!role || !isMembershipRole(role)) return null;
  return role;
}

export function canEditProject(role: MembershipRole): boolean {
  return role === "owner" || role === "editor";
}
