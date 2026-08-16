import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Layout } from "./Layout.tsx";
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
    role: "editor" as const,
    memberCount: 1,
  },
];

let currentProjects: typeof sampleProjects = [];

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "user-1", fullName: "Jane Doe", email: "jane@example.com" } },
    isHydrating: false,
    setSession: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      project: {
        listUserProjects: {
          cancel: vi.fn(),
          getData: vi.fn(() => []),
          setData: vi.fn(),
          invalidate: vi.fn(),
        },
      },
    }),
    project: {
      listUserProjects: {
        useQuery: () => ({ data: currentProjects, isLoading: false }),
      },
      createProject: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      inviteMember: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

function renderLayout(children: ReactNode) {
  return render(<ProjectProvider>{children}</ProjectProvider>);
}

beforeEach(() => {
  window.localStorage.clear();
  currentProjects = [];
});

describe("Layout", () => {
  it("renders children content", () => {
    renderLayout(
      <Layout>
        <div data-testid="content">Hello</div>
      </Layout>,
    );
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });

  it("renders sidebar with logo", () => {
    renderLayout(
      <Layout>
        <div />
      </Layout>,
    );
    expect(screen.getAllByText("SpecForge AI")[0]).toBeInTheDocument();
  });

  it("renders header with breadcrumb", () => {
    renderLayout(
      <Layout>
        <div />
      </Layout>,
    );
    expect(screen.getAllByText("SpecForge AI")[0]).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
  });

  it("renders navigation items", () => {
    renderLayout(
      <Layout>
        <div />
      </Layout>,
    );
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("1. Ingest BRD")).toBeInTheDocument();
    expect(screen.getByText("4. Kanban Board")).toBeInTheDocument();
  });

  it("toggles sidebar on button click", () => {
    renderLayout(
      <Layout>
        <div />
      </Layout>,
    );
    const toggleButton = screen.getByLabelText("Toggle sidebar");
    expect(toggleButton).toBeInTheDocument();
    fireEvent.click(toggleButton);
  });

  it("renders the user's name in the sidebar profile trigger", () => {
    renderLayout(
      <Layout>
        <div />
      </Layout>,
    );
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
  });

  it("opens the sidebar user menu with email, role, and a Log out action", () => {
    currentProjects = sampleProjects;
    window.localStorage.setItem("specforge.workspace.currentProjectId", "project-1");
    renderLayout(
      <Layout>
        <div />
      </Layout>,
    );

    const triggers = screen.getAllByLabelText("User menu");
    fireEvent.click(triggers[0]!);

    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
    expect(screen.getAllByText("editor").length).toBeGreaterThan(0);
    expect(screen.getByRole("menuitem", { name: /Log out/ })).toBeInTheDocument();
  });

  it("renders the workspace switcher with the placeholder label when no project exists", () => {
    renderLayout(
      <Layout>
        <div />
      </Layout>,
    );
    expect(screen.getByText("Select project...")).toBeInTheDocument();
  });
});
