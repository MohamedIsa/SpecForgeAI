import { describe, it, expect, beforeEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { AuthProvider, useAuth } from "./auth-context";

const STORAGE_KEY = "specforge.auth.session";

function TestConsumer() {
  const { session, setSession, clearSession } = useAuth();
  return (
    <div>
      <span data-testid="session-email">{session?.user.email ?? "none"}</span>
      <button
        onClick={() =>
          setSession({
            token: "abc123",
            user: { id: "1", fullName: "Ada Lovelace", email: "ada@example.com" },
          })
        }
      >
        sign in
      </button>
      <button onClick={clearSession}>sign out</button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("AuthProvider", () => {
  it("starts with no session when localStorage is empty", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    expect(screen.getByTestId("session-email")).toHaveTextContent("none");
  });

  it("persists the session to localStorage on setSession", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    fireEvent.click(screen.getByText("sign in"));
    expect(screen.getByTestId("session-email")).toHaveTextContent("ada@example.com");
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain("ada@example.com");
  });

  it("removes the session from localStorage on clearSession", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    fireEvent.click(screen.getByText("sign in"));
    fireEvent.click(screen.getByText("sign out"));
    expect(screen.getByTestId("session-email")).toHaveTextContent("none");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("hydrates from a previously stored session on mount", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        token: "stored-token",
        user: { id: "2", fullName: "Grace Hopper", email: "grace@example.com" },
      }),
    );

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    expect(screen.getByTestId("session-email")).toHaveTextContent("grace@example.com");
  });

  it("ignores malformed stored session data", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-json");
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    expect(screen.getByTestId("session-email")).toHaveTextContent("none");
  });
});

describe("useAuth", () => {
  it("throws when used outside of an AuthProvider", () => {
    function Broken() {
      useAuth();
      return null;
    }
    expect(() => {
      act(() => {
        render(<Broken />);
      });
    }).toThrow("useAuth must be used within an AuthProvider");
  });
});
