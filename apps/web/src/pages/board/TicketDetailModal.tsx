import { useState } from "react";
import { XIcon, CopyIcon, BookmarkIcon, BugIcon, SquareCheckIcon, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SuccessToast, ErrorToast } from "@/components/ui/toast";
import { trpc } from "@/trpc";
import type { RouterOutputs } from "@/trpc";
import { getInitials } from "@/lib/initials";

type TicketDetails = RouterOutputs["ticket"]["getTicketDetails"];
type TicketPriority = TicketDetails["priority"];
type TicketType = TicketDetails["type"];

interface LocalCriterion {
  given: string;
  when: string;
  then: string;
  checked: boolean;
}

const TYPE_ICONS: Record<TicketType, LucideIcon> = {
  story: BookmarkIcon,
  bug: BugIcon,
  task: SquareCheckIcon,
};

const PRIORITY_STYLES: Record<TicketPriority, string> = {
  P0: "bg-priority-p0-bg text-error",
  P1: "bg-priority-p1-bg text-warning",
  P2: "bg-priority-p2-bg text-primary",
  P3: "bg-priority-p3-bg text-text-secondary",
};

const PRIORITY_OPTIONS: TicketPriority[] = ["P0", "P1", "P2", "P3"];

function isTicketPriority(value: string): value is TicketPriority {
  return value === "P0" || value === "P1" || value === "P2" || value === "P3";
}

