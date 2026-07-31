import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc";
import type { RouterInputs } from "@/trpc";
import { inviteMemberInput } from "@specforge/backend/validation";

type MembershipRole = RouterInputs["project"]["inviteMember"]["role"];

const ROLES: Array<{ value: MembershipRole; label: string }> = [
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
  { value: "owner", label: "Owner" },
];

function isMembershipRole(value: string): value is MembershipRole {
  return value === "owner" || value === "editor" || value === "viewer";
}

export function InviteMembersModal({
  open,
  projectId,
  onClose,
  onInvited,
}: {
  open: boolean;
  projectId: string | null;
  onClose: () => void;
  onInvited: (message: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MembershipRole>("editor");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const inviteMemberMutation = trpc.project.inviteMember.useMutation({
    onSuccess: () => {
      onInvited(`Invited ${email} as ${role}`);
      resetForm();
      onClose();
    },
    onError: (error) => setErrorMessage(error.message),
  });

  function resetForm() {
    setEmail("");
    setRole("editor");
    setErrorMessage(null);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function handleRoleChange(value: string) {
    if (isMembershipRole(value)) setRole(value);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    if (!projectId) return;

    const result = inviteMemberInput.safeParse({ projectId, email, role });
    if (!result.success) {
      setErrorMessage(result.error.issues[0]?.message ?? "Please check your details and try again.");
      return;
    }
    inviteMemberMutation.mutate(result.data);
  }

  if (!open || !projectId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[420px] rounded-2lg border border-modal-border bg-modal-bg p-lg">
        <h2 className="text-lg font-semibold text-text-inverse mb-md">Invite team members</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-md" noValidate>
          <div className="flex flex-col gap-xs">
            <label htmlFor="invite-email" className="text-xs font-medium text-text-secondary">
              Email
            </label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              hasError={Boolean(errorMessage)}
              required
            />
          </div>

          <div className="flex flex-col gap-xs">
            <label htmlFor="invite-role" className="text-xs font-medium text-text-secondary">
              Role
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(event) => handleRoleChange(event.target.value)}
              className="h-9 w-full rounded-md border border-modal-border bg-input-bg px-sm text-sm text-text-inverse focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
            >
              {ROLES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {errorMessage && <p className="text-xs text-error">{errorMessage}</p>}

          <div className="flex justify-end gap-sm mt-sm">
            <Button type="button" variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={inviteMemberMutation.isPending}
              className="bg-gradient-to-r from-primary to-secondary"
            >
              {inviteMemberMutation.isPending ? "Inviting..." : "Send invite"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
