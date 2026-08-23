import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClarifyPage } from "./ClarifyPage";
import { ProjectProvider } from "@/lib/project-context";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

interface Question {
  id: string;
  position: number;
  prompt: string;
  ambiguity: string;
  quickReplies: string[];
  answer: string | null;
  resolved: boolean;
}

let sessionQueryError: { message: string } | null = null;
let documentsQueryError: { message: string } | null = null;

interface SessionState {
  id: string;
  projectId: string;
  status: "active" | "completed";
  compiledContext: string | null;
  createdAt: string;
  completedAt: string | null;
  questions: Question[];
  messages: Array<{
    id: string;
    role: "ai" | "user";
    content: string;
    questionId: string | null;
    createdAt: string;
  }>;
  resolvedCount: number;
  totalCount: number;
  allResolved: boolean;
}

function makeSession(
  questions: Question[],
  status: "active" | "completed" = "active",
  messagesOverride?: SessionState["messages"],
): SessionState {
  const resolvedCount = questions.filter((question) => question.resolved).length;
  const messages =
    messagesOverride ??
    questions.map((question) => ({
      id: `msg-${question.id}`,
      role: "ai" as const,
      content: question.prompt,
      questionId: question.id,
      createdAt: new Date().toISOString(),
    }));
  return {
    id: "session-1",
    projectId: PROJECT_ID,
    status,
    compiledContext: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    questions,
    messages,
    resolvedCount,
    totalCount: questions.length,
    allResolved: questions.length > 0 && resolvedCount === questions.length,
  };
}

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "q1",
    position: 0,
    prompt: "Which auth method?",
    ambiguity: "Auth method",
    quickReplies: ["SSO"],
    answer: null,
    resolved: false,
    ...overrides,
  };
}

const documents = [
  {
    fileId: "file-1",
    fileName: "requirements.md",
    extension: "md" as const,
    pages: [{ pageNumber: 1, text: "The system must authenticate users" }],
  },
];

let sessionData: SessionState | null = null;
let documentsData: typeof documents = documents;

const startSessionMutate = vi.fn();
const sendMessageMutate = vi.fn();
const completeSessionMutate = vi.fn();
const setSessionData = vi.fn();
const invalidateSession = vi.fn();
let startSessionPending = false;
let completeSessionPending = false;

interface MutationOptions<TInput, TResult> {
  onMutate?: (input: TInput) => unknown;
  onSuccess?: (result: TResult, input: TInput, context: unknown) => void;
  onError?: (error: { message: string }, input: TInput, context: unknown) => void;
  onSettled?: () => void;
}

let sendMessageOptions: MutationOptions<
  { projectId: string; questionId: string; answer: string },
  SessionState
> | undefined;
let completeSessionOptions: MutationOptions<{ projectId: string }, SessionState> | undefined;
let startSessionOptions: MutationOptions<{ projectId: string }, SessionState> | undefined;

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      clarification: {
        getSessionState: {
          cancel: vi.fn(),
          getData: vi.fn(() => sessionData),
          setData: setSessionData,
          invalidate: invalidateSession,
        },
      },
    }),
    clarification: {
      getSessionState: {
        useQuery: () => ({ data: sessionData, isLoading: false, error: sessionQueryError }),
      },
      getBrdDocuments: {
        useQuery: () => ({ data: documentsData, isLoading: false, error: documentsQueryError }),
      },
      startSession: {
        useMutation: (options: MutationOptions<{ projectId: string }, SessionState>) => {
          startSessionOptions = options;
          return { mutate: startSessionMutate, isPending: startSessionPending };
        },
      },
      sendMessage: {
        useMutation: (
          options: MutationOptions<
            { projectId: string; questionId: string; answer: string },
            SessionState
          >,
        ) => {
          sendMessageOptions = options;
          return { mutate: sendMessageMutate, isPending: false };
        },
      },
      completeSession: {
        useMutation: (options: MutationOptions<{ projectId: string }, SessionState>) => {
          completeSessionOptions = options;
          return { mutate: completeSessionMutate, isPending: completeSessionPending };
        },
      },
    },
  },
}));

