import { describe, it, expect, beforeEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectProvider, useProjectWorkspace } from "./project-context";

const STORAGE_KEY = "specforge.workspace.currentProjectId";

function TestConsumer() {
  const { currentProjectId, setCurrentProjectId } = useProjectWorkspace();
  return (
    <div>
      <span data-testid="current-project">{currentProjectId ?? "none"}</span>
      <button onClick={() => setCurrentProjectId("project-1")}>select project</button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("ProjectProvider", () => {
  it("starts with no current project when localStorage is empty", () => {
    render(
      <ProjectProvider>
        <TestConsumer />
      </ProjectProvider>,
    );
    expect(screen.getByTestId("current-project")).toHaveTextContent("none");
  });

  it("persists the selected project id to localStorage", () => {
    render(
      <ProjectProvider>
        <TestConsumer />
      </ProjectProvider>,
    );
    fireEvent.click(screen.getByText("select project"));
    expect(screen.getByTestId("current-project")).toHaveTextContent("project-1");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("project-1");
  });

  it("hydrates from a previously stored project id on mount", () => {
    window.localStorage.setItem(STORAGE_KEY, "project-2");
    render(
      <ProjectProvider>
        <TestConsumer />
      </ProjectProvider>,
    );
    expect(screen.getByTestId("current-project")).toHaveTextContent("project-2");
  });
});

describe("useProjectWorkspace", () => {
  it("throws when used outside of a ProjectProvider", () => {
    function Broken() {
      useProjectWorkspace();
      return null;
    }
    expect(() => {
      act(() => {
        render(<Broken />);
      });
    }).toThrow("useProjectWorkspace must be used within a ProjectProvider");
  });
});
