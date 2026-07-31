import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { InviteMembersModal } from "./InviteMembersModal";

interface MutationOptions {
  onSuccess: () => void;
  onError: (error: { message: string }) => void;
}

let mutationOptions: MutationOptions | undefined;
const mutate = vi.fn();

vi.mock("@/trpc", () => ({
  trpc: {
    project: {
      inviteMember: {
        useMutation: (options: MutationOptions) => {
          mutationOptions = options;
          return { mutate, isPending: false };
        },
      },
    },
  },
}));

beforeEach(() => {
  mutate.mockReset();
  mutationOptions = undefined;
});

describe("InviteMembersModal", () => {
  it("does not render when closed", () => {
    render(
      <InviteMembersModal
        open={false}
        projectId="11111111-1111-1111-1111-111111111111"
        onClose={vi.fn()}
        onInvited={vi.fn()}
      />,
    );
    expect(screen.queryByText("Invite team members")).not.toBeInTheDocument();
  });

  it("does not render when there is no active project", () => {
    render(
      <InviteMembersModal open projectId={null} onClose={vi.fn()} onInvited={vi.fn()} />,
    );
    expect(screen.queryByText("Invite team members")).not.toBeInTheDocument();
  });

  it("defaults the role selector to Editor", () => {
    render(
      <InviteMembersModal open projectId="11111111-1111-1111-1111-111111111111" onClose={vi.fn()} onInvited={vi.fn()} />,
    );
    const select = screen.getByLabelText("Role") as HTMLSelectElement;
    expect(select.value).toBe("editor");
  });

  it("lists Editor, Viewer, and Owner as role options", () => {
    render(
      <InviteMembersModal open projectId="11111111-1111-1111-1111-111111111111" onClose={vi.fn()} onInvited={vi.fn()} />,
    );
    const select = screen.getByLabelText("Role") as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((option) => option.textContent);
    expect(optionLabels).toEqual(["Editor", "Viewer", "Owner"]);
  });

  it("submits the invite mutation with the selected role", () => {
    render(
      <InviteMembersModal open projectId="11111111-1111-1111-1111-111111111111" onClose={vi.fn()} onInvited={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "teammate@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "viewer" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    expect(mutate).toHaveBeenCalledWith({
      projectId: "11111111-1111-1111-1111-111111111111",
      email: "teammate@example.com",
      role: "viewer",
    });
  });

  it("blocks submission and shows a friendly message for an invalid email, without calling the mutation", () => {
    render(
      <InviteMembersModal
        open
        projectId="11111111-1111-1111-1111-111111111111"
        onClose={vi.fn()}
        onInvited={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
  });

  it("shows an inline error message when the invite fails", () => {
    render(
      <InviteMembersModal open projectId="11111111-1111-1111-1111-111111111111" onClose={vi.fn()} onInvited={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "teammate@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    expect(mutationOptions).toBeDefined();
    act(() => {
      mutationOptions?.onError({ message: "This user is already a member of the project" });
    });
    expect(
      screen.getByText("This user is already a member of the project"),
    ).toBeInTheDocument();
  });

  it("calls onInvited and closes the modal after a successful invite", () => {
    const onClose = vi.fn();
    const onInvited = vi.fn();
    render(
      <InviteMembersModal
        open
        projectId="11111111-1111-1111-1111-111111111111"
        onClose={onClose}
        onInvited={onInvited}
      />,
    );
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "teammate@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    expect(mutationOptions).toBeDefined();
    act(() => {
      mutationOptions?.onSuccess();
    });
    expect(onInvited).toHaveBeenCalledWith("Invited teammate@example.com as editor");
    expect(onClose).toHaveBeenCalled();
  });
});
