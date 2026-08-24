import { CheckIcon } from "lucide-react";

export const GENERATION_STEPS = [
  "Reading BRD documents",
  "Applying clarification context",
  "Drafting epics & tickets",
  "Finalizing acceptance criteria",
] as const;

export function GenerationProgressCard({ activeStepIndex }: { readonly activeStepIndex: number }) {
  const clampedIndex = Math.min(Math.max(activeStepIndex, 0), GENERATION_STEPS.length - 1);
  const progressPercent = Math.round(((clampedIndex + 1) / GENERATION_STEPS.length) * 100);

  return (
    <output
      aria-label="Generating backlog"
      className="flex flex-col gap-md rounded-2lg border border-modal-border bg-modal-bg p-lg"
    >
      <div className="flex items-center gap-sm">
        <span
          data-testid="generation-spinner"
          className="size-8 shrink-0 rounded-full flex items-center justify-center bg-primary-light animate-sf-glow"
        >
          <span
            aria-hidden="true"
            className="size-4 rounded-full border-2 border-primary border-t-transparent animate-sf-spin"
          />
        </span>
        <span data-testid="active-step-label" className="text-sm font-medium text-text-inverse">
          {GENERATION_STEPS[clampedIndex]}
        </span>
      </div>

      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-sidebar-item">
        <progress
          className="sr-only"
          data-testid="generation-progress-bar"
          value={progressPercent}
          max={100}
          aria-label="Backlog generation progress"
        />
        <div
          aria-hidden="true"
          className="h-full rounded-full bg-primary animate-sf-bar-sweep"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <ul className="flex flex-col gap-xs">
        {GENERATION_STEPS.map((step, index) => (
          <li key={step} className="flex items-center gap-sm text-xs" data-testid="generation-step">
            {index < clampedIndex ? (
              <CheckIcon size={12} aria-label="Done" className="text-resolved shrink-0" />
            ) : (
              <span
                aria-hidden="true"
                className={`size-3 rounded-full shrink-0 border ${
                  index === clampedIndex ? "border-primary" : "border-column-border"
                }`}
              />
            )}
            <span className={index <= clampedIndex ? "text-text-inverse" : "text-text-disabled"}>
              {step}
            </span>
          </li>
        ))}
      </ul>
    </output>
  );
}
