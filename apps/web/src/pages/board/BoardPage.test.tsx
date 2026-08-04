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

const sampleTickets = [
  {
    id: "ticket-1",
    projectId: PROJECT_ID,
    statusId: "status-1",
    key: "SPEC-101",
    title: "Implement login flow",
    description: null,
    type: "story" as const,
    priority: "P1" as const,
    storyPoints: 3,
    assigneeId: null,
    acceptanceCriteria: [],
    aiDevPrompt: null,
    dependencies: [],
    createdAt: new Date().toISOString(),
    assignee: null,
  },
];

const updateTicketStatusMutate = vi.fn();
const createTicketMutate = vi.fn();
const updateTicketMutate = vi.fn();

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
      ticket: {
        getProjectTickets: {
          cancel: vi.fn(),
          getData: vi.fn(() => sampleTickets),
          setData: vi.fn(),
          invalidate: vi.fn(),
        },
        getTicketDetails: {
          cancel: vi.fn(),
          getData: vi.fn(() => undefined),
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
    ticket: {
      getProjectTickets: {
        useQuery: () => ({ data: sampleTickets, isLoading: false }),
      },
      getTicketDetails: {
        useQuery: (input: { ticketId: string }) => ({
          data:
            input.ticketId === "ticket-1"
              ? { ...sampleTickets[0], dependencySummaries: [] }
              : undefined,
          isLoading: false,
        }),
      },
      updateTicketStatus: {
        useMutation: (options: unknown) => {
          void options;
          return { mutate: updateTicketStatusMutate, isPending: false };
        },
      },
      createTicket: {
        useMutation: (options: unknown) => {
          void options;
          return { mutate: createTicketMutate, isPending: false };
        },
      },
      updateTicket: {
        useMutation: (options: unknown) => {
          void options;
          return { mutate: updateTicketMutate, isPending: false };
        },
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
  updateTicketStatusMutate.mockReset();
  createTicketMutate.mockReset();
  updateTicketMutate.mockReset();
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

  it("renders the project title and a real ticket/epic breadcrumb", () => {
    renderBoard();
    expect(screen.getByText("Spec Forge")).toBeInTheDocument();
    expect(screen.getByText("1 tickets · 0 epics")).toBeInTheDocument();
  });

  it("renders a column per status with its name, ticket count, and ticket cards", () => {
    renderBoard();
    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("SPEC-101")).toBeInTheDocument();
    expect(screen.getByText("Implement login flow")).toBeInTheDocument();
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

  it("opens the Create Ticket modal defaulted to the first status when clicking New ticket", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: /New ticket/ }));
    expect(screen.getByRole("heading", { name: "New ticket" })).toBeInTheDocument();
  });

  it("opens the Create Ticket modal via a column's Add card button", () => {
    renderBoard();
    const addCardButtons = screen.getAllByText("+ Add card");
    const firstAddCardButton = addCardButtons[0];
    if (!firstAddCardButton) throw new Error("expected an Add card button to exist");
    fireEvent.click(firstAddCardButton);
    expect(screen.getByRole("heading", { name: "New ticket" })).toBeInTheDocument();
  });

  it("shows a not-available notice when clicking a column menu", () => {
    renderBoard();
    fireEvent.click(screen.getByLabelText("Backlog column menu"));
    expect(screen.getByText("Column menu is not available yet.")).toBeInTheDocument();
  });

  it("opens the Ticket Detail modal when a ticket card is clicked", () => {
    renderBoard();
    fireEvent.click(screen.getByText("SPEC-101"));
    expect(screen.getByLabelText("Close ticket detail")).toBeInTheDocument();
  });

  it("moves a ticket to another column via drag-and-drop", () => {
    const { container } = renderBoard();
    const card = screen.getByText("SPEC-101").closest('[draggable="true"]');
    const targetColumn = container.querySelector('[data-status-id="status-2"]');
    if (!card || !targetColumn) throw new Error("expected the card and target column to exist");

    fireEvent.dragStart(card);
    fireEvent.dragOver(targetColumn);
    fireEvent.drop(targetColumn);

    expect(updateTicketStatusMutate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      ticketId: "ticket-1",
      statusId: "status-2",
    });
  });

  it("does not call updateTicketStatus when dropping onto the ticket's current column", () => {
    const { container } = renderBoard();
    const card = screen.getByText("SPEC-101").closest('[draggable="true"]');
    const sameColumn = container.querySelector('[data-status-id="status-1"]');
    if (!card || !sameColumn) throw new Error("expected the card and column to exist");

    fireEvent.dragStart(card);
    fireEvent.dragOver(sameColumn);
    fireEvent.drop(sameColumn);

    expect(updateTicketStatusMutate).not.toHaveBeenCalled();
  });
});
