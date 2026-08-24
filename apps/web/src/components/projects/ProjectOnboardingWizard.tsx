import { useState, type SubmitEvent } from "react";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc";
import { useProjectWorkspace } from "@/lib/project-context";
import { createProjectInput } from "@specforge/backend/validation";

type ProjectTemplate = "kanban" | "scrum";
type WizardStep = "details" | "template";

const TEMPLATES: Array<{ value: ProjectTemplate; label: string; description: string }> = [
  { value: "kanban", label: "Standard Kanban", description: "To Do, In Progress, Done" },
  {
    value: "scrum",
    label: "Agile/Scrum",
    description: "Backlog, To Do, In Progress, In Review, Done",
  },
];

export interface ProjectOnboardingWizardProps {
  /** Omit for the mandatory first-run flow (zero projects), which has
   *  nothing to cancel back to. Provided when opened from "New workspace". */
  readonly onCancel?: () => void;
  readonly onCreated: (message: string) => void;
}

export function ProjectOnboardingWizard({ onCancel, onCreated }: ProjectOnboardingWizardProps) {
  const utils = trpc.useUtils();
  const { setCurrentProjectId } = useProjectWorkspace();
  const [step, setStep] = useState<WizardStep>("details");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState<ProjectTemplate>("kanban");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const createProjectMutation = trpc.project.createProject.useMutation({
    onSuccess: (result) => {
      // App derives "does this user have any projects yet" from this same
      // cached query — without invalidating it here, App would still see
      // an empty list and never dismiss this wizard after creating the
      // first project.
      utils.project.listUserProjects.setData(undefined, (old) => [
        ...(old ?? []),
        { ...result.project, role: "owner" as const, memberCount: 1 },
      ]);
      void utils.project.listUserProjects.invalidate();
      setCurrentProjectId(result.project.id);
      onCreated(`Project ${result.project.key} created`);
    },
    onError: (error) => setErrorMessage(error.message),
  });

  function handleDetailsSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    setErrorMessage(null);
    if (!name.trim() || !key.trim()) {
      setErrorMessage("Enter a project name and key to continue");
      return;
    }
    setStep("template");
  }

  function handleBack(): void {
    setErrorMessage(null);
    setStep("details");
  }

  function handleCreate(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    setErrorMessage(null);

    const result = createProjectInput.safeParse({
      name,
      key,
      description: description.trim() ? description : undefined,
      template,
    });
    if (!result.success) {
      setErrorMessage(result.error.issues[0]?.message ?? "Please check your details and try again.");
      return;
    }
    createProjectMutation.mutate(result.data);
  }

  const previewKey = key.trim() ? key.trim().toUpperCase() : "KEY";

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background px-md">
      <div className="w-[420px] flex flex-col gap-lg">
        <div className="flex flex-col items-center gap-sm text-center">
          <div className="size-10 rounded-md flex items-center justify-center text-base font-bold bg-primary text-text-inverse">
            S
          </div>
          <span className="text-lg font-semibold text-text-inverse">Welcome to SpecForge AI</span>
          <p className="text-sm text-text-secondary">
            {step === "details"
              ? "Let's set up your first workspace."
              : "Choose how you'd like to organize the work."}
          </p>
        </div>

        {step === "details" ? (
          <form
            onSubmit={handleDetailsSubmit}
            className="flex flex-col gap-md rounded-2lg border border-modal-border bg-modal-bg p-lg"
            noValidate
          >
            <div className="flex flex-col gap-xs">
              <label htmlFor="onboarding-name" className="text-xs font-medium text-text-secondary">
                Project name
              </label>
              <Input
                id="onboarding-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                hasError={Boolean(errorMessage)}
                required
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-xs">
              <label htmlFor="onboarding-key" className="text-xs font-medium text-text-secondary">
                Project key
              </label>
              <Input
                id="onboarding-key"
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

            {errorMessage && <p className="text-xs text-error">{errorMessage}</p>}

            <div className="flex justify-end gap-sm mt-sm">
              {onCancel && (
                <Button type="button" variant="ghost" onClick={onCancel}>
                  Cancel
                </Button>
              )}
              <Button type="submit" className="bg-gradient-to-r from-primary to-secondary">
                Continue
                <ArrowRightIcon size={14} />
              </Button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={handleCreate}
            className="flex flex-col gap-md rounded-2lg border border-modal-border bg-modal-bg p-lg"
            noValidate
          >
            <div className="flex flex-col gap-xs">
              <label
                htmlFor="onboarding-description"
                className="text-xs font-medium text-text-secondary"
              >
                Description <span className="text-text-disabled">(optional)</span>
              </label>
              <Input
                id="onboarding-description"
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
                      name="onboarding-template"
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

            <div className="flex justify-between gap-sm mt-sm">
              <Button type="button" variant="ghost" onClick={handleBack}>
                <ArrowLeftIcon size={14} />
                Back
              </Button>
              <Button
                type="submit"
                disabled={createProjectMutation.isPending}
                className="bg-gradient-to-r from-primary to-secondary"
              >
                {createProjectMutation.isPending ? "Creating..." : "Create workspace"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
