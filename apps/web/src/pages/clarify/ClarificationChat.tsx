import { useState, type FormEvent } from "react";
import { SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RouterOutputs } from "@/trpc";

type SessionState = NonNullable<RouterOutputs["clarification"]["getSessionState"]>;
type ClarificationQuestion = SessionState["questions"][number];
type ClarificationMessage = SessionState["messages"][number];

export const TYPING_INDICATOR_TEXT = "SpecForge AI is analyzing specification...";

function MessageBubble({ message }: { message: ClarificationMessage }) {
  const isAi = message.role === "ai";
  return (
    <li className={`flex ${isAi ? "justify-start" : "justify-end"}`}>
      <div
        data-testid={isAi ? "ai-message" : "user-message"}
        className={`max-w-[75%] rounded-2lg px-md py-sm text-sm leading-relaxed ${
          isAi
            ? "bg-sidebar-item text-text-inverse"
            : "bg-primary text-text-inverse"
        }`}
      >
        {message.content}
      </div>
    </li>
  );
}

function TypingIndicator() {
  return (
    <li className="flex justify-start" data-testid="typing-indicator">
      <div className="flex items-center gap-sm rounded-2lg bg-sidebar-item px-md py-sm">
        <span className="flex gap-xs" aria-hidden="true">
          <span className="size-1.5 rounded-full bg-text-secondary animate-pulse" />
          <span className="size-1.5 rounded-full bg-text-secondary animate-pulse" />
          <span className="size-1.5 rounded-full bg-text-secondary animate-pulse" />
        </span>
        <span className="text-xs text-text-secondary">{TYPING_INDICATOR_TEXT}</span>
      </div>
    </li>
  );
}

export function ClarificationChat({
  session,
  isThinking,
  onAnswer,
  canAnswer,
}: {
  session: SessionState | null;
  isThinking: boolean;
  onAnswer: (question: ClarificationQuestion, answer: string) => void;
  canAnswer: boolean;
}) {
  const [draft, setDraft] = useState("");

  const openQuestion = session?.questions.find((question) => !question.resolved) ?? null;
  const resolvedCount = session?.resolvedCount ?? 0;
  const totalCount = session?.totalCount ?? 0;

  function submitAnswer(answer: string): void {
    const trimmed = answer.trim();
    if (!trimmed || !openQuestion || !canAnswer) return;
    onAnswer(openQuestion, trimmed);
    setDraft("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submitAnswer(draft);
  }

  return (
    <section aria-label="Clarification chat" className="flex flex-1 flex-col min-w-0">
      <header className="flex items-center justify-between px-lg h-14 shrink-0 border-b border-column-border">
        <h2 className="text-sm font-semibold text-text-inverse">AI Clarification</h2>
        <span className="text-2xs text-text-secondary" data-testid="resolution-counter">
          {resolvedCount} of {totalCount} resolved
        </span>
      </header>

      <ul className="flex-1 overflow-y-auto flex flex-col gap-sm p-lg">
        {!session && !isThinking && (
          <li className="text-sm text-text-secondary">
            Start the clarification session to have SpecForge AI interrogate your BRD.
          </li>
        )}
        {session?.messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {isThinking && <TypingIndicator />}
      </ul>

      {openQuestion && openQuestion.quickReplies.length > 0 && (
        <div className="flex flex-wrap gap-sm px-lg pb-sm shrink-0">
          {openQuestion.quickReplies.map((reply) => (
            <button
              key={reply}
              type="button"
              disabled={!canAnswer}
              onClick={() => submitAnswer(reply)}
              data-testid="quick-reply-chip"
              className="px-md py-1 rounded-full text-xs bg-chip-bg text-chip-text transition-opacity hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {reply}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-sm px-lg py-md shrink-0 border-t border-column-border"
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            openQuestion ? "Type your answer..." : "All questions resolved"
          }
          aria-label="Your answer"
          disabled={!openQuestion || !canAnswer}
        />
        <Button type="submit" disabled={!openQuestion || !canAnswer || draft.trim() === ""}>
          <SendIcon size={14} />
          Send
        </Button>
      </form>
    </section>
  );
}
