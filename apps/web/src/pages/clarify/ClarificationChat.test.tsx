import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClarificationChat, TYPING_INDICATOR_TEXT } from "./ClarificationChat";

type SessionState = NonNullable<Parameters<typeof ClarificationChat>[0]["session"]>;
type Question = SessionState["questions"][number];
type Message = SessionState["messages"][number];

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "question-1",
    position: 0,
    prompt: "Which authentication method should be used?",
    ambiguity: "Auth method",
    quickReplies: ["Email + password", "SSO"],
    answer: null,
    resolved: false,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "message-1",
    role: "ai",
    content: "Which authentication method should be used?",
    questionId: "question-1",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  const questions = overrides.questions ?? [makeQuestion()];
  const resolvedCount = questions.filter((question) => question.resolved).length;
  return {
    id: "session-1",
    projectId: "11111111-1111-1111-1111-111111111111",
    status: "active",
    compiledContext: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    questions,
    messages: [makeMessage()],
    resolvedCount,
    totalCount: questions.length,
    allResolved: questions.length > 0 && resolvedCount === questions.length,
    ...overrides,
  };
}

describe("ClarificationChat — resolution counter", () => {
  it("renders the counter in the spec'd 'n of m resolved' form", () => {
    const questions = [
      makeQuestion({ id: "q1", resolved: true, answer: "SSO" }),
      makeQuestion({ id: "q2" }),
      makeQuestion({ id: "q3" }),
    ];
    render(
      <ClarificationChat
        session={makeSession({ questions })}
        isThinking={false}
        onAnswer={vi.fn()}
        canAnswer
      />,
    );
    expect(screen.getByTestId("resolution-counter")).toHaveTextContent("1 of 3 resolved");
  });

  it("shows zero of zero before a session exists", () => {
    render(
      <ClarificationChat session={null} isThinking={false} onAnswer={vi.fn()} canAnswer={false} />,
    );
    expect(screen.getByTestId("resolution-counter")).toHaveTextContent("0 of 0 resolved");
  });
});

describe("ClarificationChat — messages", () => {
  it("renders AI and user bubbles distinctly", () => {
    const session = makeSession({
      messages: [
        makeMessage({ id: "m1", role: "ai", content: "AI question" }),
        makeMessage({ id: "m2", role: "user", content: "User answer" }),
      ],
    });
    render(
      <ClarificationChat session={session} isThinking={false} onAnswer={vi.fn()} canAnswer />,
    );
    expect(screen.getByTestId("ai-message")).toHaveTextContent("AI question");
    expect(screen.getByTestId("user-message")).toHaveTextContent("User answer");
  });

  it("prompts the user to start when there is no session", () => {
    render(
      <ClarificationChat session={null} isThinking={false} onAnswer={vi.fn()} canAnswer={false} />,
    );
    expect(screen.getByText(/Start the clarification session/)).toBeInTheDocument();
  });
});

describe("ClarificationChat — typing indicator & sfBounce animation", () => {
  it("shows the spec'd analyzing text and sfBounce animated dots while thinking", () => {
    render(
      <ClarificationChat session={makeSession()} isThinking onAnswer={vi.fn()} canAnswer />,
    );
    const indicator = screen.getByTestId("typing-indicator");
    expect(indicator).toBeInTheDocument();
    expect(screen.getByText(TYPING_INDICATOR_TEXT)).toBeInTheDocument();
    expect(TYPING_INDICATOR_TEXT).toBe("SpecForge AI is analyzing specification...");

    const bounceDots = indicator.querySelectorAll(".animate-sf-bounce");
    expect(bounceDots).toHaveLength(3);
  });

  it("hides the indicator when not thinking", () => {
    render(
      <ClarificationChat
        session={makeSession()}
        isThinking={false}
        onAnswer={vi.fn()}
        canAnswer
      />,
    );
    expect(screen.queryByTestId("typing-indicator")).not.toBeInTheDocument();
  });
});

