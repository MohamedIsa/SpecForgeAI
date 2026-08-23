import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { App } from "./App";
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

const sampleStatuses = [{ id: "status-1", name: "Backlog", color: "#71717a", position: 0 }];

const generatedBacklog = {
  epics: [
    {
      title: "Authentication",
      tickets: [
        {
          ref: "T1",
          previewKey: "CHK-101",
          title: "Add login form",
          type: "story" as const,
          priority: "P1" as const,
          storyPoints: 3,
          acceptanceCriteria: [
            { given: "a visitor", when: "they submit valid credentials", expectedResult: "they are logged in" },
          ],
          aiDevPrompt: "Implement a login form.",
          dependsOn: [],
          dependsOnPreviewKeys: [],
        },
      ],
    },
  ],
  summary: { epicCount: 1, ticketCount: 1, totalStoryPoints: 3 },
};

let currentProjects: typeof sampleProjects = sampleProjects;

const generateBacklogMutate = vi.fn();
const publishBacklogMutate = vi.fn();
let publishOptions:
  | { onSuccess?: (result: { epicCount: number; ticketCount: number }) => void }
  | undefined;

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "user-1", fullName: "Test User", email: "test@example.com" } },
    isHydrating: false,
    setSession: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/trpc", () => ({
  trpc: {
    health: {
      useQuery: () => ({ data: { status: "ok", database: "connected" }, isLoading: false }),
    },
    useUtils: () => ({
      project: {
        listUserProjects: { cancel: vi.fn(), getData: vi.fn(), setData: vi.fn(), invalidate: vi.fn() },
      },
      status: {
        getProjectStatuses: { cancel: vi.fn(), getData: vi.fn(), setData: vi.fn(), invalidate: vi.fn() },
      },
      ticket: {
        getProjectTickets: { cancel: vi.fn(), getData: vi.fn(), setData: vi.fn(), invalidate: vi.fn() },
        getTicketDetails: { cancel: vi.fn(), getData: vi.fn(), setData: vi.fn(), invalidate: vi.fn() },
      },
    }),
    project: {
      listUserProjects: {
        useQuery: () => ({ data: currentProjects, isLoading: false }),
      },
      createProject: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      inviteMember: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    status: {
      getProjectStatuses: {
        useQuery: () => ({ data: sampleStatuses, isLoading: false }),
      },
      createStatus: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      reorderStatuses: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      deleteStatus: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    ticket: {
      getProjectTickets: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      getTicketDetails: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
      updateTicketStatus: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      createTicket: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      updateTicket: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    brd: {
      listFiles: {
        useQuery: () => ({ data: [{ id: "brd-1" }], isLoading: false }),
      },
    },
    clarification: {
      getSessionState: {
        useQuery: () => ({ data: { status: "completed" }, isLoading: false }),
      },
    },
    backlog: {
      generateBacklog: {
        useMutation: (options: { onError?: (error: { message: string }) => void }) => ({
          mutate: (input: { projectId: string }) => generateBacklogMutate(input),
          isPending: false,
          isError: false,
          data: generatedBacklog,
          _onError: options.onError,
        }),
      },
      publishBacklogToBoard: {
        useMutation: (options: {
          onSuccess?: (result: { epicCount: number; ticketCount: number }) => void;
          onError?: (error: { message: string }) => void;
        }) => {
          publishOptions = options;
          return {
            mutate: (input: unknown) => publishBacklogMutate(input),
            isPending: false,
            isSuccess: false,
          };
        },
      },
    },
  },
}));

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("specforge.workspace.currentProjectId", PROJECT_ID);
  currentProjects = sampleProjects;
  generateBacklogMutate.mockReset();
  publishBacklogMutate.mockReset();
  publishOptions = undefined;
});

describe("App — publish-to-board navigation", () => {
  it("keeps the success toast visible on the board after publishing unmounts BacklogReviewPage", () => {
    render(
      <ProjectProvider>
        <App />
      </ProjectProvider>,
    );

    // Reach the Backlog view via the sidebar (a direct visit, not the Clarify
    // redirect), generate, then publish — this exercises the real App.tsx
    // wiring end to end, not a stubbed onPublished.
    fireEvent.click(screen.getByRole("button", { name: /3\. Backlog Review/ }));
    fireEvent.click(screen.getByRole("button", { name: /Publish to Kanban Board/ }));

    act(() => {
      publishOptions?.onSuccess?.({ epicCount: 1, ticketCount: 1 });
    });

    // BacklogReviewPage has been unmounted by the navigation to "board" — the
    // toast must still be on screen because App owns it, not the unmounted page.
    expect(screen.queryByTestId("backlog-breadcrumb")).not.toBeInTheDocument();
    expect(
      screen.getByText("Published 1 tickets across 1 epics to the board."),
    ).toBeInTheDocument();
  });
});

describe("App — lifecycle stage gating", () => {
  it("locks a stage whose prerequisite is unmet and blocks navigation to it", () => {
    // The default mock has zero tickets, so board (which requires >=1
    // ticket) stays locked even though its query is enabled.
    render(
      <ProjectProvider>
        <App />
      </ProjectProvider>,
    );

    const boardButton = screen.getByRole("button", { name: /4\. Kanban Board/ });
    expect(boardButton).toBeDisabled();
    expect(boardButton).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(boardButton);
    expect(boardButton).not.toHaveAttribute("aria-current", "page");
  });

  it("leaves a stage whose prerequisite is met unlocked and clickable", () => {
    render(
      <ProjectProvider>
        <App />
      </ProjectProvider>,
    );

    // Backlog requires only a completed clarification session (mocked as
    // completed), independent of the BRD/ticket state used above — clicking
    // it directly proves handleNavigate's allow-path, not just its guard.
    const backlogButton = screen.getByRole("button", { name: /3\. Backlog Review/ });
    expect(backlogButton).not.toBeDisabled();
    expect(backlogButton).not.toHaveAttribute("aria-disabled", "true");

    fireEvent.click(backlogButton);
    expect(backlogButton).toHaveAttribute("aria-current", "page");
  });
});

describe("App — standalone onboarding", () => {
  it("renders the full-screen onboarding wizard instead of the sidebar layout when the user has no projects", () => {
    currentProjects = [];

    render(
      <ProjectProvider>
        <App />
      </ProjectProvider>,
    );

    expect(screen.getByText("Welcome to SpecForge AI")).toBeInTheDocument();
    expect(screen.queryByLabelText("Toggle sidebar")).not.toBeInTheDocument();
    // Nothing to cancel back to with zero projects.
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });
});