function renderPage(projectId: string | null = PROJECT_ID, onBacklogReady = vi.fn()) {
  if (projectId) {
    window.localStorage.setItem("specforge.workspace.currentProjectId", projectId);
  }
  render(
    <ProjectProvider>
      <ClarifyPage onBacklogReady={onBacklogReady} />
    </ProjectProvider>,
  );
  return { onBacklogReady };
}

beforeEach(() => {
  window.localStorage.clear();
  sessionData = null;
  documentsData = documents;
  sessionQueryError = null;
  documentsQueryError = null;
  startSessionPending = false;
  completeSessionPending = false;
  startSessionMutate.mockReset();
  sendMessageMutate.mockReset();
  completeSessionMutate.mockReset();
  setSessionData.mockReset();
  invalidateSession.mockReset();
  sendMessageOptions = undefined;
  completeSessionOptions = undefined;
  startSessionOptions = undefined;
});

describe("ClarifyPage — project scope", () => {
  it("prompts to select a project when none is active", () => {
    renderPage(null);
    expect(
      screen.getByText("Select or create a project to start AI clarification."),
    ).toBeInTheDocument();
  });

  it("renders all three panes for an active project", () => {
    renderPage();
    expect(screen.getByLabelText("BRD document viewer")).toBeInTheDocument();
    expect(screen.getByLabelText("Clarification chat")).toBeInTheDocument();
    expect(screen.getByLabelText("Specification context")).toBeInTheDocument();
  });
});

describe("ClarifyPage — read-path errors", () => {
  it("surfaces a session-state load failure as an error toast", () => {
    sessionQueryError = { message: "You are not a member of this project" };
    renderPage();
    expect(
      screen.getByText("You are not a member of this project"),
    ).toBeInTheDocument();
  });

  it("surfaces a BRD document load failure as an error toast", () => {
    documentsQueryError = {
      message: 'Could not read text from "broken.md". Re-upload it and try again.',
    };
    renderPage();
    expect(
      screen.getByText('Could not read text from "broken.md". Re-upload it and try again.'),
    ).toBeInTheDocument();
  });
});

describe("ClarifyPage — starting a session", () => {
  it("starts the session scoped to the active project", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Start clarification/ }));
    expect(startSessionMutate).toHaveBeenCalledWith({ projectId: PROJECT_ID });
  });

  it("disables the start button when there are no BRD documents", () => {
    documentsData = [];
    renderPage();
    expect(screen.getByRole("button", { name: /Start clarification/ })).toBeDisabled();
  });

  it("shows the analyzing typing indicator while the AI is working", () => {
    startSessionPending = true;
    renderPage();
    expect(screen.getByTestId("typing-indicator")).toBeInTheDocument();
    expect(
      screen.getByText("SpecForge AI is analyzing specification..."),
    ).toBeInTheDocument();
  });

  it("surfaces an AI outage as an error toast", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Start clarification/ }));
    expect(startSessionOptions).toBeDefined();
    act(() => {
      startSessionOptions?.onError?.(
        { message: "The AI service is unavailable right now. Please try again." },
        { projectId: PROJECT_ID },
        undefined,
      );
    });
    expect(
      screen.getByText("The AI service is unavailable right now. Please try again."),
    ).toBeInTheDocument();
  });

  it("hides the start button once a session exists", () => {
    sessionData = makeSession([makeQuestion()]);
    renderPage();
    expect(screen.queryByRole("button", { name: /Start clarification/ })).not.toBeInTheDocument();
  });
});

