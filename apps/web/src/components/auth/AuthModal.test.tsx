import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { AuthModal } from "./AuthModal";
import { AuthProvider } from "@/lib/auth-context";

interface MutationResult {
  token: string;
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
}));

function renderModal() {
  return render(
    <AuthProvider>
      <AuthModal />
    </AuthProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  signupMutate.mockReset();
  loginMutate.mockReset();
  signupOptions = undefined;
  loginOptions = undefined;
});

describe("AuthModal", () => {
  it("renders the Login tab by default without a Full Name field", () => {
    renderModal();
    expect(screen.getByRole("tab", { name: "Login" })).toHaveAttribute("data-state", "active");
    expect(screen.queryByLabelText("Full Name")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("reveals the Full Name field when switching to Create Account", () => {
    renderModal();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Create Account" }));
    expect(screen.getByLabelText("Full Name")).toBeInTheDocument();
  });

  it("toggles password visibility via the eye icon", () => {
    renderModal();
    const passwordInput = screen.getByLabelText("Password") as HTMLInputElement;
    expect(passwordInput.type).toBe("password");
    fireEvent.click(screen.getByLabelText("Show password"));
    expect(passwordInput.type).toBe("text");
    fireEvent.click(screen.getByLabelText("Hide password"));
    expect(passwordInput.type).toBe("password");
  });

  it("toggles the remember me checkbox", () => {
    renderModal();
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toHaveAttribute("data-state", "unchecked");
    fireEvent.click(checkbox);
    expect(checkbox).toHaveAttribute("data-state", "checked");
  });

  it("submits login credentials via the login mutation", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter22222" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(loginMutate).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "hunter22222",
    });
  });

  it("shows a shake animation, inline error, and toast banner on login failure", () => {
    renderModal();
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

  it("blocks login submission and shows the Zod message for an invalid email, without calling the login mutation", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter22222" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(loginMutate).not.toHaveBeenCalled();
    expect(screen.getAllByText("Enter a valid email address").length).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("blocks signup submission and shows the Zod message for a password under 8 characters, without calling the signup mutation", () => {
    renderModal();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Create Account" }));
    fireEvent.change(screen.getByLabelText("Full Name"), { target: { value: "Ada Lovelace" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(signupMutate).not.toHaveBeenCalled();
    expect(screen.getAllByText("Password must be at least 8 characters").length).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("stores the session after a successful signup", () => {
    renderModal();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Create Account" }));
    fireEvent.change(screen.getByLabelText("Full Name"), { target: { value: "Ada Lovelace" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(signupOptions).toBeDefined();
    act(() => {
      signupOptions?.onSuccess({
        token: "test-token",
        user: { id: "1", fullName: "Ada Lovelace", email: "ada@example.com" },
      });
    });

    expect(window.localStorage.getItem("specforge.auth.session")).toContain("test-token");
  });
});
