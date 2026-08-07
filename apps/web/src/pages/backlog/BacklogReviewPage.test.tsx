import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { BacklogReviewPage } from "./BacklogReviewPage";
import { ProjectProvider } from "@/lib/project-context";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

const sampleProjects = [
  {
    id: PROJECT_ID,
    name: "Checkout Redesign",
    key: "CHK",
    description: null,
    template: "kanban" as const,
    nextTicketNumber: 101,
    createdAt: new Date().toISOString(),
    role: "owner" as const,
    memberCount: 1,
  },
];

interface Ticket {
  ref: string;
  previewKey: string;
  title: string;
  type: "story" | "bug" | "task";
  priority: "P0" | "P1" | "P2" | "P3";
  storyPoints: number;
  acceptanceCriteria: Array<{ given: string; when: string; then: string }>;
  aiDevPrompt: string;
  dependsOn: string[];
  dependsOnPreviewKeys: string[];
}

interface GenerateResult {
  epics: Array<{ title: string; tickets: Ticket[] }>;
  summary: { epicCount: number; ticketCount: number; totalStoryPoints: number };
}

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    ref: "T1",
    previewKey: "CHK-101",
    title: "Add login form",
    type: "story",
    priority: "P1",
    storyPoints: 3,
    acceptanceCriteria: [
      { given: "a visitor", when: "they submit valid credentials", then: "they are logged in" },
    ],
    aiDevPrompt: "Implement a login form.",
    dependsOn: [],
    dependsOnPreviewKeys: [],
    ...overrides,
  };
}

function makeResult(overrides: Partial<GenerateResult> = {}): GenerateResult {
  const epics = overrides.epics ?? [{ title: "Authentication", tickets: [makeTicket()] }];
  const tickets = epics.flatMap((epic) => epic.tickets);
  return {
    epics,
    summary: {
      epicCount: epics.length,
      ticketCount: tickets.length,
      totalStoryPoints: tickets.reduce((sum, ticket) => sum + ticket.storyPoints, 0),
    },
    ...overrides,
  };
}

const generateBacklogMutate = vi.fn();
const publishBacklogMutate = vi.fn();
let generateData: GenerateResult | undefined;
let generatePending = false;
let generateIsError = false;
let publishPending = false;

interface MutationOptions<TResult> {
  onSuccess?: (result: TResult) => void;
  onError?: (error: { message: string }) => void;
}

let generateOptions: MutationOptions<GenerateResult> | undefined;
let publishOptions: MutationOptions<{ epicCount: number; ticketCount: number }> | undefined;

vi.mock("@/trpc", () => ({
  trpc: {
    project: {
      listUserProjects: {
        useQuery: () => ({ data: sampleProjects, isLoading: false }),
      },
    },
    backlog: {
      generateBacklog: {
        useMutation: (options: MutationOptions<GenerateResult>) => {
          generateOptions = options;
          return {
            mutate: generateBacklogMutate,
            isPending: generatePending,
            isError: generateIsError,
            data: generateData,
          };
        },
      },
      publishBacklogToBoard: {
        useMutation: (options: MutationOptions<{ epicCount: number; ticketCount: number }>) => {
          publishOptions = options;
          return {
            mutate: publishBacklogMutate,
            isPending: publishPending,
            isSuccess: false,
          };
        },
      },
    },
  },
}));

function renderPage(
  projectId: string | null = PROJECT_ID,
  props: { autoStart?: boolean; onAutoStartConsumed?: () => void; onPublished?: (message: string) => void } = {},
) {
  if (projectId) {
    window.localStorage.setItem("specforge.workspace.currentProjectId", projectId);
  }
  const onPublished = props.onPublished ?? vi.fn();
  const onAutoStartConsumed = props.onAutoStartConsumed ?? vi.fn();
  render(
    <ProjectProvider>
      <BacklogReviewPage
        autoStart={props.autoStart}
        onAutoStartConsumed={onAutoStartConsumed}
        onPublished={onPublished}
      />
    </ProjectProvider>,
  );
  return { onPublished, onAutoStartConsumed };
}

