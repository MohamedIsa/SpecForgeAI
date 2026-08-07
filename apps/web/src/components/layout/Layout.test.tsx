import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Layout } from "./Layout.tsx";
import { ProjectProvider } from "@/lib/project-context";

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
        useQuery: () => ({ data: [], isLoading: false }),
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

  it("renders user profile section", () => {
    renderLayout(
      <Layout>
        <div />
      </Layout>,
    );
    expect(screen.getByText("Mohamed Isa")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
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
