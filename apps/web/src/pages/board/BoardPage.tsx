import { useState } from "react";
import { PlusIcon, MoreHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SuccessToast, ErrorToast } from "@/components/ui/toast";
import { trpc } from "@/trpc";
import type { RouterOutputs } from "@/trpc";
import { useProjectWorkspace } from "@/lib/project-context";
import { getInitials } from "@/lib/initials";
import { TicketCard, type TicketCardData } from "./TicketCard";
import { ManageStatusesModal } from "./ManageStatusesModal";
import { CreateTicketModal } from "./CreateTicketModal";
import { TicketDetailModal } from "./TicketDetailModal";

type TicketWithAssignee = RouterOutputs["ticket"]["getProjectTickets"][number];

function toTicketCardData(ticket: TicketWithAssignee): TicketCardData {
  return {
    id: ticket.id,
    key: ticket.key,
    type: ticket.type,
    title: ticket.title,
    priority: ticket.priority,
    storyPoints: ticket.storyPoints,
    assignee: ticket.assignee
      ? { initials: getInitials(ticket.assignee.fullName), fullName: ticket.assignee.fullName }
      : null,
  };
}

export function BoardPage() {
  const { currentProjectId } = useProjectWorkspace();
  const [isManageStatusesOpen, setIsManageStatusesOpen] = useState(false);
  const [createTicketStatusId, setCreateTicketStatusId] = useState<string | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [draggedTicketId, setDraggedTicketId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const projectsQuery = trpc.project.listUserProjects.useQuery();
  const statusesQuery = trpc.status.getProjectStatuses.useQuery(
    { projectId: currentProjectId ?? "" },
    { enabled: Boolean(currentProjectId) },
  );
  const ticketsQuery = trpc.ticket.getProjectTickets.useQuery(
    { projectId: currentProjectId ?? "" },
    { enabled: Boolean(currentProjectId) },
  );

  const updateTicketStatusMutation = trpc.ticket.updateTicketStatus.useMutation({
    onMutate: async (input) => {
      if (!currentProjectId) return undefined;
      await utils.ticket.getProjectTickets.cancel({ projectId: currentProjectId });
      const previous = utils.ticket.getProjectTickets.getData({ projectId: currentProjectId });
      utils.ticket.getProjectTickets.setData({ projectId: currentProjectId }, (old) =>
        (old ?? []).map((ticket) =>
          ticket.id === input.ticketId ? { ...ticket, statusId: input.statusId } : ticket,
        ),
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      if (currentProjectId && context?.previous) {
        utils.ticket.getProjectTickets.setData(
          { projectId: currentProjectId },
          context.previous,
        );
      }
      setNotice(error.message);
    },
    onSettled: () => {
      if (currentProjectId) void utils.ticket.getProjectTickets.invalidate({ projectId: currentProjectId });
    },
  });

  const currentProject = projectsQuery.data?.find((project) => project.id === currentProjectId);
  const statuses = statusesQuery.data ?? [];
  const tickets = ticketsQuery.data ?? [];

  function showNotAvailable(feature: string) {
    setNotice(`${feature} is not available yet.`);
  }

  function handleDrop(statusId: string) {
    const ticketId = draggedTicketId;
    setDraggedTicketId(null);
    if (!ticketId || !currentProjectId) return;
    const ticket = tickets.find((item) => item.id === ticketId);
    if (!ticket || ticket.statusId === statusId) return;
    updateTicketStatusMutation.mutate({ projectId: currentProjectId, ticketId, statusId });
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
          <span className="text-2xs text-text-secondary shrink-0">
            {tickets.length} tickets · 0 epics
          </span>
        </div>
        <div className="flex items-center gap-sm shrink-0">
          <Button variant="outline" onClick={() => setIsManageStatusesOpen(true)}>
            Manage statuses
          </Button>
          <Button
            onClick={() => {
              const firstStatus = statuses[0];
              if (firstStatus) setCreateTicketStatusId(firstStatus.id);
              else showNotAvailable("Creating tickets");
            }}
          >
            <PlusIcon size={14} />
            New ticket
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full gap-md p-lg">
          {statuses.map((status) => {
            const columnTickets = tickets.filter((ticket) => ticket.statusId === status.id);
            return (
              <div
                key={status.id}
                data-status-id={status.id}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => handleDrop(status.id)}
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
                    {columnTickets.length}
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
                  {columnTickets.map((ticket) => (
                    <div
                      key={ticket.id}
                      draggable
                      onDragStart={() => setDraggedTicketId(ticket.id)}
                      onClick={() => setSelectedTicketId(ticket.id)}
                      className="cursor-grab"
                    >
                      <TicketCard ticket={toTicketCardData(ticket)} />
                    </div>
                  ))}
                </div>

                <div className="p-sm shrink-0">
                  <button
                    type="button"
                    onClick={() => setCreateTicketStatusId(status.id)}
                    className="w-full py-sm rounded-md text-xs text-text-secondary hover:text-text-inverse hover:bg-sidebar-item transition-colors cursor-pointer"
                  >
                    + Add card
                  </button>
                </div>
              </div>
            );
          })}

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

      <CreateTicketModal
        open={createTicketStatusId !== null}
        projectId={currentProjectId}
        statusId={createTicketStatusId}
        onClose={() => setCreateTicketStatusId(null)}
        onCreated={(message) => setFeedbackMessage(message)}
      />

      <TicketDetailModal
        projectId={currentProjectId}
        ticketId={selectedTicketId}
        onClose={() => setSelectedTicketId(null)}
      />

      {feedbackMessage && (
        <SuccessToast message={feedbackMessage} onDismiss={() => setFeedbackMessage(null)} />
      )}
      {notice && <ErrorToast message={notice} onDismiss={() => setNotice(null)} />}
    </div>
  );
}
