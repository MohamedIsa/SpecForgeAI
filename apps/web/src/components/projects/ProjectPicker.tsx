import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, PlusIcon, UserPlusIcon } from "lucide-react";
import { trpc } from "@/trpc";
import { useProjectWorkspace } from "@/lib/project-context";
import { InviteMembersModal } from "./InviteMembersModal";
import { SuccessToast } from "@/components/ui/toast";

export function ProjectPicker() {
  const { currentProjectId, setCurrentProjectId, startOnboarding } = useProjectWorkspace();
  const projectsQuery = trpc.project.listUserProjects.useQuery();
  const [isOpen, setIsOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const projects = projectsQuery.data ?? [];
  const currentProject =
    projects.find((project) => project.id === currentProjectId) ?? projects[0];

  useEffect(() => {
    if (!currentProjectId && projectsQuery.data && projectsQuery.data.length > 0) {
      const first = projectsQuery.data[0];
      if (first) setCurrentProjectId(first.id);
    }
  }, [currentProjectId, projectsQuery.data, setCurrentProjectId]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative px-md pb-md" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        aria-label="Workspace switcher"
        className="w-full flex items-center justify-between px-sm py-1.5 rounded-md text-sm text-text-disabled bg-sidebar-item border border-sidebar-border transition-colors hover:text-text-inverse hover:border-sidebar-item-border cursor-pointer"
      >
        <span className="truncate">
          {currentProject ? currentProject.name : "Select project..."}
        </span>
        <ChevronDownIcon size={12} />
      </button>

      {isOpen && (
        <div className="absolute left-md right-md top-full mt-xs z-40 rounded-md border border-modal-border bg-modal-bg shadow-lg overflow-hidden">
          {currentProject && (
            <div className="flex items-center justify-between px-sm py-sm border-b border-modal-border">
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium text-text-inverse truncate">
                  {currentProject.name}
                </span>
                <span className="text-2xs text-text-secondary">
                  {`${currentProject.memberCount} member${currentProject.memberCount === 1 ? "" : "s"}`}
                </span>
              </div>
              <span className="px-1.5 py-px rounded-full text-2xs font-medium bg-secondary text-text-inverse shrink-0">
                Pro
              </span>
            </div>
          )}

          <ul className="max-h-48 overflow-auto py-1">
            {projects.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  onClick={() => {
                    setCurrentProjectId(project.id);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-sm py-1.5 text-sm text-left transition-colors hover:bg-text-inverse/[0.04] cursor-pointer ${
                    project.id === currentProject?.id ? "text-text-inverse" : "text-text-disabled"
                  }`}
                >
                  <span className="truncate">{project.name}</span>
                  <span className="text-2xs font-mono text-text-secondary shrink-0">
                    {project.key}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="border-t border-modal-border py-1">
            <button
              type="button"
              onClick={() => {
                setIsInviteOpen(true);
                setIsOpen(false);
              }}
              disabled={!currentProject}
              className="w-full flex items-center gap-sm px-sm py-1.5 text-sm text-text-disabled hover:text-text-inverse hover:bg-text-inverse/[0.04] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <UserPlusIcon size={14} />
              Invite team members
            </button>
            <button
              type="button"
              onClick={() => {
                startOnboarding();
                setIsOpen(false);
              }}
              className="w-full flex items-center gap-sm px-sm py-1.5 text-sm text-text-disabled hover:text-text-inverse hover:bg-text-inverse/[0.04] transition-colors cursor-pointer"
            >
              <PlusIcon size={14} />
              New workspace
            </button>
          </div>
        </div>
      )}

      <InviteMembersModal
        open={isInviteOpen}
        projectId={currentProject?.id ?? null}
        onClose={() => setIsInviteOpen(false)}
        onInvited={(message) => setSuccessMessage(message)}
      />

      {successMessage && (
        <SuccessToast message={successMessage} onDismiss={() => setSuccessMessage(null)} />
      )}
    </div>
  );
}
