import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CreateProjectModal } from "./CreateProjectModal";
import { ProjectProvider } from "@/lib/project-context";

interface ProjectSummary {
  id: string;
  name: string;
  key: string;
  description: string | null;
  template: "kanban" | "scrum";
  nextTicketNumber: number;
  createdAt: string;
  role: "owner" | "editor" | "viewer";
  memberCount: number;
}

interface CreateProjectInput {
  name: string;
  key: string;
  description?: string;
  template: "kanban" | "scrum";
}

interface CreateProjectResult {
  project: {
    id: string;
    name: string;
    key: string;
    description: string | null;
    template: "kanban" | "scrum";
    nextTicketNumber: number;
    createdAt: string;
  };
  statuses: Array<{ id: string; name: string; position: number }>;
}

interface MutationContext {
  previous: ProjectSummary[] | undefined;
  optimisticId: string;
}

interface MutationOptions {
  onMutate: (
    input: CreateProjectInput,
  ) => Promise<MutationContext> | MutationContext;
  onError: (
    error: { message: string },
    input: CreateProjectInput,
    context: MutationContext | undefined,
  ) => void;
  onSuccess: (
    result: CreateProjectResult,
    input: CreateProjectInput,
    context: MutationContext | undefined,
  ) => void;
  onSettled: () => void;
}

let mutationOptions: MutationOptions | undefined;
const mutate = vi.fn();
const cancelMock = vi.fn();
const getDataMock = vi.fn<() => ProjectSummary[]>(() => []);
const setDataMock = vi.fn();
const invalidateMock = vi.fn();

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      project: {
        listUserProjects: {
          cancel: cancelMock,
          getData: getDataMock,
          setData: setDataMock,
          invalidate: invalidateMock,
        },
      },
    }),
    project: {
      createProject: {
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
    <ProjectProvider>
      <CreateProjectModal open onClose={onClose} onCreated={onCreated} />
    </ProjectProvider>,
  );
  return { onClose, onCreated };
}

beforeEach(() => {
  window.localStorage.clear();
  mutate.mockReset();
  cancelMock.mockReset();
  getDataMock.mockReset();
  getDataMock.mockReturnValue([]);
  setDataMock.mockReset();
  invalidateMock.mockReset();
  mutationOptions = undefined;
});

describe("CreateProjectModal", () => {
  it("does not render when closed", () => {
    render(
      <ProjectProvider>
        <CreateProjectModal open={false} onClose={vi.fn()} onCreated={vi.fn()} />
      </ProjectProvider>,
    );
    expect(screen.queryByText("New workspace")).not.toBeInTheDocument();
  });

  it("shows a live KEY-101 ticket numbering preview that updates as the key is typed", () => {
    renderModal();
    expect(screen.getByText(/KEY-101/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Project key"), { target: { value: "spec" } });
    expect(screen.getByText(/SPEC-101/)).toBeInTheDocument();
  });

  it("defaults to the Standard Kanban template and allows switching to Agile/Scrum", () => {
    renderModal();
    const kanbanRadio = screen.getByRole("radio", { name: /Standard Kanban/ }) as HTMLInputElement;
    const scrumRadio = screen.getByRole("radio", { name: /Agile\/Scrum/ }) as HTMLInputElement;
    expect(kanbanRadio.checked).toBe(true);
    fireEvent.click(scrumRadio);
    expect(scrumRadio.checked).toBe(true);
    expect(kanbanRadio.checked).toBe(false);
  });

  it("submits the create project mutation with the entered values, normalized by the shared schema", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Spec Forge" } });
    fireEvent.change(screen.getByLabelText("Project key"), { target: { value: "spec" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(mutate).toHaveBeenCalledWith({
      name: "Spec Forge",
      key: "SPEC",
      description: undefined,
      template: "kanban",
    });
  });

  it("blocks submission and shows a friendly message for an invalid key, without calling the mutation", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Spec Forge" } });
    fireEvent.change(screen.getByLabelText("Project key"), { target: { value: "1NVALID" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(mutate).not.toHaveBeenCalled();
    expect(
      screen.getByText("Key must be 2-10 uppercase letters/numbers, starting with a letter"),
    ).toBeInTheDocument();
  });

  it("blocks submission for an empty project name without calling the mutation", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Project key"), { target: { value: "spec" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Project name is required")).toBeInTheDocument();
  });

  it("shows the inline error and shake state when creation fails", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Spec Forge" } });
    fireEvent.change(screen.getByLabelText("Project key"), { target: { value: "spec" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(mutationOptions).toBeDefined();
    act(() => {
      mutationOptions?.onError(
        { message: "A project with this key already exists" },
        { name: "Spec Forge", key: "spec", template: "kanban" },
        { previous: [], optimisticId: "optimistic-1" },
      );
    });

    expect(screen.getByText("A project with this key already exists")).toBeInTheDocument();
  });

  it("calls onCreated and closes the modal after a successful creation", () => {
    const { onClose, onCreated } = renderModal();
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Spec Forge" } });
    fireEvent.change(screen.getByLabelText("Project key"), { target: { value: "spec" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(mutationOptions).toBeDefined();
    act(() => {
      mutationOptions?.onSuccess(
        {
          project: {
            id: "project-1",
            name: "Spec Forge",
            key: "SPEC",
            description: null,
            template: "kanban",
            nextTicketNumber: 101,
            createdAt: new Date().toISOString(),
          },
          statuses: [],
        },
        { name: "Spec Forge", key: "spec", template: "kanban" },
        { previous: [], optimisticId: "optimistic-1" },
      );
    });

    expect(onCreated).toHaveBeenCalledWith("Project SPEC created");
    expect(onClose).toHaveBeenCalled();
  });
});
