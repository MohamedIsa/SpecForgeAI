import { CheckIcon, CircleDashedIcon } from "lucide-react";
import type { RouterOutputs } from "@/trpc";

type SessionState = NonNullable<RouterOutputs["clarification"]["getSessionState"]>;

export function ContextSummaryPanel({ session }: { readonly session: SessionState | null }) {
  const questions = session?.questions ?? [];
  const resolvedCount = session?.resolvedCount ?? 0;
  const totalCount = session?.totalCount ?? 0;

  return (
    <aside
      aria-label="Specification context"
      className="w-[240px] shrink-0 flex flex-col border-l border-column-border bg-modal-bg"
    >
      <header className="flex items-center px-md h-14 shrink-0 border-b border-column-border">
        <h2 className="text-sm font-semibold text-text-inverse">Specification Context</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-md flex flex-col gap-md">
        <div className="flex flex-col gap-xs">
          <span className="text-2xs font-semibold text-text-secondary uppercase tracking-wide">
            Ambiguities
          </span>
          <span className="text-sm text-text-inverse" data-testid="context-progress">
            {resolvedCount} of {totalCount} resolved
          </span>
        </div>

        {questions.length === 0 ? (
          <p className="text-xs text-text-disabled">
            Ambiguities will appear here once clarification starts.
          </p>
        ) : (
          <ul className="flex flex-col gap-sm">
            {questions.map((question) => (
              <li
                key={question.id}
                data-testid={question.resolved ? "ambiguity-resolved" : "ambiguity-open"}
                className="flex items-start gap-sm"
              >
                {question.resolved ? (
                  <CheckIcon
                    size={14}
                    className="text-resolved shrink-0 mt-px"
                    aria-label="Resolved"
                  />
                ) : (
                  <CircleDashedIcon
                    size={14}
                    className="text-text-disabled shrink-0 mt-px"
                    aria-label="Unresolved"
                  />
                )}
                <div className="flex flex-col gap-px min-w-0">
                  <span
                    className={`text-xs ${
                      question.resolved ? "text-text-inverse" : "text-text-secondary"
                    }`}
                  >
                    {question.ambiguity}
                  </span>
                  {question.resolved && question.answer && (
                    <span className="text-2xs text-text-disabled truncate">
                      {question.answer}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
