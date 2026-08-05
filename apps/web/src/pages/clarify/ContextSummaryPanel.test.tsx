import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContextSummaryPanel } from "./ContextSummaryPanel";

type SessionState = NonNullable<Parameters<typeof ContextSummaryPanel>[0]["session"]>;
type Question = SessionState["questions"][number];

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "question-1",
    position: 0,
    prompt: "Which authentication method?",
    ambiguity: "Auth method",
    quickReplies: [],
    answer: null,
    resolved: false,
    ...overrides,
  };
}

function makeSession(questions: Question[]): SessionState {
  const resolvedCount = questions.filter((question) => question.resolved).length;
  return {
    id: "session-1",
    projectId: "11111111-1111-1111-1111-111111111111",
    status: "active",
    compiledContext: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    questions,
    messages: [],
    resolvedCount,
    totalCount: questions.length,
    allResolved: questions.length > 0 && resolvedCount === questions.length,
  };
}

describe("ContextSummaryPanel", () => {
  it("is titled 'Specification Context'", () => {
    render(<ContextSummaryPanel session={null} />);
    expect(screen.getByText("Specification Context")).toBeInTheDocument();
  });

  it("explains the empty state before a session starts", () => {
    render(<ContextSummaryPanel session={null} />);
    expect(
      screen.getByText("Ambiguities will appear here once clarification starts."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("context-progress")).toHaveTextContent("0 of 0 resolved");
  });

  it("lists every ambiguity with its label", () => {
    const session = makeSession([
      makeQuestion({ id: "q1", ambiguity: "Auth method" }),
      makeQuestion({ id: "q2", ambiguity: "Billing currency" }),
    ]);
    render(<ContextSummaryPanel session={session} />);
    expect(screen.getByText("Auth method")).toBeInTheDocument();
    expect(screen.getByText("Billing currency")).toBeInTheDocument();
  });

  it("marks resolved ambiguities with a green checkmark", () => {
    const session = makeSession([
      makeQuestion({ id: "q1", resolved: true, answer: "SSO" }),
      makeQuestion({ id: "q2" }),
    ]);
    render(<ContextSummaryPanel session={session} />);

    expect(screen.getAllByTestId("ambiguity-resolved")).toHaveLength(1);
    expect(screen.getAllByTestId("ambiguity-open")).toHaveLength(1);
    expect(screen.getByLabelText("Resolved").getAttribute("class")).toContain("text-resolved");
  });

  it("shows the recorded answer under a resolved ambiguity", () => {
    const session = makeSession([makeQuestion({ resolved: true, answer: "Email + password" })]);
    render(<ContextSummaryPanel session={session} />);
    expect(screen.getByText("Email + password")).toBeInTheDocument();
  });

  it("does not show an answer for an unresolved ambiguity", () => {
    const session = makeSession([makeQuestion({ resolved: false, answer: null })]);
    render(<ContextSummaryPanel session={session} />);
    expect(screen.getByLabelText("Unresolved")).toBeInTheDocument();
  });

  it("tracks live progress as ambiguities resolve", () => {
    const { rerender } = render(
      <ContextSummaryPanel
        session={makeSession([makeQuestion({ id: "q1" }), makeQuestion({ id: "q2" })])}
      />,
    );
    expect(screen.getByTestId("context-progress")).toHaveTextContent("0 of 2 resolved");

    rerender(
      <ContextSummaryPanel
        session={makeSession([
          makeQuestion({ id: "q1", resolved: true, answer: "SSO" }),
          makeQuestion({ id: "q2" }),
        ])}
      />,
    );
    expect(screen.getByTestId("context-progress")).toHaveTextContent("1 of 2 resolved");
  });
});
