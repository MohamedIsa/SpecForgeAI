import { useState } from "react";
import { SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SuccessToast, ErrorToast } from "@/components/ui/toast";
import { trpc } from "@/trpc";
import type { RouterOutputs } from "@/trpc";
import { useProjectWorkspace } from "@/lib/project-context";
import { BrdDocumentViewer } from "./BrdDocumentViewer";
import { ClarificationChat } from "./ClarificationChat";
import { ContextSummaryPanel } from "./ContextSummaryPanel";

type SessionState = NonNullable<RouterOutputs["clarification"]["getSessionState"]>;
type ClarificationQuestion = SessionState["questions"][number];

export function ClarifyPage({ onBacklogReady }: { readonly onBacklogReady?: () => void }) {
  const { currentProjectId } = useProjectWorkspace();
  const utils = trpc.useUtils();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [syncedReadError, setSyncedReadError] = useState<{ message: string } | null>(null);

  const projectQuery = { projectId: currentProjectId ?? "" };
  const enabled = Boolean(currentProjectId);

  const sessionQuery = trpc.clarification.getSessionState.useQuery(projectQuery, { enabled });
  const documentsQuery = trpc.clarification.getBrdDocuments.useQuery(projectQuery, { enabled });

  const startSession = trpc.clarification.startSession.useMutation({
    onSuccess: (state) => {
      utils.clarification.getSessionState.setData(projectQuery, state);
      setSuccessMessage("Clarification session started");
    },
    onError: (error) => setErrorMessage(error.message),
    onSettled: () => {
      if (enabled) void utils.clarification.getSessionState.invalidate(projectQuery);
    },
  });

  const sendMessage = trpc.clarification.sendMessage.useMutation({
    onMutate: async (input) => {
      await utils.clarification.getSessionState.cancel(projectQuery);
      const previous = utils.clarification.getSessionState.getData(projectQuery);
      // Optimistically resolve the answered ambiguity so the context panel and
      // resolution counter update the moment the user commits.
      utils.clarification.getSessionState.setData(projectQuery, (old) => {
        if (!old) return old;
        const questions = old.questions.map((question) =>
          question.id === input.questionId
            ? { ...question, resolved: true, answer: input.answer }
            : question,
        );
        const resolvedCount = questions.filter((question) => question.resolved).length;
        return {
          ...old,
          questions,
          resolvedCount,
          allResolved: questions.length > 0 && resolvedCount === questions.length,
          messages: [
            ...old.messages,
            {
              id: `optimistic-${Date.now()}`,
              role: "user" as const,
              content: input.answer,
              questionId: input.questionId,
              createdAt: new Date().toISOString(),
            },
          ],
        };
      });
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        utils.clarification.getSessionState.setData(projectQuery, context.previous);
      }
      setErrorMessage(error.message);
    },
    onSuccess: (state) => {
      utils.clarification.getSessionState.setData(projectQuery, state);
    },
    onSettled: () => {
      if (enabled) void utils.clarification.getSessionState.invalidate(projectQuery);
    },
  });

  const completeSession = trpc.clarification.completeSession.useMutation({
    onSuccess: (state) => {
      utils.clarification.getSessionState.setData(projectQuery, state);
      setSuccessMessage("Specification context saved. Generating your backlog.");
      onBacklogReady?.();
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const session = sessionQuery.data ?? null;
  const documents = documentsQuery.data ?? [];

  // Adjusting state during render (rather than a useEffect) so a fresh
  // read-path failure reaches the toast the moment it arrives, without an
  // extra render pass; `syncedReadError` stops it from re-firing every render.
  const readError = sessionQuery.error ?? documentsQuery.error ?? null;
  if (readError && readError !== syncedReadError) {
    setSyncedReadError(readError);
    setErrorMessage(readError.message);
  }

  const isThinking = startSession.isPending || sendMessage.isPending;
  const canComplete = session?.allResolved === true && session.status === "active";

  function handleAnswer(question: ClarificationQuestion, answer: string): void {
    if (!currentProjectId) return;
    setErrorMessage(null);
    sendMessage.mutate({ projectId: currentProjectId, questionId: question.id, answer });
  }

  if (!currentProjectId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-sm">
        <p className="text-text-secondary">
          Select or create a project to start AI clarification.
        </p>
      </div>
    );
  }

  let startButtonLabel: string;
  if (startSession.isPending) {
    startButtonLabel = "Analyzing...";
  } else if (session) {
    startButtonLabel = "Start new clarification";
  } else {
    startButtonLabel = "Start clarification";
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-lg h-14 shrink-0 border-b border-column-border">
        <div className="flex items-center gap-sm min-w-0">
          <h1 className="text-sm font-semibold text-text-inverse truncate">AI Clarification</h1>
          {session && (
            <span className="text-2xs text-text-secondary shrink-0">
              {session.status === "completed" ? "Completed" : "In progress"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-sm shrink-0">
          {(!session || session.status === "completed") && (
            <Button
              onClick={() => startSession.mutate({ projectId: currentProjectId })}
              disabled={startSession.isPending || documents.length === 0}
            >
              <SparklesIcon size={14} />
              {startButtonLabel}
            </Button>
          )}
          <Button
            disabled={!canComplete || completeSession.isPending}
            onClick={() => completeSession.mutate({ projectId: currentProjectId })}
          >
            {completeSession.isPending
              ? "Saving..."
              : "Complete Clarification & Generate Backlog"}
          </Button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <BrdDocumentViewer documents={documents} />
        <ClarificationChat
          session={session}
          isThinking={isThinking}
          onAnswer={handleAnswer}
          canAnswer={session?.status === "active"}
        />
        <ContextSummaryPanel session={session} />
      </div>

      {successMessage && (
        <SuccessToast message={successMessage} onDismiss={() => setSuccessMessage(null)} />
      )}
      {errorMessage && (
        <ErrorToast message={errorMessage} onDismiss={() => setErrorMessage(null)} />
      )}
    </div>
  );
}
