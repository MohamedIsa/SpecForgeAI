import { BookmarkIcon, BugIcon, SquareCheckIcon, type LucideIcon } from "lucide-react";

export type TicketType = "story" | "bug" | "task";
export type TicketPriority = "P0" | "P1" | "P2" | "P3";

export interface TicketCardAssignee {
  initials: string;
  fullName: string;
}

export interface TicketCardData {
  id: string;
  key: string;
  type: TicketType;
  title: string;
  priority: TicketPriority;
  storyPoints: number | null;
  assignee: TicketCardAssignee | null;
}

const TYPE_ICONS: Record<TicketType, LucideIcon> = {
  story: BookmarkIcon,
  bug: BugIcon,
  task: SquareCheckIcon,
};

const TYPE_LABELS: Record<TicketType, string> = {
  story: "Story",
  bug: "Bug",
  task: "Task",
};

const PRIORITY_STYLES: Record<TicketPriority, string> = {
  P0: "bg-priority-p0-bg text-error",
  P1: "bg-priority-p1-bg text-warning",
  P2: "bg-priority-p2-bg text-primary",
  P3: "bg-priority-p3-bg text-text-secondary",
};

export function TicketCard({ ticket }: { readonly ticket: TicketCardData }) {
  const TypeIcon = TYPE_ICONS[ticket.type];

  return (
    <div className="flex flex-col gap-sm rounded-md border border-column-border bg-input-bg p-sm">
      <div className="flex items-center gap-xs text-2xs font-mono text-text-secondary">
        <TypeIcon size={12} aria-label={TYPE_LABELS[ticket.type]} />
        <span>{ticket.key}</span>
      </div>

      <p className="text-sm text-text-inverse leading-tight">{ticket.title}</p>

      <div className="flex items-center gap-xs">
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

        {ticket.assignee && (
          <div
            className="ml-auto size-6 shrink-0 rounded-full flex items-center justify-center text-3xs font-medium text-text-inverse bg-primary"
            title={ticket.assignee.fullName}
          >
            {ticket.assignee.initials}
          </div>
        )}
      </div>
    </div>
  );
}
