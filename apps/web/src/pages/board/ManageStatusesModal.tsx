import { useState, type FormEvent } from "react";
import { GripVerticalIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc";
import type { RouterOutputs } from "@/trpc";

type ProjectStatus = RouterOutputs["status"]["getProjectStatuses"][number];

export function ManageStatusesModal({
  open,
  projectId,
  onClose,
  onFeedback,
}: {
  open: boolean;
  projectId: string | null;
  onClose: () => void;
  onFeedback: (message: string) => void;
}) {
  const utils = trpc.useUtils();
  const [newStatusName, setNewStatusName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const statusesQuery = trpc.status.getProjectStatuses.useQuery(
    { projectId: projectId ?? "" },
    { enabled: open && Boolean(projectId) },
  );

  const reorderMutation = trpc.status.reorderStatuses.useMutation({
    onMutate: async (input) => {
      if (!projectId) return undefined;
      await utils.status.getProjectStatuses.cancel({ projectId });
      const previous = utils.status.getProjectStatuses.getData({ projectId });
      const reordered = input.orderedStatusIds
        .map((id) => previous?.find((status) => status.id === id))
        .filter((status): status is ProjectStatus => Boolean(status))
        .map((status, index) => ({ ...status, position: index }));
      utils.status.getProjectStatuses.setData({ projectId }, reordered);
      return { previous };
    },
    onError: (error, _input, context) => {
      if (projectId && context?.previous) {
        utils.status.getProjectStatuses.setData({ projectId }, context.previous);
      }
      setErrorMessage(error.message);
    },
    onSettled: () => {
      if (projectId) void utils.status.getProjectStatuses.invalidate({ projectId });
    },
  });

  const createStatusMutation = trpc.status.createStatus.useMutation({
    onSuccess: (result) => {
      if (projectId) {
        utils.status.getProjectStatuses.setData({ projectId }, (old) => [
          ...(old ?? []),
          result.status,
        ]);
      }
      setNewStatusName("");
      setErrorMessage(null);
      onFeedback(`Status "${result.status.name}" added`);
    },
    onError: (error) => setErrorMessage(error.message),
    onSettled: () => {
      if (projectId) void utils.status.getProjectStatuses.invalidate({ projectId });
    },
  });

  const deleteStatusMutation = trpc.status.deleteStatus.useMutation({
    onMutate: async (input) => {
      if (!projectId) return undefined;
      await utils.status.getProjectStatuses.cancel({ projectId });
      const previous = utils.status.getProjectStatuses.getData({ projectId });
      utils.status.getProjectStatuses.setData({ projectId }, (old) =>
        (old ?? []).filter((status) => status.id !== input.statusId),
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      if (projectId && context?.previous) {
        utils.status.getProjectStatuses.setData({ projectId }, context.previous);
      }
      setErrorMessage(error.message);
    },
    onSuccess: () => onFeedback("Status deleted"),
    onSettled: () => {
      if (projectId) void utils.status.getProjectStatuses.invalidate({ projectId });
    },
  });

  const statuses = statusesQuery.data ?? [];

  function handleDrop(targetId: string) {
    if (!draggedId || !projectId || draggedId === targetId) {
      setDraggedId(null);
      return;
    }
    const currentIds = statuses.map((status) => status.id);
    const fromIndex = currentIds.indexOf(draggedId);
    const toIndex = currentIds.indexOf(targetId);
    setDraggedId(null);
    if (fromIndex === -1 || toIndex === -1) return;

    const reordered = [...currentIds];
    reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, draggedId);
    reorderMutation.mutate({ projectId, orderedStatusIds: reordered });
  }

  function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId) return;
    setErrorMessage(null);
    const trimmed = newStatusName.trim();
    if (!trimmed) {
      setErrorMessage("Status name is required");
      return;
    }
    createStatusMutation.mutate({ projectId, name: trimmed });
  }

  function handleClose() {
    setNewStatusName("");
    setErrorMessage(null);
    onClose();
  }

  if (!open || !projectId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[480px] rounded-2lg border border-modal-border bg-modal-bg p-lg">
        <h2 className="text-lg font-semibold text-text-inverse mb-md">Manage statuses</h2>

        <ul className="flex flex-col gap-xs mb-md">
          {statuses.map((status) => (
            <li
              key={status.id}
              draggable
              onDragStart={() => setDraggedId(status.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handleDrop(status.id)}
              className="flex items-center gap-sm px-sm py-sm rounded-md border border-modal-border bg-input-bg cursor-grab"
            >
              <GripVerticalIcon
                size={14}
                className="text-text-secondary shrink-0"
                aria-label={`Drag to reorder ${status.name}`}
              />
              <span
                className="size-2.5 rounded-full shrink-0"
                style={{ backgroundColor: status.color }}
                aria-hidden="true"
              />
              <span className="text-sm text-text-inverse flex-1 truncate">{status.name}</span>
              <span className="text-2xs font-mono text-text-secondary px-1.5 py-px rounded-full bg-sidebar-item">
                0
              </span>
              <button
                type="button"
                onClick={() => deleteStatusMutation.mutate({ projectId, statusId: status.id })}
                aria-label={`Delete ${status.name}`}
                className="text-text-secondary hover:text-error transition-colors cursor-pointer"
              >
                <Trash2Icon size={14} />
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={handleCreateSubmit} className="flex flex-col gap-sm">
          <div className="flex gap-sm">
            <Input
              value={newStatusName}
              onChange={(event) => setNewStatusName(event.target.value)}
              placeholder="New status name"
              aria-label="New status name"
              hasError={Boolean(errorMessage)}
            />
            <Button type="submit" disabled={createStatusMutation.isPending}>
              <PlusIcon size={14} />
              Add custom status
            </Button>
          </div>
          {errorMessage && <p className="text-xs text-error">{errorMessage}</p>}
        </form>

        <div className="flex justify-end mt-md">
          <Button type="button" variant="ghost" onClick={handleClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
