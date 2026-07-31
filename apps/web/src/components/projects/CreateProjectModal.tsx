import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc";
import type { RouterOutputs } from "@/trpc";
import { useProjectWorkspace } from "@/lib/project-context";
import { createProjectInput } from "@specforge/backend/validation";

type ProjectSummary = RouterOutputs["project"]["listUserProjects"][number];
type ProjectTemplate = "kanban" | "scrum";

const SHAKE_DURATION_MS = 400;

const TEMPLATES: Array<{ value: ProjectTemplate; label: string; description: string }> = [
  { value: "kanban", label: "Standard Kanban", description: "To Do, In Progress, Done" },
  {
    value: "scrum",
    label: "Agile/Scrum",
    description: "Backlog, To Do, In Progress, In Review, Done",
  },
];

export function CreateProjectModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const utils = trpc.useUtils();
  const { setCurrentProjectId } = useProjectWorkspace();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState<ProjectTemplate>("kanban");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);

  const createProjectMutation = trpc.project.createProject.useMutation({
    onMutate: async (input) => {
      await utils.project.listUserProjects.cancel();
      const previous = utils.project.listUserProjects.getData();
      const optimisticId = `optimistic-${Date.now()}`;
      const optimisticProject: ProjectSummary = {
        id: optimisticId,
        name: input.name,
        key: input.key.toUpperCase(),
        description: input.description ?? null,
        template: input.template,
        nextTicketNumber: 101,
        createdAt: new Date().toISOString(),
        role: "owner",
        memberCount: 1,
      };
      utils.project.listUserProjects.setData(undefined, (old) => [
        ...(old ?? []),
        optimisticProject,
      ]);
      return { previous, optimisticId };
    },
    onError: (error, _input, context) => {
      if (context) {
        utils.project.listUserProjects.setData(undefined, context.previous);
      }
      triggerError(error.message);
    },
    onSuccess: (result, _input, context) => {
      utils.project.listUserProjects.setData(undefined, (old) =>
        (old ?? []).map((project) =>
          context && project.id === context.optimisticId
            ? { ...result.project, role: "owner" as const, memberCount: 1 }
            : project,
        ),
      );
      setCurrentProjectId(result.project.id);
      onCreated(`Project ${result.project.key} created`);
      resetForm();
      onClose();
    },
    onSettled: () => {
      void utils.project.listUserProjects.invalidate();
    },
  });

  function triggerError(message: string) {
    setErrorMessage(message);
    setIsShaking(true);
    window.setTimeout(() => setIsShaking(false), SHAKE_DURATION_MS);
  }

  function resetForm() {
    setName("");
    setKey("");
    setDescription("");
    setTemplate("kanban");
    setErrorMessage(null);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const result = createProjectInput.safeParse({
      name,
      key,
      description: description.trim() ? description : undefined,
      template,
    });
    if (!result.success) {
      triggerError(result.error.issues[0]?.message ?? "Please check your details and try again.");
      return;
    }
    createProjectMutation.mutate(result.data);
  }

  if (!open) return null;

  const previewKey = key.trim() ? key.trim().toUpperCase() : "KEY";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className={`w-[460px] rounded-2lg border border-modal-border bg-modal-bg p-lg ${
          isShaking ? "animate-sf-shake" : ""
        }`}
      >
        <h2 className="text-lg font-semibold text-text-inverse mb-md">New workspace</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-md" noValidate>
          <div className="flex flex-col gap-xs">
            <label htmlFor="project-name" className="text-xs font-medium text-text-secondary">
              Project name
            </label>
            <Input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              hasError={Boolean(errorMessage)}
              required
            />
          </div>

          <div className="flex flex-col gap-xs">
            <label htmlFor="project-key" className="text-xs font-medium text-text-secondary">
              Project key
            </label>
            <Input
              id="project-key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              hasError={Boolean(errorMessage)}
              className="font-mono uppercase"
              required
            />
            <p className="text-2xs text-text-secondary font-mono">
              Tickets will be numbered {previewKey}-101, {previewKey}-102...
            </p>
          </div>

          <div className="flex flex-col gap-xs">
            <label
              htmlFor="project-description"
              className="text-xs font-medium text-text-secondary"
            >
              Description <span className="text-text-disabled">(optional)</span>
            </label>
            <Input
              id="project-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-xs">
            <span className="text-xs font-medium text-text-secondary">Status template</span>
            <div role="radiogroup" aria-label="Status template" className="grid grid-cols-2 gap-sm">
              {TEMPLATES.map((option) => (
                <label
                  key={option.value}
                  className={`flex flex-col gap-1 rounded-md border p-sm cursor-pointer transition-colors ${
                    template === option.value
                      ? "border-primary bg-input-bg"
                      : "border-modal-border bg-input-bg hover:border-sidebar-item-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="template"
                    value={option.value}
                    checked={template === option.value}
                    onChange={() => setTemplate(option.value)}
                    className="sr-only"
                  />
                  <span className="text-sm font-medium text-text-inverse">{option.label}</span>
                  <span className="text-2xs text-text-secondary">{option.description}</span>
                </label>
              ))}
            </div>
          </div>

          {errorMessage && <p className="text-xs text-error">{errorMessage}</p>}

          <div className="flex justify-end gap-sm mt-sm">
            <Button type="button" variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createProjectMutation.isPending}
              className="bg-gradient-to-r from-primary to-secondary"
            >
              {createProjectMutation.isPending ? "Creating..." : "Create project"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