describe("ClarificationChat — turn-by-turn quick reply chips", () => {
  it("renders quick reply chips only on the active question bubble", () => {
    const session = makeSession({
      questions: [
        makeQuestion({ id: "q1", prompt: "Which auth method?", quickReplies: ["SSO", "Password"], resolved: false }),
      ],
      messages: [
        makeMessage({ id: "m1", questionId: "q1", content: "Which auth method?" }),
      ],
    });
    render(
      <ClarificationChat session={session} isThinking={false} onAnswer={vi.fn()} canAnswer />,
    );
    const chips = screen.getAllByTestId("quick-reply-chip");
    expect(chips.map((chip) => chip.textContent)).toEqual(["SSO", "Password"]);
    expect(chips[0]?.className).toContain("bg-chip-bg");
    expect(chips[0]?.className).toContain("text-chip-text");
  });

  it("renders previous answered questions in history above WITHOUT chips, while active question renders chips", () => {
    const q1 = makeQuestion({
      id: "q1",
      prompt: "First question?",
      quickReplies: ["Option A", "Option B"],
      answer: "Option A",
      resolved: true,
    });
    const q2 = makeQuestion({
      id: "q2",
      position: 1,
      prompt: "Second question?",
      quickReplies: ["Option C", "Option D"],
      answer: null,
      resolved: false,
    });

    const session = makeSession({
      questions: [q1, q2],
      messages: [
        makeMessage({ id: "m1", questionId: "q1", content: "First question?", role: "ai" }),
        makeMessage({ id: "m2", questionId: "q1", content: "Option A", role: "user" }),
        makeMessage({ id: "m3", questionId: "q2", content: "Noted. Second question?", role: "ai" }),
      ],
    });

    render(
      <ClarificationChat session={session} isThinking={false} onAnswer={vi.fn()} canAnswer />,
    );

    // Both AI messages and the user message remain visible in chat history
    const aiMessages = screen.getAllByTestId("ai-message");
    expect(aiMessages).toHaveLength(2);
    expect(aiMessages[0]?.textContent).toBe("First question?");
    expect(aiMessages[1]?.textContent).toBe("Noted. Second question?");
    expect(screen.getByTestId("user-message")).toHaveTextContent("Option A");

    // Only the single active question bubble (q2) has quick reply chips (Option C, Option D)
    const chips = screen.getAllByTestId("quick-reply-chip");
    expect(chips.map((chip) => chip.textContent)).toEqual(["Option C", "Option D"]);
    expect(screen.queryByText("Option B")).not.toBeInTheDocument();
  });

  it("submits the chip text as the answer for the active question when clicked", () => {
    const onAnswer = vi.fn();
    render(
      <ClarificationChat session={makeSession()} isThinking={false} onAnswer={onAnswer} canAnswer />,
    );
    fireEvent.click(screen.getByText("SSO"));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer.mock.calls[0]?.[1]).toBe("SSO");
    expect(onAnswer.mock.calls[0]?.[0]).toMatchObject({ id: "question-1" });
  });

  it("hides chips once every question is resolved", () => {
    const questions = [makeQuestion({ resolved: true, answer: "SSO" })];
    render(
      <ClarificationChat
        session={makeSession({ questions })}
        isThinking={false}
        onAnswer={vi.fn()}
        canAnswer
      />,
    );
    expect(screen.queryByTestId("quick-reply-chip")).not.toBeInTheDocument();
  });

  it("omits chips for an active question that has none", () => {
    const questions = [makeQuestion({ quickReplies: [] })];
    render(
      <ClarificationChat
        session={makeSession({ questions })}
        isThinking={false}
        onAnswer={vi.fn()}
        canAnswer
      />,
    );
    expect(screen.queryByTestId("quick-reply-chip")).not.toBeInTheDocument();
  });
});

describe("ClarificationChat — composer & state progression", () => {
  it("submits a typed answer for the active open question", () => {
    const onAnswer = vi.fn();
    render(
      <ClarificationChat session={makeSession()} isThinking={false} onAnswer={onAnswer} canAnswer />,
    );
    fireEvent.change(screen.getByLabelText("Your answer"), {
      target: { value: "Email and password" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));
    expect(onAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "question-1" }),
      "Email and password",
    );
  });

  it("trims whitespace and ignores an empty submission", () => {
    const onAnswer = vi.fn();
    render(
      <ClarificationChat session={makeSession()} isThinking={false} onAnswer={onAnswer} canAnswer />,
    );
    const input = screen.getByLabelText("Your answer");

    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: /Send/ })).toBeDisabled();

    fireEvent.change(input, { target: { value: "  spaced answer  " } });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));
    expect(onAnswer).toHaveBeenCalledWith(expect.anything(), "spaced answer");
  });

  it("clears the composer after submitting", () => {
    render(
      <ClarificationChat session={makeSession()} isThinking={false} onAnswer={vi.fn()} canAnswer />,
    );
    const input = screen.getByLabelText("Your answer") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "An answer" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));
    expect(input.value).toBe("");
  });

  it("disables the composer when every question is resolved", () => {
    const questions = [makeQuestion({ resolved: true, answer: "SSO" })];
    render(
      <ClarificationChat
        session={makeSession({ questions })}
        isThinking={false}
        onAnswer={vi.fn()}
        canAnswer
      />,
    );
    expect(screen.getByLabelText("Your answer")).toBeDisabled();
    expect(screen.getByPlaceholderText("All questions resolved")).toBeInTheDocument();
  });

  it("disables answering entirely when the session is read-only", () => {
    const onAnswer = vi.fn();
    render(
      <ClarificationChat
        session={makeSession()}
        isThinking={false}
        onAnswer={onAnswer}
        canAnswer={false}
      />,
    );
    expect(screen.getByLabelText("Your answer")).toBeDisabled();
    fireEvent.click(screen.getByText("SSO"));
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