export function TicketDetailModal({
  projectId,
  ticketId,
  onClose,
}: {
  projectId: string;
  ticketId: string | null;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState<LocalCriterion[]>([]);
  const [syncedTicketId, setSyncedTicketId] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const detailsQuery = trpc.ticket.getTicketDetails.useQuery(
    { projectId, ticketId: ticketId ?? "" },
    { enabled: Boolean(ticketId) },
  );
  const statusesQuery = trpc.status.getProjectStatuses.useQuery({ projectId });

  const ticket = detailsQuery.data;

  // Adjusting state during render (React's recommended pattern for syncing
  // local editable fields from newly-arrived async data) rather than in a
  // useEffect, which would cause an extra render pass on every ticket load.
  if (ticket && ticket.id !== syncedTicketId) {
    setSyncedTicketId(ticket.id);
    setTitle(ticket.title);
    setDescription(ticket.description ?? "");
    setCriteria(ticket.acceptanceCriteria);
  }

  const updateTicketMutation = trpc.ticket.updateTicket.useMutation({
    onSuccess: () => {
      if (ticketId) void utils.ticket.getTicketDetails.invalidate({ projectId, ticketId });
      void utils.ticket.getProjectTickets.invalidate({ projectId });
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const updateStatusMutation = trpc.ticket.updateTicketStatus.useMutation({
    onMutate: async (input) => {
      await utils.ticket.getProjectTickets.cancel({ projectId });
      const previousList = utils.ticket.getProjectTickets.getData({ projectId });
      utils.ticket.getProjectTickets.setData({ projectId }, (old) =>
        (old ?? []).map((item) =>
          item.id === input.ticketId ? { ...item, statusId: input.statusId } : item,
        ),
      );

      const previousDetails = ticketId
        ? utils.ticket.getTicketDetails.getData({ projectId, ticketId })
        : undefined;
      if (ticketId) {
        utils.ticket.getTicketDetails.setData({ projectId, ticketId }, (old) =>
          old ? { ...old, statusId: input.statusId } : old,
        );
      }
      return { previousList, previousDetails };
    },
    onError: (error, _input, context) => {
      utils.ticket.getProjectTickets.setData({ projectId }, context?.previousList);
      if (ticketId && context?.previousDetails) {
        utils.ticket.getTicketDetails.setData({ projectId, ticketId }, context.previousDetails);
      }
      setErrorMessage(error.message);
    },
    onSettled: () => {
      void utils.ticket.getProjectTickets.invalidate({ projectId });
      if (ticketId) void utils.ticket.getTicketDetails.invalidate({ projectId, ticketId });
    },
  });

  function handleTitleBlur() {
    if (!ticket || !ticketId) return;
    const trimmed = title.trim();
    if (trimmed && trimmed !== ticket.title) {
      updateTicketMutation.mutate({ projectId, ticketId, title: trimmed });
    }
  }

  function handleDescriptionBlur() {
    if (!ticket || !ticketId) return;
    const trimmed = description.trim();
    const current = ticket.description ?? "";
    if (trimmed !== current) {
      updateTicketMutation.mutate({ projectId, ticketId, description: trimmed || null });
    }
  }

  function handlePriorityChange(value: string) {
    if (!ticketId || !isTicketPriority(value)) return;
    updateTicketMutation.mutate({ projectId, ticketId, priority: value });
  }

  function handleStatusChange(value: string) {
    if (!ticketId) return;
    updateStatusMutation.mutate({ projectId, ticketId, statusId: value });
  }

  function toggleCriterion(index: number) {
    setCriteria((prev) =>
      prev.map((item, itemIndex) =>
        itemIndex === index ? { ...item, checked: !item.checked } : item,
      ),
    );
  }

  async function handleCopyPrompt() {
    if (!ticket?.aiDevPrompt) return;
    try {
      await navigator.clipboard.writeText(ticket.aiDevPrompt);
      setCopyMessage("Prompt copied to clipboard");
    } catch {
      setErrorMessage("Failed to copy prompt to clipboard");
    }
  }

  if (!ticketId || !ticket) return null;

  const TypeIcon = TYPE_ICONS[ticket.type];
  const statuses = statusesQuery.data ?? [];
  const lastStatusId = statuses[statuses.length - 1]?.id;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
      <div className="flex h-full w-[640px] bg-modal-bg border-l border-modal-border">
        <div className="flex-1 flex flex-col overflow-y-auto p-lg gap-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-sm">
              <TypeIcon size={16} aria-label={ticket.type} className="text-text-secondary" />
              <span className="text-sm font-mono text-text-secondary">{ticket.key}</span>
              <span
                className={`px-1.5 py-px rounded-full text-2xs font-semibold ${PRIORITY_STYLES[ticket.priority]}`}
              >
                {ticket.priority}
              </span>
              {ticket.storyPoints !== null && (
                <span className="px-1.5 py-px rounded-full text-2xs font-medium bg-sidebar-item text-text-secondary">
                  {ticket.storyPoints} pts
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close ticket detail"
              className="text-text-secondary hover:text-text-inverse transition-colors cursor-pointer"
            >
              <XIcon size={18} />
            </button>
          </div>

          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={handleTitleBlur}
            aria-label="Ticket title"
            className="text-lg font-semibold text-text-inverse bg-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus rounded-md px-1 -mx-1"
          />

          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={handleDescriptionBlur}
            aria-label="Ticket description"
            placeholder="Add a description…"
            className="text-sm text-text-secondary bg-transparent resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus rounded-md px-1 -mx-1 min-h-20"
          />

          <div className="flex flex-col gap-sm">
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
              Acceptance Criteria
            </h3>
            {criteria.length === 0 ? (
              <p className="text-xs text-text-disabled">No acceptance criteria yet.</p>
            ) : (
              <ul className="flex flex-col gap-xs">
                {criteria.map((criterion, index) => (
                  <li key={index} className="flex items-start gap-sm">
                    <input
                      type="checkbox"
                      checked={criterion.checked}
                      onChange={() => toggleCriterion(index)}
                      aria-label={`Toggle criterion ${index + 1}`}
                      className="mt-0.5 cursor-pointer"
                    />
                    <span
                      className={`text-sm ${
                        criterion.checked
                          ? "text-text-disabled line-through"
                          : "text-text-inverse"
                      }`}
                    >
                      Given {criterion.given}, when {criterion.when}, then {criterion.then}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                AI Dev Prompt
              </h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!ticket.aiDevPrompt}
                onClick={() => void handleCopyPrompt()}
              >
                <CopyIcon size={12} />
                Copy Prompt
              </Button>
            </div>
            <pre className="text-xs font-mono text-text-secondary bg-header-bg rounded-md p-sm overflow-x-auto whitespace-pre-wrap">
              {ticket.aiDevPrompt ?? "No AI dev prompt generated yet."}
            </pre>
          </div>
        </div>

        <div className="w-[220px] shrink-0 border-l border-modal-border p-lg flex flex-col gap-md overflow-y-auto">
          <div className="flex flex-col gap-xs">
            <label
              htmlFor="ticket-detail-status"
              className="text-2xs font-semibold text-text-secondary uppercase tracking-wide"
            >
              Status
            </label>
            <select
              id="ticket-detail-status"
              value={ticket.statusId}
              onChange={(event) => handleStatusChange(event.target.value)}
              className="h-9 w-full rounded-md border border-modal-border bg-input-bg px-sm text-sm text-text-inverse focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
            >
              {statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-xs">
            <label
              htmlFor="ticket-detail-priority"
              className="text-2xs font-semibold text-text-secondary uppercase tracking-wide"
            >
              Priority
            </label>
            <select
              id="ticket-detail-priority"
              value={ticket.priority}
              onChange={(event) => handlePriorityChange(event.target.value)}
              className="h-9 w-full rounded-md border border-modal-border bg-input-bg px-sm text-sm text-text-inverse focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
            >
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-xs">
            <span className="text-2xs font-semibold text-text-secondary uppercase tracking-wide">
              Assignee
            </span>
            {ticket.assignee ? (
              <div className="flex items-center gap-sm">
                <div className="size-6 shrink-0 rounded-full flex items-center justify-center text-3xs font-medium text-text-inverse bg-primary">
                  {getInitials(ticket.assignee.fullName)}
                </div>
                <span className="text-sm text-text-inverse truncate">
                  {ticket.assignee.fullName}
                </span>
              </div>
            ) : (
              <span className="text-sm text-text-disabled">Unassigned</span>
            )}
          </div>

          <div className="flex flex-col gap-xs">
            <span className="text-2xs font-semibold text-text-secondary uppercase tracking-wide">
              Dependencies
            </span>
            {ticket.dependencySummaries.length === 0 ? (
              <span className="text-sm text-text-disabled">None</span>
            ) : (
              <ul className="flex flex-col gap-xs">
                {ticket.dependencySummaries.map((dependency) => (
                  <li key={dependency.id} className="flex items-center gap-sm text-sm">
                    <span
                      className={`size-2 rounded-full shrink-0 ${
                        dependency.statusId === lastStatusId ? "bg-success" : "bg-warning"
                      }`}
                      aria-hidden="true"
                    />
                    <span className="font-mono text-text-secondary">{dependency.key}</span>
                    <span className="text-text-inverse truncate">{dependency.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {copyMessage && (
        <SuccessToast message={copyMessage} onDismiss={() => setCopyMessage(null)} />
      )}
      {errorMessage && (
        <ErrorToast message={errorMessage} onDismiss={() => setErrorMessage(null)} />
      )}
    </div>
  );
}
