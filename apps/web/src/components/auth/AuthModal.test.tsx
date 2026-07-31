import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { AuthModal } from "./AuthModal";
import { AuthProvider } from "@/lib/auth-context";
import { clearAccessToken, registerAccessTokenRefresher } from "@/lib/access-token-store";

interface MutationResult {
  accessToken: string;
  expiresInSeconds: number;
  user: { id: string; fullName: string; email: string };
}

interface MutationOptions {
  onSuccess: (result: MutationResult) => void;
  onError: (error: { message: string }) => void;
}

let signupOptions: MutationOptions | undefined;
let loginOptions: MutationOptions | undefined;
const signupMutate = vi.fn();
const loginMutate = vi.fn();
const refreshSessionMutate = vi.fn();
const logoutMutate = vi.fn();

vi.mock("@/trpc", () => ({
  trpc: {
    auth: {
      signup: {
        useMutation: (options: MutationOptions) => {
          signupOptions = options;
          return { mutate: signupMutate, isPending: false };
        },
      },
      login: {
        useMutation: (options: MutationOptions) => {
          loginOptions = options;
          return { mutate: loginMutate, isPending: false };
        },
      },
    },
  },
  rawTrpcClient: {
    auth: {
      refreshSession: { mutate: () => refreshSessionMutate() },
      logout: { mutate: () => logoutMutate() },
    },
  },
}));

async function renderModal() {
  const utils = render(
    <AuthProvider>
      <AuthModal />
    </AuthProvider>,
  );
  // Flush AuthProvider's mount-time silent-refresh attempt so it doesn't
  // resolve mid-assertion outside of act().
  await act(async () => {
    await Promise.resolve();
  });
  return utils;
}

beforeEach(() => {
  window.localStorage.clear();
  signupMutate.mockReset();
  loginMutate.mockReset();
  refreshSessionMutate.mockReset().mockRejectedValue(new Error("no refresh cookie"));
  logoutMutate.mockReset();
  signupOptions = undefined;
  loginOptions = undefined;
  clearAccessToken();
  registerAccessTokenRefresher(null);
});

describe("AuthModal", () => {
  it("renders the Login tab by default without a Full Name field", async () => {
    await renderModal();
    expect(screen.getByRole("tab", { name: "Login" })).toHaveAttribute("data-state", "active");
    expect(screen.queryByLabelText("Full Name")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("reveals the Full Name field when switching to Create Account", async () => {
    await renderModal();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Create Account" }));
    expect(screen.getByLabelText("Full Name")).toBeInTheDocument();
  });

  it("toggles password visibility via the eye icon", async () => {
    await renderModal();
    const passwordInput = screen.getByLabelText("Password") as HTMLInputElement;
    expect(passwordInput.type).toBe("password");
    fireEvent.click(screen.getByLabelText("Show password"));
    expect(passwordInput.type).toBe("text");
    fireEvent.click(screen.getByLabelText("Hide password"));
    expect(passwordInput.type).toBe("password");
  });

  it("toggles the remember me checkbox", async () => {
    await renderModal();
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toHaveAttribute("data-state", "unchecked");
    fireEvent.click(checkbox);
    expect(checkbox).toHaveAttribute("data-state", "checked");
  });

  it("submits login credentials via the login mutation, with rememberMe defaulting to false", async () => {
    await renderModal();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter22222" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(loginMutate).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "hunter22222",
      rememberMe: false,
    });
  });

  it("submits login credentials with rememberMe true when the checkbox is checked", async () => {
    await renderModal();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter22222" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(loginMutate).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "hunter22222",
      rememberMe: true,
    });
  });

  it("shows a shake animation, inline error, and toast banner on login failure", async () => {
    await renderModal();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(loginOptions).toBeDefined();
    act(() => {
      loginOptions?.onError({ message: "Invalid email or password" });
    });

    expect(screen.getAllByText("Invalid email or password").length).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Email").className).toContain("border-error-border");
  });

  it("blocks login submission and shows the Zod message for an invalid email, without calling the login mutation", async () => {
    await renderModal();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter22222" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(loginMutate).not.toHaveBeenCalled();
    expect(screen.getAllByText("Enter a valid email address").length).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("blocks signup submission and shows the Zod message for a password under 8 characters, without calling the signup mutation", async () => {
    await renderModal();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Create Account" }));
    fireEvent.change(screen.getByLabelText("Full Name"), { target: { value: "Ada Lovelace" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(signupMutate).not.toHaveBeenCalled();
    expect(
      screen.getAllByText("Password must be at least 8 characters").length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("stores the session in memory after a successful signup, without persisting to localStorage", async () => {
    await renderModal();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Create Account" }));
    fireEvent.change(screen.getByLabelText("Full Name"), { target: { value: "Ada Lovelace" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(signupOptions).toBeDefined();
    act(() => {
      signupOptions?.onSuccess({
        accessToken: "test-token",
        expiresInSeconds: 900,
        user: { id: "1", fullName: "Ada Lovelace", email: "ada@example.com" },
      });
    });

    expect(window.localStorage.getItem("specforge.auth.session")).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });
});
