import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectOnboardingWizard } from "./ProjectOnboardingWizard";
import { ProjectProvider } from "@/lib/project-context";

const createMutate = vi.fn();
let mutationOptions:
  | {
      onSuccess?: (result: { project: { id: string; key: string } }) => void;
      onError?: (error: { message: string }) => void;
    }
  | undefined;

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      project: {
        listUserProjects: {
          setData: vi.fn(),
          invalidate: vi.fn(),
        },
      },
    }),
    project: {
      createProject: {
        useMutation: (options: typeof mutationOptions) => {
          mutationOptions = options;
          return { mutate: createMutate, isPending: false };
        },
      },
    },
  },
}));

function renderWizard(props: Partial<{ onCancel: () => void; onCreated: (m: string) => void }> = {}) {
  return render(
    <ProjectProvider>
      <ProjectOnboardingWizard onCreated={props.onCreated ?? vi.fn()} onCancel={props.onCancel} />
    </ProjectProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  createMutate.mockReset();
  mutationOptions = undefined;
});

describe("ProjectOnboardingWizard", () => {
  it("renders the first-run welcome step full-screen with no way to cancel when onCancel is omitted", () => {
    renderWizard();
    expect(screen.getByText("Welcome to SpecForge AI")).toBeInTheDocument();
    expect(screen.getByLabelText("Project name")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("shows a Cancel button when onCancel is provided (opened via New workspace)", () => {
    const onCancel = vi.fn();
    renderWizard({ onCancel });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("requires a name and key before advancing to the template step", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    expect(
      screen.getByText("Enter a project name and key to continue"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Status template")).not.toBeInTheDocument();
  });

  it("advances to the template step, and Back returns to the details step", () => {
    renderWizard();
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "New Co" } });
    fireEvent.change(screen.getByLabelText("Project key"), { target: { value: "NEW" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(screen.getByText("Status template")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByLabelText("Project name")).toHaveValue("New Co");
    expect(screen.queryByText("Status template")).not.toBeInTheDocument();
  });

  it("submits createProject with the entered details on the template step", () => {
    renderWizard();
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "New Co" } });
    fireEvent.change(screen.getByLabelText("Project key"), { target: { value: "NEW" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "New Co", key: "NEW", template: "kanban" }),
    );
  });

  it("calls onCreated with a confirmation message when creation succeeds", () => {
    const onCreated = vi.fn();
    renderWizard({ onCreated });
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "New Co" } });
    fireEvent.change(screen.getByLabelText("Project key"), { target: { value: "NEW" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    mutationOptions?.onSuccess?.({ project: { id: "project-1", key: "NEW" } });
    expect(onCreated).toHaveBeenCalledWith("Project NEW created");
  });

  it("shows the server error message when creation fails", () => {
    renderWizard();
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "New Co" } });
    fireEvent.change(screen.getByLabelText("Project key"), { target: { value: "NEW" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    act(() => {
      mutationOptions?.onError?.({ message: "A project with this key already exists" });
    });
    expect(screen.getByText("A project with this key already exists")).toBeInTheDocument();
  });
});
