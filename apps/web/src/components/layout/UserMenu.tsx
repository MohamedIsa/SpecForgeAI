import { useEffect, useRef, useState } from "react";
import { LogOutIcon } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useProjectWorkspace } from "@/lib/project-context";
import { trpc } from "@/trpc";
import { getInitials } from "@/lib/initials";

export function UserMenu({ variant }: { readonly variant: "sidebar" | "header" }) {
  const { session, logout } = useAuth();
  const { currentProjectId } = useProjectWorkspace();
  const projectsQuery = trpc.project.listUserProjects.useQuery();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!session) return null;

  const { user } = session;
  const role = projectsQuery.data?.find((project) => project.id === currentProjectId)?.role;
  const initials = getInitials(user.fullName);

  async function handleLogout(): Promise<void> {
    setIsLoggingOut(true);
    setIsOpen(false);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  }

  const menuPanel = (
    <div
      role="menu"
      aria-label="User menu"
      className={`absolute z-40 w-56 rounded-md border border-modal-border bg-modal-bg shadow-lg overflow-hidden ${
        variant === "sidebar" ? "bottom-full left-0 mb-xs" : "top-full right-0 mt-xs"
      }`}
    >
      <div className="flex items-center gap-sm px-sm py-sm border-b border-modal-border">
        <div className="size-8 rounded-full flex items-center justify-center text-xs font-medium text-text-inverse bg-primary shrink-0">
          {initials}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-text-inverse truncate">{user.fullName}</span>
          <span className="text-2xs text-text-secondary truncate">{user.email}</span>
        </div>
      </div>
      {role && (
        <div className="px-sm py-xs border-b border-modal-border">
          <span className="text-2xs font-semibold text-warning uppercase tracking-wide">
            {role}
          </span>
        </div>
      )}
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          void handleLogout();
        }}
        disabled={isLoggingOut}
        className="w-full flex items-center gap-sm px-sm py-1.5 text-sm text-text-disabled hover:text-text-inverse hover:bg-text-inverse/[0.04] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <LogOutIcon size={14} />
        {isLoggingOut ? "Logging out..." : "Log out"}
      </button>
    </div>
  );

  if (variant === "header") {
    return (
      <div className="relative" ref={containerRef}>
        <button
          type="button"
          onClick={() => setIsOpen((value) => !value)}
          aria-label="User menu"
          aria-expanded={isOpen}
          className="size-7 rounded-full flex items-center justify-center text-xs font-medium text-text-inverse bg-primary shrink-0 cursor-pointer"
        >
          {initials}
        </button>
        {isOpen && menuPanel}
      </div>
    );
  }

  return (
    <div className="relative px-sm mb-sm" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        aria-label="User menu"
        aria-expanded={isOpen}
        className="w-full flex items-center gap-sm px-sm py-sm rounded-md bg-sidebar-item hover:bg-sidebar-item/80 transition-colors cursor-pointer"
      >
        <div className="size-7 rounded-full flex items-center justify-center text-xs font-medium text-text-inverse bg-primary shrink-0">
          {initials}
        </div>
        <div className="flex flex-col min-w-0 text-left">
          <span className="text-sm font-medium text-text-inverse leading-tight truncate">
            {user.fullName}
          </span>
          {role && (
            <span className="text-2xs font-semibold text-warning uppercase tracking-wide truncate">
              {role}
            </span>
          )}
        </div>
      </button>
      {isOpen && menuPanel}
    </div>
  );
}