describe("ClarifyPage — answering questions", () => {
  it("sends a quick-reply answer for the open question", () => {
    sessionData = makeSession([makeQuestion()]);
    renderPage();
    fireEvent.click(screen.getByText("SSO"));
    expect(sendMessageMutate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      questionId: "q1",
      answer: "SSO",
    });
  });

  it("optimistically resolves the answered ambiguity", async () => {
    sessionData = makeSession([makeQuestion({ id: "q1" }), makeQuestion({ id: "q2" })]);
    renderPage();

    expect(sendMessageOptions).toBeDefined();
    // onMutate cancels the in-flight query before writing, so it must be awaited
    // for the optimistic setData call to have been recorded.
    await act(async () => {
      await sendMessageOptions?.onMutate?.({
        projectId: PROJECT_ID,
        questionId: "q1",
        answer: "SSO",
      });
    });

    // The optimistic updater is handed to setData; run it over current state.
    const updater = setSessionData.mock.calls.at(-1)?.[1];
    expect(typeof updater).toBe("function");
    const next = (updater as (old: SessionState | null) => SessionState | null)(sessionData);
    expect(next?.questions.find((question) => question.id === "q1")?.resolved).toBe(true);
    expect(next?.resolvedCount).toBe(1);
    expect(next?.allResolved).toBe(false);
  });

  it("rolls back and reports the error when sending fails", () => {
    const previous = makeSession([makeQuestion()]);
    sessionData = previous;
    renderPage();

    act(() => {
      sendMessageOptions?.onError?.(
        { message: "That question does not belong to this clarification session" },
        { projectId: PROJECT_ID, questionId: "q1", answer: "SSO" },
        { previous },
      );
    });

    expect(setSessionData).toHaveBeenCalledWith(
      { projectId: PROJECT_ID },
      previous,
    );
    expect(
      screen.getByText("That question does not belong to this clarification session"),
    ).toBeInTheDocument();
  });
});

describe("ClarifyPage — Complete Clarification CTA", () => {
  it("is disabled while ambiguities remain unresolved", () => {
    sessionData = makeSession([
      makeQuestion({ id: "q1", resolved: true, answer: "SSO" }),
      makeQuestion({ id: "q2" }),
    ]);
    renderPage();
    expect(
      screen.getByRole("button", { name: /Complete Clarification & Generate Backlog/ }),
    ).toBeDisabled();
  });

  it("is disabled when there is no session at all", () => {
    renderPage();
    expect(
      screen.getByRole("button", { name: /Complete Clarification & Generate Backlog/ }),
    ).toBeDisabled();
  });

  it("is enabled once every ambiguity is resolved", () => {
    sessionData = makeSession([makeQuestion({ resolved: true, answer: "SSO" })]);
    renderPage();
    expect(
      screen.getByRole("button", { name: /Complete Clarification & Generate Backlog/ }),
    ).toBeEnabled();
  });

  it("is disabled again once the session is already completed", () => {
    sessionData = makeSession([makeQuestion({ resolved: true, answer: "SSO" })], "completed");
    renderPage();
    expect(
      screen.getByRole("button", { name: /Complete Clarification & Generate Backlog/ }),
    ).toBeDisabled();
  });

  it("offers to start a fresh session once the previous one is completed", () => {
    sessionData = makeSession([makeQuestion({ resolved: true, answer: "SSO" })], "completed");
    renderPage();

    const restartButton = screen.getByRole("button", { name: /Start new clarification/ });
    expect(restartButton).toBeEnabled();
    fireEvent.click(restartButton);
    expect(startSessionMutate).toHaveBeenCalledWith({ projectId: PROJECT_ID });
  });

  it("saves the context and hands off to the backlog on success", () => {
    sessionData = makeSession([makeQuestion({ resolved: true, answer: "SSO" })]);
    const { onBacklogReady } = renderPage();

    fireEvent.click(
      screen.getByRole("button", { name: /Complete Clarification & Generate Backlog/ }),
    );
    expect(completeSessionMutate).toHaveBeenCalledWith({ projectId: PROJECT_ID });

    act(() => {
      completeSessionOptions?.onSuccess?.(
        makeSession([makeQuestion({ resolved: true, answer: "SSO" })], "completed"),
        { projectId: PROJECT_ID },
        undefined,
      );
    });

    expect(onBacklogReady).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Specification context saved. Generating your backlog."),
    ).toBeInTheDocument();
  });

  it("reports a server-side gate rejection without navigating away", () => {
    sessionData = makeSession([makeQuestion({ resolved: true, answer: "SSO" })]);
    const { onBacklogReady } = renderPage();

    fireEvent.click(
      screen.getByRole("button", { name: /Complete Clarification & Generate Backlog/ }),
    );
    act(() => {
      completeSessionOptions?.onError?.(
        { message: "Resolve every clarification question before generating the backlog" },
        { projectId: PROJECT_ID },
        undefined,
      );
    });

    expect(onBacklogReady).not.toHaveBeenCalled();
    expect(
      screen.getByText("Resolve every clarification question before generating the backlog"),
    ).toBeInTheDocument();
  });
});
