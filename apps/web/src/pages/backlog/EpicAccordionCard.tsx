import { useState } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  BookmarkIcon,
  BugIcon,
  SquareCheckIcon,
  type LucideIcon,
} from "lucide-react";
import type { RouterOutputs } from "@/trpc";

export type BacklogEpic = RouterOutputs["backlog"]["generateBacklog"]["epics"][number];
export type BacklogTicket = BacklogEpic["tickets"][number];

const TYPE_ICONS: Record<BacklogTicket["type"], LucideIcon> = {
  story: BookmarkIcon,
  bug: BugIcon,
  task: SquareCheckIcon,
};

const PRIORITY_STYLES: Record<BacklogTicket["priority"], string> = {
  P0: "bg-priority-p0-bg text-error",
  P1: "bg-priority-p1-bg text-warning",
  P2: "bg-priority-p2-bg text-primary",
  P3: "bg-priority-p3-bg text-text-secondary",
};

function BacklogTicketCard({ ticket }: { readonly ticket: BacklogTicket }) {
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const TypeIcon = TYPE_ICONS[ticket.type];

  return (
    <div
      data-testid="backlog-ticket-card"
      className="flex flex-col gap-sm rounded-lg border border-modal-border bg-header-bg p-md"
    >
      <div className="flex items-center gap-sm flex-wrap">
        <TypeIcon size={14} aria-label={ticket.type} className="text-text-secondary shrink-0" />
        <span data-testid="ticket-key" className="text-xs font-mono text-text-secondary">
          {ticket.previewKey}
        </span>
        <span className="px-1.5 py-px rounded-full text-2xs font-medium uppercase bg-sidebar-item text-text-secondary">
          {ticket.type}
        </span>
        <span
          className={`px-1.5 py-px rounded-full text-2xs font-semibold ${PRIORITY_STYLES[ticket.priority]}`}
        >
          {ticket.priority}
        </span>
        <span className="px-1.5 py-px rounded-full text-2xs font-medium bg-sidebar-item text-text-secondary">
          {ticket.storyPoints} pts
        </span>
        {ticket.dependsOnPreviewKeys.map((dependencyKey) => (
          <span
            key={dependencyKey}
            data-testid="dependency-pill"
            className="px-1.5 py-px rounded-full text-2xs font-medium bg-callout-bg text-callout-border"
          >
            Depends on {dependencyKey}
          </span>
        ))}
      </div>

      <p className="text-sm font-medium text-text-inverse">{ticket.title}</p>

      <ul className="flex flex-col gap-xs" data-testid="acceptance-criteria">
        {ticket.acceptanceCriteria.map((criterion) => (
          <li
            key={`${criterion.given}|${criterion.when}|${criterion.expectedResult}`}
            className="text-xs text-text-secondary"
          >
            <span className="text-chip-text font-semibold">Given</span> {criterion.given},{" "}
            <span className="text-chip-text font-semibold">when</span> {criterion.when},{" "}
            <span className="text-chip-text font-semibold">then</span> {criterion.expectedResult}
          </li>
        ))}
      </ul>

      <div>
        <button
          type="button"
          onClick={() => setIsPromptOpen((open) => !open)}
          aria-expanded={isPromptOpen}
          className="flex items-center gap-xs text-2xs font-semibold text-text-secondary uppercase tracking-wide cursor-pointer"
        >
          {isPromptOpen ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
          AI Dev Prompt
        </button>
        {isPromptOpen && (
          <pre
            data-testid="ai-dev-prompt"
            className="mt-xs text-xs font-mono text-text-secondary bg-header-bg rounded-md p-sm overflow-x-auto whitespace-pre-wrap"
          >
            {ticket.aiDevPrompt}
          </pre>
        )}
      </div>
    </div>
  );
}

export function EpicAccordionCard({
  epic,
  defaultOpen = false,
}: {
  readonly epic: BacklogEpic;
  readonly defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const ticketCount = epic.tickets.length;
  const totalPoints = epic.tickets.reduce((sum, ticket) => sum + ticket.storyPoints, 0);

  return (
    <div
      data-testid="epic-accordion-card"
      className="flex flex-col rounded-2lg border border-modal-border bg-modal-bg overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        aria-expanded={isOpen}
        className="flex items-center justify-between gap-sm px-md py-sm cursor-pointer"
      >
        <div className="flex items-center gap-sm min-w-0">
          {isOpen ? (
            <ChevronDownIcon size={14} className="shrink-0" />
          ) : (
            <ChevronRightIcon size={14} className="shrink-0" />
          )}
          <span className="text-sm font-semibold text-text-inverse truncate">{epic.title}</span>
        </div>
        <span className="text-2xs text-text-secondary shrink-0">
          {ticketCount} {ticketCount === 1 ? "ticket" : "tickets"} · {totalPoints} pts
        </span>
      </button>
      {isOpen && (
        <div className="flex flex-col gap-sm border-t border-modal-border p-md">
          {epic.tickets.map((ticket) => (
            <BacklogTicketCard key={ticket.ref} ticket={ticket} />
          ))}
        </div>
      )}
    </div>
  );
}
