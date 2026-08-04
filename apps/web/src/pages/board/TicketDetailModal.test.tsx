import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { TicketDetailModal } from "./TicketDetailModal";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const TICKET_ID = "22222222-2222-2222-2222-222222222222";

const sampleStatuses = [
  { id: "status-1", name: "Backlog", color: "#71717a", position: 0 },
  { id: "status-2", name: "Done", color: "#4ade80", position: 1 },
];

function makeTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: TICKET_ID,
    projectId: PROJECT_ID,
    statusId: "status-1",
    key: "SPEC-101",
    title: "Implement login",
    description: "Some description",
    type: "story" as const,
    priority: "P1" as const,
    storyPoints: 5,
    assigneeId: null,
    acceptanceCriteria: [
      {
        given: "a user",
        when: "they submit valid credentials",
        then: "they are logged in",
        checked: false,
      },
    ],
    aiDevPrompt: "Build a login form.",
    dependencies: [],
    createdAt: new Date().toISOString(),
    assignee: { id: "user-1", fullName: "Ada Lovelace", email: "ada@example.com" },
    dependencySummaries: [],
    ...overrides,
  };
}

let ticketData: ReturnType<typeof makeTicket> | undefined = makeTicket();

interface UpdateTicketOptions {
  onSuccess: () => void;
  onError: (error: { message: string }) => void;
}

interface UpdateStatusOptions {
  onMutate: (input: { ticketId: string; statusId: string }) => void;
  onError: (error: { message: string }, input: unknown, context: unknown) => void;
  onSettled: () => void;
}

const updateTicketMutate = vi.fn();
const updateTicketStatusMutate = vi.fn();
let updateTicketOptions: UpdateTicketOptions | undefined;
let updateStatusOptions: UpdateStatusOptions | undefined;

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      ticket: {
        getProjectTickets: {
          cancel: vi.fn(),
          getData: vi.fn(() => []),
          setData: vi.fn(),
          invalidate: vi.fn(),
        },
        getTicketDetails: {
          getData: vi.fn(() => ticketData),
          setData: vi.fn(),
          invalidate: vi.fn(),
        },
      },
    }),
    ticket: {
      getTicketDetails: {
        useQuery: () => ({ data: ticketData, isLoading: false }),
      },
      updateTicket: {
        useMutation: (options: UpdateTicketOptions) => {
          updateTicketOptions = options;
          return { mutate: updateTicketMutate, isPending: false };
        },
      },
      updateTicketStatus: {
        useMutation: (options: UpdateStatusOptions) => {
          updateStatusOptions = options;
          return { mutate: updateTicketStatusMutate, isPending: false };
        },
      },
    },
    status: {
      getProjectStatuses: {
        useQuery: () => ({ data: sampleStatuses, isLoading: false }),
      },
    },
  },
}));

