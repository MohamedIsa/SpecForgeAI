import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectPicker } from "./ProjectPicker";
import { ProjectProvider } from "@/lib/project-context";

const sampleProjects = [
  {
    id: "project-1",
    name: "Spec Forge",
    key: "SPEC",
    description: null,
    template: "kanban" as const,
    nextTicketNumber: 101,
    createdAt: new Date().toISOString(),
    role: "owner" as const,
    memberCount: 3,
  },
  {
    id: "project-2",
    name: "Docs Site",
    key: "DOCS",
    description: null,
    template: "scrum" as const,
    nextTicketNumber: 101,
    createdAt: new Date().toISOString(),
    role: "editor" as const,
    memberCount: 1,
  },
];

const createMutate = vi.fn();
const inviteMutate = vi.fn();

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      project: {
        listUserProjects: {
          cancel: vi.fn(),
          getData: vi.fn(() => sampleProjects),
          setData: vi.fn(),
          invalidate: vi.fn(),
        },
      },
    }),
    project: {
      listUserProjects: {
        useQuery: () => ({ data: sampleProjects, isLoading: false }),
      },
      createProject: {
        useMutation: () => ({ mutate: createMutate, isPending: false }),
      },
      inviteMember: {
        useMutation: () => ({ mutate: inviteMutate, isPending: false }),
      },
    },
  },
}));

function renderPicker() {
  return render(
    <ProjectProvider>
      <ProjectPicker />
    </ProjectProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  createMutate.mockReset();
  inviteMutate.mockReset();
});

describe("ProjectPicker", () => {
  it("auto-selects the first project and shows it as the trigger label", () => {
    renderPicker();
    expect(screen.getByRole("button", { name: "Workspace switcher" })).toHaveTextContent(
      "Spec Forge",
    );
  });

  it("opens the dropdown to show member count, the Pro badge, and the project list", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Workspace switcher" }));
    expect(screen.getByText("3 members")).toBeInTheDocument();
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("Docs Site")).toBeInTheDocument();
  });

  it("switches the active project when selecting another one from the list", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Workspace switcher" }));
    fireEvent.click(screen.getByText("Docs Site"));
    expect(screen.getByRole("button", { name: "Workspace switcher" })).toHaveTextContent(
      "Docs Site",
    );
  });

  it("opens the Create Project modal via the New workspace trigger", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Workspace switcher" }));
    fireEvent.click(screen.getByText("New workspace"));
    expect(screen.getByRole("heading", { name: "New workspace" })).toBeInTheDocument();
  });

  it("opens the Invite Team Members modal via the Invite team members trigger", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Workspace switcher" }));
    fireEvent.click(screen.getByText("Invite team members"));
    expect(screen.getByRole("heading", { name: "Invite team members" })).toBeInTheDocument();
  });

  it("closes the dropdown when clicking outside", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Workspace switcher" }));
    expect(screen.getByText("Docs Site")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("Docs Site")).not.toBeInTheDocument();
  });
});
