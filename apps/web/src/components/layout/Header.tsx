import { FolderIcon, SearchIcon, BellIcon, PanelLeft } from "lucide-react";
import { useProjectWorkspace } from "@/lib/project-context";
import { trpc } from "@/trpc";
import type { SidebarView } from "./Sidebar.tsx";
import { UserMenu } from "./UserMenu.tsx";

const STAGE_LABELS: Record<SidebarView, string> = {
  dashboard: "Overview",
  ingest: "1. Ingest BRD",
  clarify: "2. AI Clarification",
  backlog: "3. Backlog Review",
  board: "4. Kanban Board",
};

export function Header({
  sidebarCollapsed,
  onToggleSidebar,
  activeView = "dashboard",
}: {
  readonly sidebarCollapsed: boolean;
  readonly onToggleSidebar: () => void;
  readonly activeView?: SidebarView;
}) {
  const { currentProjectId } = useProjectWorkspace();
  const projectsQuery = trpc.project.listUserProjects.useQuery();
  const currentProject = projectsQuery.data?.find((p) => p.id === currentProjectId);

  const stageTitle = STAGE_LABELS[activeView] ?? "Overview";

  return (
    <header className="flex items-center shrink-0 px-lg h-14 border-b border-sidebar-border bg-header-bg w-full min-w-0">
      {sidebarCollapsed && (
        <button
          type="button"
          onClick={onToggleSidebar}
          className="mr-sm size-8 flex items-center justify-center rounded-md text-text-secondary hover:text-text-inverse hover:bg-text-inverse/5 transition-colors cursor-pointer shrink-0"
          aria-label="Expand sidebar"
        >
          <PanelLeft size={16} />
        </button>
      )}

      <div className="flex items-center gap-xs text-sm text-text-disabled min-w-0">
        <FolderIcon size={14} className="shrink-0 text-primary" />
        <span className="text-text-secondary">/</span>
        <span className="text-text-inverse font-medium truncate">
          {currentProject?.name ?? "SpecForge AI"}
        </span>
        <span className="text-sidebar-item-border">/</span>
        <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-primary/10 text-primary border border-primary/20 shrink-0">
          {stageTitle}
        </span>
      </div>

      <div className="flex items-center gap-sm ml-auto shrink-0">
        <button
          type="button"
          className="flex items-center gap-sm px-sm py-1 rounded-md text-sm text-text-secondary bg-sidebar-item border border-sidebar-border transition-colors hover:text-text-disabled hover:border-sidebar-item-border cursor-pointer"
        >
          <SearchIcon size={14} />
          <span className="hidden sm:inline">Search</span>
          <span className="px-1 py-px rounded text-2xs font-medium bg-sidebar-border text-text-secondary">
            &#8984;K
          </span>
        </button>

        <button
          type="button"
          className="relative size-8 flex items-center justify-center rounded-md text-text-secondary hover:text-text-inverse hover:bg-text-inverse/5 transition-colors cursor-pointer"
          aria-label="Notifications"
        >
          <BellIcon size={16} />
          <span className="absolute top-1 right-1 size-1.5 rounded-full bg-error" />
        </button>

        <UserMenu variant="header" />
      </div>
    </header>
  );
}