beforeEach(() => {
  ticketData = makeTicket();
  updateTicketMutate.mockReset();
  updateTicketStatusMutate.mockReset();
  updateTicketOptions = undefined;
  updateStatusOptions = undefined;
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

describe("TicketDetailModal", () => {
  it("renders nothing when no ticket is selected", () => {
    render(<TicketDetailModal projectId={PROJECT_ID} ticketId={null} onClose={vi.fn()} />);
    expect(screen.queryByLabelText("Ticket title")).not.toBeInTheDocument();
  });

  it("renders the key, type icon, priority pill, and story points badge", () => {
    render(<TicketDetailModal projectId={PROJECT_ID} ticketId={TICKET_ID} onClose={vi.fn()} />);
    expect(screen.getByText("SPEC-101")).toBeInTheDocument();
    expect(screen.getByLabelText("story")).toBeInTheDocument();
    expect(screen.getAllByText("P1").length).toBeGreaterThan(0);
    expect(screen.getByText("5 pts")).toBeInTheDocument();
  });

  it("pre-fills the editable title and description", () => {
    render(<TicketDetailModal projectId={PROJECT_ID} ticketId={TICKET_ID} onClose={vi.fn()} />);
    expect((screen.getByLabelText("Ticket title") as HTMLInputElement).value).toBe(
      "Implement login",
    );
    expect((screen.getByLabelText("Ticket description") as HTMLTextAreaElement).value).toBe(
      "Some description",
    );
  });

  it("saves the title on blur only when it changed", () => {
    render(<TicketDetailModal projectId={PROJECT_ID} ticketId={TICKET_ID} onClose={vi.fn()} />);
    const titleInput = screen.getByLabelText("Ticket title");

    fireEvent.blur(titleInput);
    expect(updateTicketMutate).not.toHaveBeenCalled();

    fireEvent.change(titleInput, { target: { value: "Implement signup" } });
    fireEvent.blur(titleInput);
    expect(updateTicketMutate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      ticketId: TICKET_ID,
      title: "Implement signup",
    });
  });

  it("saves the description on blur, clearing to null when emptied", () => {
    render(<TicketDetailModal projectId={PROJECT_ID} ticketId={TICKET_ID} onClose={vi.fn()} />);
    const descriptionInput = screen.getByLabelText("Ticket description");
    fireEvent.change(descriptionInput, { target: { value: "" } });
    fireEvent.blur(descriptionInput);
    expect(updateTicketMutate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      ticketId: TICKET_ID,
      description: null,
    });
  });

  it("formats acceptance criteria as Given/when/then text with a toggleable local checkbox", () => {
    render(<TicketDetailModal projectId={PROJECT_ID} ticketId={TICKET_ID} onClose={vi.fn()} />);
    expect(
      screen.getByText("Given a user, when they submit valid credentials, then they are logged in"),
    ).toBeInTheDocument();

    const checkbox = screen.getByLabelText("Toggle criterion 1") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    // Toggling is local-only UI state; it must not call any mutation.
    expect(updateTicketMutate).not.toHaveBeenCalled();
  });

  it("renders the AI Dev Prompt and copies it to the clipboard with Toast feedback", async () => {
    render(<TicketDetailModal projectId={PROJECT_ID} ticketId={TICKET_ID} onClose={vi.fn()} />);
    expect(screen.getByText("Build a login form.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Copy Prompt/ }));
    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Build a login form.");
    });
    await vi.waitFor(() => {
      expect(screen.getByText("Prompt copied to clipboard")).toBeInTheDocument();
    });
  });

  it("disables the Copy Prompt button when there is no AI dev prompt", () => {
    ticketData = makeTicket({ aiDevPrompt: null });
    render(<TicketDetailModal projectId={PROJECT_ID} ticketId={TICKET_ID} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Copy Prompt/ })).toBeDisabled();
    expect(screen.getByText("No AI dev prompt generated yet.")).toBeInTheDocument();
  });

  it("changes status via the status dropdown", () => {
    render(<TicketDetailModal projectId={PROJECT_ID} ticketId={TICKET_ID} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "status-2" } });
    expect(updateTicketStatusMutate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      ticketId: TICKET_ID,
      statusId: "status-2",
    });
  });

  it("shows an error toast and rolls back when a status change is rejected for dependencies", () => {
    render(<TicketDetailModal projectId={PROJECT_ID} ticketId={TICKET_ID} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "status-2" } });

    expect(updateStatusOptions).toBeDefined();
    act(() => {
      updateStatusOptions?.onError(
        { message: "This ticket has unfinished dependencies and cannot be moved yet" },
        {},
        undefined,
      );
    });
    expect(
      screen.getByText("This ticket has unfinished dependencies and cannot be moved yet"),
    ).toBeInTheDocument();
  });

  it("changes priority via the priority dropdown", () => {
    render(<TicketDetailModal projectId={PROJECT_ID} ticketId={TICKET_ID} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "P0" } });
    expect(updateTicketMutate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      ticketId: TICKET_ID,
      priority: "P0",
    });
  });

  it("shows an inline error message when an updateTicket edit fails", () => {
    render(<TicketDetailModal projectId={PROJECT_ID} ticketId={TICKET_ID} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "P0" } });

    expect(updateTicketOptions).toBeDefined();
    act(() => {
      updateTicketOptions?.onError({
        message: "You do not have permission to modify this project's tickets",
      });
    });
    expect(
      screen.getByText("You do not have permission to modify this project's tickets"),
    ).toBeInTheDocument();
  });

  it("renders the assignee badge when assigned, and Unassigned when not", () => {
    const { rerender } = render(
      <TicketDetailModal projectId={PROJECT_ID} ticketId={TICKET_ID} onClose={vi.fn()} />,
    );
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("AL")).toBeInTheDocument();

    ticketData = makeTicket({ assignee: null });
    rerender(<TicketDetailModal projectId={PROJECT_ID} ticketId={TICKET_ID} onClose={vi.fn()} />);
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("renders the dependency list with a status-derived indicator", () => {
    ticketData = makeTicket({
      dependencySummaries: [
        { id: "dep-1", key: "SPEC-100", title: "Set up auth schema", statusId: "status-2" },
        { id: "dep-2", key: "SPEC-99", title: "Design login UI", statusId: "status-1" },
      ],
    });
    render(<TicketDetailModal projectId={PROJECT_ID} ticketId={TICKET_ID} onClose={vi.fn()} />);
    expect(screen.getByText("SPEC-100")).toBeInTheDocument();
    expect(screen.getByText("Set up auth schema")).toBeInTheDocument();
    expect(screen.getByText("SPEC-99")).toBeInTheDocument();
  });

  it("shows None when there are no dependencies", () => {
    render(<TicketDetailModal projectId={PROJECT_ID} ticketId={TICKET_ID} onClose={vi.fn()} />);
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<TicketDetailModal projectId={PROJECT_ID} ticketId={TICKET_ID} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close ticket detail"));
    expect(onClose).toHaveBeenCalled();
  });
});
