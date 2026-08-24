import { ChevronsLeftRightIcon, LockIcon } from "lucide-react";
import { ProjectPicker } from "@/components/projects/ProjectPicker";
import { UserMenu } from "./UserMenu";

const NAV_ITEMS = [
  { label: "Dashboard", view: "dashboard", icon: "□", badge: undefined as number | undefined },
  { label: "1. Ingest BRD", view: "ingest", icon: "↓", badge: undefined as number | undefined },
  { label: "2. AI Clarification", view: "clarify", icon: "?", badge: undefined as number | undefined },
  { label: "3. Backlog Review", view: "backlog", icon: "☰", badge: undefined as number | undefined },
  { label: "4. Kanban Board", view: "board", icon: "▥", badge: undefined as number | undefined },
] as const;

export type SidebarView = (typeof NAV_ITEMS)[number]["view"];

function navItemClassName(isUnlocked: boolean, isActive: boolean): string {
  if (!isUnlocked) {
    return "text-text-disabled/50 cursor-not-allowed";
  }
  const activeClass = isActive
    ? "text-text-inverse bg-text-inverse/[0.04]"
    : "text-text-disabled";
  return `hover:bg-text-inverse/[0.04] hover:text-text-inverse cursor-pointer ${activeClass}`;
}

const ALL_UNLOCKED: Record<SidebarView, boolean> = {
  dashboard: true,
  ingest: true,
  clarify: true,
  backlog: true,
  board: true,
};

export function Sidebar({
  collapsed,
  onToggle,
  activeView = "dashboard",
  onNavigate = () => {},
  unlocked = ALL_UNLOCKED,
}: {
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly activeView?: SidebarView;
  readonly onNavigate?: (view: SidebarView) => void;
  /** Which stages are reachable for the current project — see useLifecycleGating. */
  readonly unlocked?: Record<SidebarView, boolean>;
}) {
  return (
    <aside
      className={`flex flex-col h-full border-r border-sidebar-border bg-sidebar-bg shrink-0 transition-all duration-200 overflow-hidden ${collapsed ? "w-0" : "w-60"}`}
    >
      <div className="flex items-center justify-between px-md h-14 shrink-0">
        <div className="flex items-center gap-sm">
          <div className="size-7 rounded-md flex items-center justify-center text-sm font-bold bg-primary text-text-inverse">
            S
          </div>
          <span className="font-semibold text-sm text-text-inverse whitespace-nowrap">
            SpecForge AI
          </span>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="size-6 flex items-center justify-center rounded text-text-secondary hover:text-text-inverse hover:bg-text-inverse/5 transition-colors cursor-pointer"
          aria-label="Toggle sidebar"
        >
          <ChevronsLeftRightIcon size={14} />
        </button>
      </div>

      <ProjectPicker />

      <nav className="flex-1 px-sm">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const isUnlocked = unlocked[item.view];
            return (
              <li key={item.label}>
                <button
                  type="button"
                  onClick={() => {
                    if (isUnlocked) onNavigate(item.view);
                  }}
                  disabled={!isUnlocked}
                  aria-current={activeView === item.view ? "page" : undefined}
                  aria-disabled={!isUnlocked}
                  title={isUnlocked ? undefined : "Complete the previous stage to unlock this"}
                  className={`w-full flex items-center gap-sm px-sm py-1.5 rounded-md text-sm transition-colors whitespace-nowrap ${navItemClassName(isUnlocked, activeView === item.view)}`}
                >
                  <span className="size-4 flex items-center justify-center text-xs">
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                  {item.badge && (
                    <span className="ml-auto px-1.5 py-px rounded-full text-2xs font-medium bg-primary text-text-inverse">
                      {item.badge}
                    </span>
                  )}
                  {!isUnlocked && (
                    <LockIcon
                      size={12}
                      className="ml-auto text-text-disabled/60"
                      aria-label="Locked"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <UserMenu variant="sidebar" />
    </aside>
  );
}
