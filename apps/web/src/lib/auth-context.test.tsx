import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "./auth-context";
import { clearAccessToken, registerAccessTokenRefresher } from "./access-token-store";

const refreshSessionMutate = vi.fn();
const logoutMutate = vi.fn();

vi.mock("../trpc", () => ({
  rawTrpcClient: {
    auth: {
      refreshSession: { mutate: () => refreshSessionMutate() },
      logout: { mutate: () => logoutMutate() },
    },
  },
}));

function TestConsumer() {
  const { session, isHydrating, setSession, logout } = useAuth();
  return (
    <div>
      <span data-testid="hydrating">{isHydrating ? "yes" : "no"}</span>
      <span data-testid="session-email">{session?.user.email ?? "none"}</span>
      <button
        onClick={() =>
          setSession({
            accessToken: "abc123",
            expiresInSeconds: 900,
            user: { id: "1", fullName: "Ada Lovelace", email: "ada@example.com" },
          })
        }
      >
        sign in
      </button>
      <button onClick={() => void logout()}>sign out</button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  refreshSessionMutate.mockReset();
  logoutMutate.mockReset();
  // access-token-store is a module-level singleton, not React state, so it
  // must be reset explicitly between tests to avoid one test's token bleeding
  // into the next test's hydration behavior.
  clearAccessToken();
  registerAccessTokenRefresher(null);
});

describe("AuthProvider", () => {
  it("starts hydrating, then settles with no session when silent refresh fails", async () => {
    refreshSessionMutate.mockRejectedValue(new Error("no refresh cookie"));
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    expect(screen.getByTestId("hydrating")).toHaveTextContent("yes");
    await waitFor(() => expect(screen.getByTestId("hydrating")).toHaveTextContent("no"));
    expect(screen.getByTestId("session-email")).toHaveTextContent("none");
    expect(refreshSessionMutate).toHaveBeenCalledTimes(1);
  });

  it("silently hydrates the session from a successful refresh on mount, without a visible logout", async () => {
    refreshSessionMutate.mockResolvedValue({
      accessToken: "hydrated-token",
      expiresInSeconds: 900,
      user: { id: "2", fullName: "Grace Hopper", email: "grace@example.com" },
    });
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("hydrating")).toHaveTextContent("no"));
    expect(screen.getByTestId("session-email")).toHaveTextContent("grace@example.com");
  });

  it("sets the session in memory via setSession without persisting anything to localStorage", async () => {
    refreshSessionMutate.mockRejectedValue(new Error("no refresh cookie"));
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("hydrating")).toHaveTextContent("no"));

    fireEvent.click(screen.getByText("sign in"));
    expect(screen.getByTestId("session-email")).toHaveTextContent("ada@example.com");
    expect(window.localStorage.getItem("specforge.auth.session")).toBeNull();
    expect(window.localStorage).toHaveLength(0);
  });

  it("clears the session and calls the server logout procedure when logging out", async () => {
    refreshSessionMutate.mockRejectedValue(new Error("no refresh cookie"));
    logoutMutate.mockResolvedValue({ success: true });
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("hydrating")).toHaveTextContent("no"));

    fireEvent.click(screen.getByText("sign in"));
    expect(screen.getByTestId("session-email")).toHaveTextContent("ada@example.com");

    await act(async () => {
      fireEvent.click(screen.getByText("sign out"));
      await Promise.resolve();
    });

    expect(logoutMutate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("session-email")).toHaveTextContent("none");
  });

  it("clears the session even when the server logout call fails", async () => {
    refreshSessionMutate.mockRejectedValue(new Error("no refresh cookie"));
    logoutMutate.mockRejectedValue(new Error("network error"));
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("hydrating")).toHaveTextContent("no"));

    fireEvent.click(screen.getByText("sign in"));

    await act(async () => {
      fireEvent.click(screen.getByText("sign out"));
      await Promise.resolve();
    });

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
