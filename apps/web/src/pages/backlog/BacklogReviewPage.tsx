import { useEffect, useRef, useState } from "react";
import { ArrowUpRightIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorToast } from "@/components/ui/toast";
import { trpc } from "@/trpc";
import { useProjectWorkspace } from "@/lib/project-context";
import { GenerationProgressCard, GENERATION_STEPS } from "./GenerationProgressCard";
import { EpicAccordionCard } from "./EpicAccordionCard";

const STEP_INTERVAL_MS = 900;

export interface BacklogReviewPageProps {
  /** True only when this page was reached via the Clarify CTA — a direct
   *  sidebar visit must not spend an AI call the user didn't ask for. */
  autoStart?: boolean;
  /** Called once autoStart has been acted on, so the parent's one-shot
   *  signal doesn't re-fire generation on a later remount of this page. */
  onAutoStartConsumed?: () => void;
  /** Receives the confirmation message — the caller must render it,
   *  since publishing navigates away and unmounts this page immediately. */
  onPublished?: (message: string) => void;
}

export function BacklogReviewPage({
  autoStart = false,
  onAutoStartConsumed,
  onPublished,
}: BacklogReviewPageProps) {
  const { currentProjectId } = useProjectWorkspace();
  const projectsQuery = trpc.project.listUserProjects.useQuery();
  const currentProject = projectsQuery.data?.find((project) => project.id === currentProjectId);

  const [stepIndex, setStepIndex] = useState(0);
  const [syncedPending, setSyncedPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasStartedGeneration = useRef(false);

  const generateBacklog = trpc.backlog.generateBacklog.useMutation({
    onError: (error) => setErrorMessage(error.message),
  });

  // Adjusting state during render (rather than a useEffect body) so the step
  // counter resets the instant a new generation starts, without an extra
  // render pass — same pattern as syncedTicketId in TicketDetailModal.
  if (generateBacklog.isPending !== syncedPending) {
    setSyncedPending(generateBacklog.isPending);
    if (generateBacklog.isPending) setStepIndex(0);
  }

  const publishBacklog = trpc.backlog.publishBacklogToBoard.useMutation({
    onSuccess: (result) => {
      onPublished?.(
        `Published ${result.ticketCount} tickets across ${result.epicCount} epics to the board.`,
      );
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const generateBacklogMutate = generateBacklog.mutate;
  useEffect(() => {
    if (autoStart && currentProjectId && !hasStartedGeneration.current) {
      hasStartedGeneration.current = true;
      onAutoStartConsumed?.();
      generateBacklogMutate({ projectId: currentProjectId });
    }
  }, [autoStart, currentProjectId, generateBacklogMutate, onAutoStartConsumed]);

  const isGenerating = generateBacklog.isPending;
  useEffect(() => {
    if (!isGenerating) return;
    const interval = setInterval(() => {
      setStepIndex((previous) => Math.min(previous + 1, GENERATION_STEPS.length - 1));
    }, STEP_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isGenerating]);

  function handleGenerate(): void {
    if (!currentProjectId) return;
    hasStartedGeneration.current = true;
    setErrorMessage(null);
    generateBacklog.mutate({ projectId: currentProjectId });
  }

  function handlePublish(): void {
    if (!currentProjectId || !generateBacklog.data) return;
    publishBacklog.mutate({ projectId: currentProjectId, epics: generateBacklog.data.epics });
  }

  if (!currentProjectId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-sm">
        <p className="text-text-secondary">Select or create a project to review its backlog.</p>
      </div>
    );
  }

  const draft = generateBacklog.data;
  const canPublish = Boolean(draft) && !publishBacklog.isSuccess;
  const hasRequestedGeneration = isGenerating || Boolean(draft) || generateBacklog.isError;

  return (
    <div className="flex flex-col w-full h-full min-w-0 overflow-y-auto">
      <div className="flex items-center justify-between px-lg h-14 shrink-0 border-b border-column-border w-full">
        <div className="flex items-center gap-sm min-w-0" data-testid="backlog-breadcrumb">
          <h1 className="text-sm font-semibold text-text-inverse truncate">
            {currentProject?.name ?? "Project"} / Backlog
          </h1>
        </div>
        <Button disabled={!canPublish || publishBacklog.isPending} onClick={handlePublish}>
          {publishBacklog.isPending ? "Publishing..." : "Publish to Kanban Board"}
          <ArrowUpRightIcon size={14} />
        </Button>
      </div>

      <div className="flex flex-col gap-lg p-lg max-w-4xl w-full mx-auto min-w-0">
        <div>
          <h2 className="text-lg font-semibold text-text-inverse">Generated Backlog</h2>
          {draft && (
            <p data-testid="backlog-summary" className="text-sm text-text-secondary">
              {draft.summary.ticketCount} tickets · {draft.summary.epicCount} epics ·{" "}
              {draft.summary.totalStoryPoints} story points estimated
            </p>
          )}
        </div>

        {!hasRequestedGeneration && (
          <div className="flex flex-col items-start gap-sm rounded-2lg border border-modal-border bg-modal-bg p-lg">
            <p className="text-sm text-text-secondary">
              Generate a backlog of epics and tickets from this project's BRD and clarification
              context.
            </p>
            <Button onClick={handleGenerate}>
              <SparklesIcon size={14} />
              Generate Backlog
            </Button>
          </div>
        )}

        {isGenerating && <GenerationProgressCard activeStepIndex={stepIndex} />}

        {!isGenerating && generateBacklog.isError && (
          <div className="flex flex-col items-start gap-sm rounded-2lg border border-error-border bg-modal-bg p-lg">
            <p className="text-sm text-text-inverse">
              Backlog generation failed. Nothing has been published.
            </p>
            <Button variant="outline" onClick={handleGenerate}>
              Try again
            </Button>
          </div>
        )}

        {!isGenerating && draft && (
          <div className="flex flex-col gap-md" data-testid="epic-list">
            {draft.epics.map((epic, index) => (
              <EpicAccordionCard
                key={epic.tickets[0]?.ref ?? epic.title}
                epic={epic}
                defaultOpen={index === 0}
              />
            ))}
          </div>
        )}
      </div>

      {errorMessage && <ErrorToast message={errorMessage} onDismiss={() => setErrorMessage(null)} />}
    </div>
  );
}
