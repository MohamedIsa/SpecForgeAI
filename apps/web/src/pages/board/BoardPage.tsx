import { useState } from "react";
import { PlusIcon, MoreHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SuccessToast, ErrorToast } from "@/components/ui/toast";
import { trpc } from "@/trpc";
import { useProjectWorkspace } from "@/lib/project-context";
import { TicketCard, type TicketCardData } from "./TicketCard";
import { ManageStatusesModal } from "./ManageStatusesModal";

// No tickets/epics data model exists yet (a future ticket); the board
// genuinely has zero tickets right now rather than showing fabricated data.
const EMPTY_TICKETS: TicketCardData[] = [];

export function BoardPage() {
  const { currentProjectId } = useProjectWorkspace();
  const [isManageStatusesOpen, setIsManageStatusesOpen] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const projectsQuery = trpc.project.listUserProjects.useQuery();
  const statusesQuery = trpc.status.getProjectStatuses.useQuery(
    { projectId: currentProjectId ?? "" },
    { enabled: Boolean(currentProjectId) },
  );

  const currentProject = projectsQuery.data?.find((project) => project.id === currentProjectId);
  const statuses = statusesQuery.data ?? [];

  function showNotAvailable(feature: string) {
    setNotice(`${feature} is not available yet.`);
  }

  if (!currentProjectId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-sm">
        <p className="text-text-secondary">Select or create a project to view its board.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-lg h-14 shrink-0 border-b border-column-border">
        <div className="flex items-center gap-sm min-w-0">
          <h1 className="text-sm font-semibold text-text-inverse truncate">
            {currentProject?.name ?? "Board"}
          </h1>
          <span className="text-2xs text-text-secondary shrink-0">0 tickets · 0 epics</span>
        </div>
        <div className="flex items-center gap-sm shrink-0">
          <Button variant="outline" onClick={() => setIsManageStatusesOpen(true)}>
            Manage statuses
          </Button>
          <Button onClick={() => showNotAvailable("Creating tickets")}>
            <PlusIcon size={14} />
            New ticket
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full gap-md p-lg">
          {statuses.map((status) => (
            <div
              key={status.id}
              className="w-[280px] shrink-0 flex flex-col rounded-md border border-column-border bg-modal-bg"
            >
              <div className="flex items-center gap-sm px-sm py-sm border-b border-column-border shrink-0">
                <span
                  className="size-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: status.color }}
                  aria-hidden="true"
                />
                <span className="text-sm font-medium text-text-inverse truncate flex-1">
                  {status.name}
                </span>
                <span className="text-2xs font-mono text-text-secondary px-1.5 py-px rounded-full bg-sidebar-item">
                  0
                </span>
                <button
                  type="button"
                  onClick={() => showNotAvailable("Column menu")}
                  aria-label={`${status.name} column menu`}
                  className="text-text-secondary hover:text-text-inverse transition-colors cursor-pointer"
                >
                  <MoreHorizontalIcon size={14} />
                </button>
              </div>

              <div className="flex-1 flex flex-col gap-sm p-sm overflow-y-auto">
                {EMPTY_TICKETS.map((ticket) => (
                  <TicketCard key={ticket.id} ticket={ticket} />
                ))}
              </div>

              <div className="p-sm shrink-0">
                <button
                  type="button"
                  onClick={() => showNotAvailable("Adding cards")}
                  className="w-full py-sm rounded-md text-xs text-text-secondary hover:text-text-inverse hover:bg-sidebar-item transition-colors cursor-pointer"
                >
                  + Add card
                </button>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setIsManageStatusesOpen(true)}
            className="w-[280px] shrink-0 h-14 self-start rounded-md border border-dashed border-column-border text-sm text-text-secondary hover:text-text-inverse hover:border-sidebar-item-border transition-colors cursor-pointer"
          >
            + Add status column
          </button>
        </div>
      </div>

      <ManageStatusesModal
        open={isManageStatusesOpen}
        projectId={currentProjectId}
        onClose={() => setIsManageStatusesOpen(false)}
        onFeedback={(message) => setFeedbackMessage(message)}
      />

      {feedbackMessage && (
        <SuccessToast message={feedbackMessage} onDismiss={() => setFeedbackMessage(null)} />
      )}
      {notice && <ErrorToast message={notice} onDismiss={() => setNotice(null)} />}
    </div>
  );
}
