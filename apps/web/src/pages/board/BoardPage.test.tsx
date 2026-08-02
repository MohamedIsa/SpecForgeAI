import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BoardPage } from "./BoardPage";
import { ProjectProvider } from "@/lib/project-context";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

const sampleProjects = [
  {
    id: PROJECT_ID,
    name: "Spec Forge",
    key: "SPEC",
    description: null,
    template: "kanban" as const,
    nextTicketNumber: 101,
    createdAt: new Date().toISOString(),
    role: "owner" as const,
    memberCount: 1,
  },
];

const sampleStatuses = [
  { id: "status-1", name: "Backlog", color: "#71717a", position: 0 },
  { id: "status-2", name: "In Progress", color: "#fbbf24", position: 1 },
];

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      status: {
        getProjectStatuses: {
          cancel: vi.fn(),
          getData: vi.fn(() => sampleStatuses),
          setData: vi.fn(),
          invalidate: vi.fn(),
        },
      },
    }),
    project: {
      listUserProjects: {
        useQuery: () => ({ data: sampleProjects, isLoading: false }),
      },
    },
    status: {
      getProjectStatuses: {
        useQuery: () => ({ data: sampleStatuses, isLoading: false }),
      },
      createStatus: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      reorderStatuses: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      deleteStatus: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

function renderBoard() {
  window.localStorage.setItem("specforge.workspace.currentProjectId", PROJECT_ID);
  return render(
    <ProjectProvider>
      <BoardPage />
    </ProjectProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("BoardPage", () => {
  it("shows a placeholder when no project is selected", () => {
    render(
      <ProjectProvider>
        <BoardPage />
      </ProjectProvider>,
    );
    expect(
      screen.getByText("Select or create a project to view its board."),
    ).toBeInTheDocument();
  });

  it("renders the project title and a real (zero) ticket/epic breadcrumb", () => {
    renderBoard();
    expect(screen.getByText("Spec Forge")).toBeInTheDocument();
    expect(screen.getByText("0 tickets · 0 epics")).toBeInTheDocument();
  });

  it("renders a column per status with its name and a zero ticket count badge", () => {
    renderBoard();
    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getAllByText("0")).toHaveLength(2);
  });

  it("renders the dotted Add status column affordance", () => {
    renderBoard();
    expect(screen.getByText("+ Add status column")).toBeInTheDocument();
  });

  it("opens the Manage Statuses modal via the header button", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Manage statuses" }));
    expect(screen.getByRole("heading", { name: "Manage statuses" })).toBeInTheDocument();
  });

  it("opens the Manage Statuses modal via the Add status column affordance", () => {
    renderBoard();
    fireEvent.click(screen.getByText("+ Add status column"));
    expect(screen.getByRole("heading", { name: "Manage statuses" })).toBeInTheDocument();
  });

  it("shows a not-available notice when clicking New ticket", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: /New ticket/ }));
    expect(screen.getByText("Creating tickets is not available yet.")).toBeInTheDocument();
  });

  it("shows a not-available notice when clicking Add card in a column", () => {
    renderBoard();
    const addCardButtons = screen.getAllByText("+ Add card");
    const firstAddCardButton = addCardButtons[0];
    if (!firstAddCardButton) throw new Error("expected an Add card button to exist");
    fireEvent.click(firstAddCardButton);
    expect(screen.getByText("Adding cards is not available yet.")).toBeInTheDocument();
  });

  it("shows a not-available notice when clicking a column menu", () => {
    renderBoard();
    fireEvent.click(screen.getByLabelText("Backlog column menu"));
    expect(screen.getByText("Column menu is not available yet.")).toBeInTheDocument();
  });
});