beforeEach(() => {
  window.localStorage.clear();
  generateBacklogMutate.mockReset();
  publishBacklogMutate.mockReset();
  generateData = undefined;
  generatePending = false;
  generateIsError = false;
  publishPending = false;
  generateOptions = undefined;
  publishOptions = undefined;
});

describe("BacklogReviewPage — project scope", () => {
  it("prompts to select a project when none is active", () => {
    renderPage(null);
    expect(
      screen.getByText("Select or create a project to review its backlog."),
    ).toBeInTheDocument();
  });

  it("shows a manual Generate Backlog action when not arriving from Clarify", () => {
    renderPage(PROJECT_ID, { autoStart: false });
    expect(generateBacklogMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Generate Backlog/ })).toBeInTheDocument();
  });

  it("starts generation on click when triggered manually", () => {
    renderPage(PROJECT_ID, { autoStart: false });
    fireEvent.click(screen.getByRole("button", { name: /Generate Backlog/ }));
    expect(generateBacklogMutate).toHaveBeenCalledWith({ projectId: PROJECT_ID });
  });

  it("starts generation automatically when autoStart is set", () => {
    renderPage(PROJECT_ID, { autoStart: true });
    expect(generateBacklogMutate).toHaveBeenCalledWith({ projectId: PROJECT_ID });
  });

  it("reports autoStart as consumed so a remount does not refire it", () => {
    const { onAutoStartConsumed } = renderPage(PROJECT_ID, { autoStart: true });
    expect(onAutoStartConsumed).toHaveBeenCalledTimes(1);
  });

  it("does not start a second generation on re-render", () => {
    window.localStorage.setItem("specforge.workspace.currentProjectId", PROJECT_ID);
    const { rerender } = render(
      <ProjectProvider>
        <BacklogReviewPage autoStart onPublished={vi.fn()} />
      </ProjectProvider>,
    );
    rerender(
      <ProjectProvider>
        <BacklogReviewPage autoStart onPublished={vi.fn()} />
      </ProjectProvider>,
    );
    expect(generateBacklogMutate).toHaveBeenCalledTimes(1);
  });
});

describe("BacklogReviewPage — header", () => {
  it("shows the project breadcrumb", () => {
    renderPage(PROJECT_ID, { autoStart: true });
    expect(screen.getByTestId("backlog-breadcrumb")).toHaveTextContent(
      "Checkout Redesign / Backlog",
    );
  });

  it("disables Publish to Kanban Board while no backlog has been generated", () => {
    renderPage(PROJECT_ID, { autoStart: true });
    expect(screen.getByRole("button", { name: /Publish to Kanban Board/ })).toBeDisabled();
  });
});

describe("BacklogReviewPage — generation in progress", () => {
  it("shows the generation progress card while pending", () => {
    generatePending = true;
    renderPage(PROJECT_ID, { autoStart: true });
    expect(screen.getByLabelText("Generating backlog")).toBeInTheDocument();
  });

  it("hides the progress card once generation completes", () => {
    generateData = makeResult();
    renderPage(PROJECT_ID, { autoStart: true });
    expect(screen.queryByLabelText("Generating backlog")).not.toBeInTheDocument();
  });
});

