import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UserMenu } from "./UserMenu";
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
    memberCount: 1,
  },
];

const logoutMock = vi.fn();

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "user-1", fullName: "Ada Lovelace", email: "ada@example.com" } },
    isHydrating: false,
    setSession: vi.fn(),
    logout: logoutMock,
  }),
}));

vi.mock("@/trpc", () => ({
  trpc: {
    project: {
      listUserProjects: {
        useQuery: () => ({ data: sampleProjects, isLoading: false }),
      },
    },
  },
}));

function renderMenu(variant: "sidebar" | "header") {
  window.localStorage.setItem("specforge.workspace.currentProjectId", "project-1");
  return render(
    <ProjectProvider>
      <UserMenu variant={variant} />
    </ProjectProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  logoutMock.mockReset();
  logoutMock.mockResolvedValue(undefined);
});

describe("UserMenu", () => {
  it("shows the user's name and avatar initials as the sidebar trigger", () => {
    renderMenu("sidebar");
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("opens the popover to reveal email, role, and the Log out action", () => {
    renderMenu("sidebar");
    fireEvent.click(screen.getByLabelText("User menu"));

    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Log out/ })).toBeInTheDocument();
  });

  it("closes the popover when clicking outside", () => {
    renderMenu("header");
    fireEvent.click(screen.getByLabelText("User menu"));
    expect(screen.getByRole("menuitem", { name: /Log out/ })).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menuitem", { name: /Log out/ })).not.toBeInTheDocument();
  });

  it("invokes the auth context's logout() handler when Log out is clicked", async () => {
    renderMenu("sidebar");
    fireEvent.click(screen.getByLabelText("User menu"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Log out/ }));

    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));
  });

  it("closes the popover as soon as Log out is clicked", () => {
    renderMenu("sidebar");
    fireEvent.click(screen.getByLabelText("User menu"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Log out/ }));

    expect(screen.queryByText("ada@example.com")).not.toBeInTheDocument();
  });
});
