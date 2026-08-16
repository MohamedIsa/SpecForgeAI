import { trpc } from "@/trpc";
import type { SidebarView } from "@/components/layout/Sidebar";

export interface LifecycleGating {
  /** Whether each sidebar stage is reachable for the current project. */
  unlocked: Record<SidebarView, boolean>;
  hasCleanBrdFile: boolean;
  clarificationCompleted: boolean;
  hasTickets: boolean;
  isLoading: boolean;
}

/**
 * Computes which sidebar stages are unlocked for a project, 
 * ingest is always reachable; clarify requires at
 * least one clean BRD upload; backlog requires a completed clarification
 * session; board requires at least one ticket (published backlog tickets
 * are ordinary tickets, so this single check covers both).
 */
export function useLifecycleGating(projectId: string | null): LifecycleGating {
  const enabled = Boolean(projectId);

  const brdFilesQuery = trpc.brd.listFiles.useQuery(
    { projectId: projectId ?? "" },
    { enabled },
  );
  const clarificationQuery = trpc.clarification.getSessionState.useQuery(
    { projectId: projectId ?? "" },
    { enabled },
  );
  const ticketsQuery = trpc.ticket.getProjectTickets.useQuery(
    { projectId: projectId ?? "" },
    { enabled },
  );

  const hasCleanBrdFile = (brdFilesQuery.data ?? []).length > 0;
  const clarificationCompleted = clarificationQuery.data?.status === "completed";
  const hasTickets = (ticketsQuery.data ?? []).length > 0;

  return {
    unlocked: {
      dashboard: true,
      ingest: true,
      clarify: hasCleanBrdFile,
      backlog: clarificationCompleted,
      board: hasTickets,
    },
    hasCleanBrdFile,
    clarificationCompleted,
    hasTickets,
    isLoading: brdFilesQuery.isLoading || clarificationQuery.isLoading || ticketsQuery.isLoading,
  };
}
