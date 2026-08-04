import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc";
import type { RouterOutputs } from "@/trpc";

type TicketType = "story" | "bug" | "task";
type TicketPriority = "P0" | "P1" | "P2" | "P3";
type TicketSummary = RouterOutputs["ticket"]["getProjectTickets"][number];

const TYPE_OPTIONS: Array<{ value: TicketType; label: string }> = [
  { value: "story", label: "Story" },
  { value: "bug", label: "Bug" },
  { value: "task", label: "Task" },
];

const PRIORITY_OPTIONS: TicketPriority[] = ["P0", "P1", "P2", "P3"];

function isTicketType(value: string): value is TicketType {
  return value === "story" || value === "bug" || value === "task";
}

function isTicketPriority(value: string): value is TicketPriority {
  return value === "P0" || value === "P1" || value === "P2" || value === "P3";
}

export function CreateTicketModal({
  open,
  projectId,
  statusId,
  onClose,
  onCreated,
}: {
  open: boolean;
  projectId: string;
  statusId: string | null;
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<TicketType>("story");
  const [priority, setPriority] = useState<TicketPriority>("P2");
  const [storyPoints, setStoryPoints] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const createTicketMutation = trpc.ticket.createTicket.useMutation({
    onMutate: async (input) => {
      await utils.ticket.getProjectTickets.cancel({ projectId });
      const previous = utils.ticket.getProjectTickets.getData({ projectId });
      const optimisticId = `optimistic-${Date.now()}`;
      const optimisticTicket: TicketSummary = {
        id: optimisticId,
        projectId: input.projectId,
        statusId: input.statusId,
        key: "…",
        title: input.title,
        description: input.description ?? null,
        type: input.type,
        priority: input.priority,
        storyPoints: input.storyPoints ?? null,
        assigneeId: null,
        acceptanceCriteria: [],
        aiDevPrompt: null,
        dependencies: [],
        createdAt: new Date().toISOString(),
        assignee: null,
      };
      utils.ticket.getProjectTickets.setData({ projectId }, (old) => [
        ...(old ?? []),
        optimisticTicket,
      ]);
      return { previous, optimisticId };
    },
    onError: (error, _input, context) => {
      if (context) {
        utils.ticket.getProjectTickets.setData({ projectId }, context.previous);
      }
      triggerError(error.message);
    },
    onSuccess: (result, _input, context) => {
      utils.ticket.getProjectTickets.setData({ projectId }, (old) =>
        (old ?? []).map((ticket) =>
          context && ticket.id === context.optimisticId
            ? { ...result.ticket, assignee: null }
            : ticket,
        ),
      );
      onCreated(`Ticket ${result.ticket.key} created`);
      resetForm();
      onClose();
    },
    onSettled: () => {
      void utils.ticket.getProjectTickets.invalidate({ projectId });
    },
  });

  function triggerError(message: string) {
    setErrorMessage(message);
  }

  function resetForm() {
    setTitle("");
    setDescription("");
    setType("story");
    setPriority("P2");
    setStoryPoints("");
    setErrorMessage(null);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function handleTypeChange(value: string) {
    if (isTicketType(value)) setType(value);
  }

  function handlePriorityChange(value: string) {
    if (isTicketPriority(value)) setPriority(value);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!statusId) return;
    setErrorMessage(null);

    const trimmedPoints = storyPoints.trim();
    const parsedPoints = trimmedPoints ? Number(trimmedPoints) : undefined;
    if (trimmedPoints && (!Number.isInteger(parsedPoints) || (parsedPoints ?? -1) < 0)) {
      setErrorMessage("Story points must be a whole number of 0 or more");
      return;
    }

    createTicketMutation.mutate({
      projectId,
      statusId,
      title,
      description: description.trim() ? description : undefined,
      type,
      priority,
      storyPoints: parsedPoints,
    });
  }

  if (!open || !statusId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[460px] rounded-2lg border border-modal-border bg-modal-bg p-lg">
        <h2 className="text-lg font-semibold text-text-inverse mb-md">New ticket</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-md" noValidate>
          <div className="flex flex-col gap-xs">
            <label htmlFor="ticket-title" className="text-xs font-medium text-text-secondary">
              Title
            </label>
            <Input
              id="ticket-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              hasError={Boolean(errorMessage)}
              required
            />
          </div>

          <div className="flex gap-sm">
            <div className="flex flex-1 flex-col gap-xs">
              <label htmlFor="ticket-type" className="text-xs font-medium text-text-secondary">
                Type
              </label>
              <select
                id="ticket-type"
                value={type}
                onChange={(event) => handleTypeChange(event.target.value)}
                className="h-9 w-full rounded-md border border-modal-border bg-input-bg px-sm text-sm text-text-inverse focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-1 flex-col gap-xs">
              <label htmlFor="ticket-priority" className="text-xs font-medium text-text-secondary">
                Priority
              </label>
              <select
                id="ticket-priority"
                value={priority}
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

            <div className="flex w-24 flex-col gap-xs">
              <label htmlFor="ticket-points" className="text-xs font-medium text-text-secondary">
                Points
              </label>
              <Input
                id="ticket-points"
                type="number"
                min={0}
                value={storyPoints}
                onChange={(event) => setStoryPoints(event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-xs">
            <label
              htmlFor="ticket-description"
              className="text-xs font-medium text-text-secondary"
            >
              Description <span className="text-text-disabled">(optional)</span>
            </label>
            <Input
              id="ticket-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          {errorMessage && <p className="text-xs text-error">{errorMessage}</p>}

          <div className="flex justify-end gap-sm mt-sm">
            <Button type="button" variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createTicketMutation.isPending}
              className="bg-gradient-to-r from-primary to-secondary"
            >
              {createTicketMutation.isPending ? "Creating..." : "Create ticket"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
