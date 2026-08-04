import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CreateTicketModal } from "./CreateTicketModal";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const STATUS_ID = "22222222-2222-2222-2222-222222222222";

interface CreateTicketInput {
  projectId: string;
  statusId: string;
  title: string;
  description?: string;
  type: string;
  priority: string;
  storyPoints?: number;
}

interface CreateTicketResult {
  ticket: {
    id: string;
    key: string;
    title: string;
  };
}

interface MutationContext {
  previous: unknown;
  optimisticId: string;
}

interface MutationOptions {
  onMutate: (input: CreateTicketInput) => Promise<MutationContext> | MutationContext;
  onError: (
    error: { message: string },
    input: CreateTicketInput,
    context: MutationContext | undefined,
  ) => void;
  onSuccess: (
    result: CreateTicketResult,
    input: CreateTicketInput,
    context: MutationContext | undefined,
  ) => void;
  onSettled: () => void;
}

let mutationOptions: MutationOptions | undefined;
const mutate = vi.fn();
const cancelMock = vi.fn();
const getDataMock = vi.fn(() => []);
const setDataMock = vi.fn();
const invalidateMock = vi.fn();

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      ticket: {
        getProjectTickets: {
          cancel: cancelMock,
          getData: getDataMock,
          setData: setDataMock,
          invalidate: invalidateMock,
        },
      },
    }),
    ticket: {
      createTicket: {
        useMutation: (options: MutationOptions) => {
          mutationOptions = options;
          return { mutate, isPending: false };
        },
      },
    },
  },
}));

function renderModal(onClose = vi.fn(), onCreated = vi.fn()) {
  render(
    <CreateTicketModal
      open
      projectId={PROJECT_ID}
      statusId={STATUS_ID}
      onClose={onClose}
      onCreated={onCreated}
    />,
  );
  return { onClose, onCreated };
}

beforeEach(() => {
  mutate.mockReset();
  cancelMock.mockReset();
  getDataMock.mockReset().mockReturnValue([]);
  setDataMock.mockReset();
  invalidateMock.mockReset();
  mutationOptions = undefined;
});

describe("CreateTicketModal", () => {
  it("does not render when closed", () => {
    render(
      <CreateTicketModal
        open={false}
        projectId={PROJECT_ID}
        statusId={STATUS_ID}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    expect(screen.queryByText("New ticket")).not.toBeInTheDocument();
  });

  it("does not render when there is no target status", () => {
    render(
      <CreateTicketModal
        open
        projectId={PROJECT_ID}
        statusId={null}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    expect(screen.queryByText("New ticket")).not.toBeInTheDocument();
  });

  it("defaults type to Story and priority to P2", () => {
    renderModal();
    expect((screen.getByLabelText("Type") as HTMLSelectElement).value).toBe("story");
    expect((screen.getByLabelText("Priority") as HTMLSelectElement).value).toBe("P2");
  });

  it("submits the create ticket mutation with the entered values", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Implement login" } });
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "bug" } });
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "P0" } });
    fireEvent.change(screen.getByLabelText("Points"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));

    expect(mutate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      statusId: STATUS_ID,
      title: "Implement login",
      description: undefined,
      type: "bug",
      priority: "P0",
      storyPoints: 5,
    });
  });

  it("rejects a negative story point value without calling the mutation", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Bad points" } });
    fireEvent.change(screen.getByLabelText("Points"), { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Story points must be a whole number of 0 or more")).toBeInTheDocument();
  });

  it("shows the inline error when creation fails", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Implement login" } });
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));

    expect(mutationOptions).toBeDefined();
    act(() => {
      mutationOptions?.onError(
        { message: "You do not have permission to modify this project's tickets" },
        {
          projectId: PROJECT_ID,
          statusId: STATUS_ID,
          title: "Implement login",
          type: "story",
          priority: "P2",
        },
        { previous: [], optimisticId: "optimistic-1" },
      );
    });

    expect(
      screen.getByText("You do not have permission to modify this project's tickets"),
    ).toBeInTheDocument();
  });

  it("calls onCreated and closes the modal after a successful creation", () => {
    const { onClose, onCreated } = renderModal();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Implement login" } });
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));

    expect(mutationOptions).toBeDefined();
    act(() => {
      mutationOptions?.onSuccess(
        { ticket: { id: "ticket-1", key: "SPEC-101", title: "Implement login" } },
        {
          projectId: PROJECT_ID,
          statusId: STATUS_ID,
          title: "Implement login",
          type: "story",
          priority: "P2",
        },
        { previous: [], optimisticId: "optimistic-1" },
      );
    });

    expect(onCreated).toHaveBeenCalledWith("Ticket SPEC-101 created");
    expect(onClose).toHaveBeenCalled();
  });
});
