import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ManageStatusesModal } from "./ManageStatusesModal";

const sampleStatuses = [
  { id: "status-1", name: "Backlog", color: "#71717a", position: 0 },
  { id: "status-2", name: "In Progress", color: "#fbbf24", position: 1 },
  { id: "status-3", name: "Done", color: "#4ade80", position: 2 },
];

interface CreateStatusOptions {
  onSuccess: (result: { status: (typeof sampleStatuses)[number] }) => void;
  onError: (error: { message: string }) => void;
}

interface ReorderOptions {
  onMutate: (input: { orderedStatusIds: string[] }) => void;
  onError: (error: { message: string }) => void;
}

let createStatusOptions: CreateStatusOptions | undefined;
let reorderOptions: ReorderOptions | undefined;
const createStatusMutate = vi.fn();
const reorderMutate = vi.fn();
const deleteStatusMutate = vi.fn();
const getDataMock = vi.fn(() => sampleStatuses);
const setDataMock = vi.fn();

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      status: {
        getProjectStatuses: {
          cancel: vi.fn(),
          getData: getDataMock,
          setData: setDataMock,
          invalidate: vi.fn(),
        },
      },
    }),
    status: {
      getProjectStatuses: {
        useQuery: () => ({ data: sampleStatuses, isLoading: false }),
      },
      createStatus: {
        useMutation: (options: CreateStatusOptions) => {
          createStatusOptions = options;
          return { mutate: createStatusMutate, isPending: false };
        },
      },
      reorderStatuses: {
        useMutation: (options: ReorderOptions) => {
          reorderOptions = options;
          return { mutate: reorderMutate, isPending: false };
        },
      },
      deleteStatus: {
        useMutation: () => ({ mutate: deleteStatusMutate, isPending: false }),
      },
    },
  },
}));

beforeEach(() => {
  createStatusMutate.mockReset();
  reorderMutate.mockReset();
  deleteStatusMutate.mockReset();
  getDataMock.mockReset().mockReturnValue(sampleStatuses);
  setDataMock.mockReset();
  createStatusOptions = undefined;
  reorderOptions = undefined;
});

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

describe("ManageStatusesModal", () => {
  it("does not render when closed", () => {
    render(
      <ManageStatusesModal
        open={false}
        projectId={PROJECT_ID}
        onClose={vi.fn()}
        onFeedback={vi.fn()}
      />,
    );
    expect(screen.queryByText("Manage statuses")).not.toBeInTheDocument();
  });

  it("does not render when there is no active project", () => {
    render(
      <ManageStatusesModal open projectId={null} onClose={vi.fn()} onFeedback={vi.fn()} />,
    );
    expect(screen.queryByText("Manage statuses")).not.toBeInTheDocument();
  });

  it("lists each status with its name, a drag handle, and a zero ticket count", () => {
    render(
      <ManageStatusesModal open projectId={PROJECT_ID} onClose={vi.fn()} onFeedback={vi.fn()} />,
    );
    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByLabelText("Drag to reorder Backlog")).toBeInTheDocument();
    expect(screen.getAllByText("0")).toHaveLength(3);
  });

  it("calls the delete mutation with the status id when a delete button is clicked", () => {
    render(
      <ManageStatusesModal open projectId={PROJECT_ID} onClose={vi.fn()} onFeedback={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText("Delete Backlog"));
    expect(deleteStatusMutate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      statusId: "status-1",
    });
  });

  it("submits a trimmed custom status name via the create mutation", () => {
    render(
      <ManageStatusesModal open projectId={PROJECT_ID} onClose={vi.fn()} onFeedback={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("New status name"), {
      target: { value: "  Blocked  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add custom status/ }));
    expect(createStatusMutate).toHaveBeenCalledWith({ projectId: PROJECT_ID, name: "Blocked" });
  });

  it("blocks submission of an empty status name without calling the mutation", () => {
    render(
      <ManageStatusesModal open projectId={PROJECT_ID} onClose={vi.fn()} onFeedback={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add custom status/ }));
    expect(createStatusMutate).not.toHaveBeenCalled();
    expect(screen.getByText("Status name is required")).toBeInTheDocument();
  });

  it("shows an inline error when the create mutation fails", () => {
    render(
      <ManageStatusesModal open projectId={PROJECT_ID} onClose={vi.fn()} onFeedback={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("New status name"), { target: { value: "Blocked" } });
    fireEvent.click(screen.getByRole("button", { name: /Add custom status/ }));

    expect(createStatusOptions).toBeDefined();
    act(() => {
      createStatusOptions?.onError({
        message: "A status with this name already exists in this project",
      });
    });
    expect(
      screen.getByText("A status with this name already exists in this project"),
    ).toBeInTheDocument();
  });

  it("calls onFeedback and clears the input after a successful create", () => {
    const onFeedback = vi.fn();
    render(
      <ManageStatusesModal open projectId={PROJECT_ID} onClose={vi.fn()} onFeedback={onFeedback} />,
    );
    const input = screen.getByLabelText("New status name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Blocked" } });
    fireEvent.click(screen.getByRole("button", { name: /Add custom status/ }));

    expect(createStatusOptions).toBeDefined();
    act(() => {
      createStatusOptions?.onSuccess({
        status: { id: "status-4", name: "Blocked", color: "#38bdf8", position: 3 },
      });
    });

    expect(onFeedback).toHaveBeenCalledWith('Status "Blocked" added');
    expect(input.value).toBe("");
  });

  it("reorders via drag-and-drop, calling reorderStatuses with the recomputed order", () => {
    render(
      <ManageStatusesModal open projectId={PROJECT_ID} onClose={vi.fn()} onFeedback={vi.fn()} />,
    );
    const backlogItem = screen.getByText("Backlog").closest("li");
    const doneItem = screen.getByText("Done").closest("li");
    if (!backlogItem || !doneItem) throw new Error("expected list items to exist");

    fireEvent.dragStart(backlogItem);
    fireEvent.dragOver(doneItem);
    fireEvent.drop(doneItem);

    expect(reorderMutate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      orderedStatusIds: ["status-2", "status-3", "status-1"],
    });
  });

  it("does not call reorderStatuses when dropping a status onto itself", () => {
    render(
      <ManageStatusesModal open projectId={PROJECT_ID} onClose={vi.fn()} onFeedback={vi.fn()} />,
    );
    const backlogItem = screen.getByText("Backlog").closest("li");
    if (!backlogItem) throw new Error("expected the Backlog list item to exist");

    fireEvent.dragStart(backlogItem);
    fireEvent.dragOver(backlogItem);
    fireEvent.drop(backlogItem);

    expect(reorderMutate).not.toHaveBeenCalled();
  });

  it("shows an inline error and rolls back optimistic data when reordering fails", () => {
    render(
      <ManageStatusesModal open projectId={PROJECT_ID} onClose={vi.fn()} onFeedback={vi.fn()} />,
    );
    const backlogItem = screen.getByText("Backlog").closest("li");
    const doneItem = screen.getByText("Done").closest("li");
    if (!backlogItem || !doneItem) throw new Error("expected list items to exist");

    fireEvent.dragStart(backlogItem);
    fireEvent.dragOver(doneItem);
    fireEvent.drop(doneItem);

    expect(reorderOptions).toBeDefined();
    act(() => {
      reorderOptions?.onError({ message: "You do not have permission to modify this project's statuses" });
    });

    expect(
      screen.getByText("You do not have permission to modify this project's statuses"),
    ).toBeInTheDocument();
  });

  it("calls onClose when the Close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <ManageStatusesModal open projectId={PROJECT_ID} onClose={onClose} onFeedback={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