describe("BacklogReviewPage — review mode", () => {
  it("shows the summary stats banner", () => {
    generateData = makeResult({
      epics: [
        { title: "Authentication", tickets: [makeTicket({ ref: "T1", storyPoints: 3 })] },
        { title: "Billing", tickets: [makeTicket({ ref: "T2", storyPoints: 5 })] },
      ],
    });
    renderPage(PROJECT_ID, { autoStart: true });
    expect(screen.getByTestId("backlog-summary")).toHaveTextContent(
      "2 tickets · 2 epics · 8 story points estimated",
    );
  });

  it("renders one accordion card per epic", () => {
    generateData = makeResult({
      epics: [
        { title: "Authentication", tickets: [makeTicket({ ref: "T1" })] },
        { title: "Billing", tickets: [makeTicket({ ref: "T2" })] },
      ],
    });
    renderPage(PROJECT_ID, { autoStart: true });
    expect(screen.getAllByTestId("epic-accordion-card")).toHaveLength(2);
  });

  it("renders both accordions independently even when two epics share a title", () => {
    generateData = makeResult({
      epics: [
        { title: "Same Title", tickets: [makeTicket({ ref: "T1" })] },
        { title: "Same Title", tickets: [makeTicket({ ref: "T2" })] },
      ],
    });
    renderPage(PROJECT_ID, { autoStart: true });
    const cards = screen.getAllByTestId("epic-accordion-card");
    expect(cards).toHaveLength(2);

    // The first is open by default (defaultOpen on index 0); the second must
    // toggle independently rather than being conflated by a shared React key.
    expect(screen.getAllByTestId("backlog-ticket-card")).toHaveLength(1);
    fireEvent.click(cards[1]?.querySelector("button") as HTMLElement);
    expect(screen.getAllByTestId("backlog-ticket-card")).toHaveLength(2);
  });

  it("enables Publish to Kanban Board once a backlog exists", () => {
    generateData = makeResult();
    renderPage(PROJECT_ID, { autoStart: true });
    expect(screen.getByRole("button", { name: /Publish to Kanban Board/ })).toBeEnabled();
  });

  it("publishes the generated epics to the board", () => {
    const result = makeResult();
    generateData = result;
    renderPage(PROJECT_ID, { autoStart: true });
    fireEvent.click(screen.getByRole("button", { name: /Publish to Kanban Board/ }));
    expect(publishBacklogMutate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      epics: result.epics,
    });
  });

  it("hands the confirmation message to onPublished instead of rendering its own toast", () => {
    generateData = makeResult();
    const { onPublished } = renderPage(PROJECT_ID, { autoStart: true });
    fireEvent.click(screen.getByRole("button", { name: /Publish to Kanban Board/ }));

    act(() => {
      publishOptions?.onSuccess?.({ epicCount: 1, ticketCount: 1 });
    });

    expect(onPublished).toHaveBeenCalledWith(
      "Published 1 tickets across 1 epics to the board.",
    );
    // The page itself must not render a toast — it is about to be unmounted
    // by the caller's navigation, and any toast it owned would vanish with it.
    expect(
      screen.queryByText("Published 1 tickets across 1 epics to the board."),
    ).not.toBeInTheDocument();
  });
});

describe("BacklogReviewPage — failure handling", () => {
  it("surfaces a generation failure as an error toast", () => {
    renderPage(PROJECT_ID, { autoStart: true });
    act(() => {
      generateOptions?.onError?.({ message: "The AI service is unavailable right now. Please try again." });
    });
    expect(
      screen.getByText("The AI service is unavailable right now. Please try again."),
    ).toBeInTheDocument();
  });

  it("offers a retry action once generation has failed", () => {
    generateIsError = true;
    renderPage(PROJECT_ID, { autoStart: true });
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
  });

  it("retries generation when Try again is clicked", () => {
    generateIsError = true;
    renderPage(PROJECT_ID, { autoStart: true });
    generateBacklogMutate.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(generateBacklogMutate).toHaveBeenCalledWith({ projectId: PROJECT_ID });
  });

  it("surfaces a publish failure without navigating away", () => {
    generateData = makeResult();
    const { onPublished } = renderPage(PROJECT_ID, { autoStart: true });
    fireEvent.click(screen.getByRole("button", { name: /Publish to Kanban Board/ }));

    act(() => {
      publishOptions?.onError?.({
        message: "This project has no statuses to publish tickets into",
      });
    });

    expect(onPublished).not.toHaveBeenCalled();
    expect(
      screen.getByText("This project has no statuses to publish tickets into"),
    ).toBeInTheDocument();
  });
});
