import { ChevronsLeftRightIcon } from "lucide-react";
import { ProjectPicker } from "@/components/projects/ProjectPicker";

const NAV_ITEMS = [
  { label: "Dashboard", view: "dashboard", icon: "□", badge: undefined as number | undefined },
  { label: "Ingest", view: "ingest", icon: "↓", badge: undefined as number | undefined },
  { label: "Clarify", view: "clarify", icon: "?", badge: 3 },
  { label: "Backlog", view: "backlog", icon: "☰", badge: undefined as number | undefined },
  { label: "Board", view: "board", icon: "▥", badge: undefined as number | undefined },
] as const;

export type SidebarView = (typeof NAV_ITEMS)[number]["view"];

export function Sidebar({
  collapsed,
  onToggle,
  activeView = "dashboard",
  onNavigate = () => {},
}: {
  collapsed: boolean;
  onToggle: () => void;
  activeView?: SidebarView;
  onNavigate?: (view: SidebarView) => void;
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
          {NAV_ITEMS.map((item) => (
            <li key={item.label}>
              <button
                type="button"
                onClick={() => onNavigate(item.view)}
                aria-current={activeView === item.view ? "page" : undefined}
                className={`w-full flex items-center gap-sm px-sm py-1.5 rounded-md text-sm transition-colors hover:bg-text-inverse/[0.04] hover:text-text-inverse whitespace-nowrap cursor-pointer ${
                  activeView === item.view ? "text-text-inverse bg-text-inverse/[0.04]" : "text-text-disabled"
                }`}
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
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex items-center gap-sm px-md py-sm mx-sm mb-sm rounded-md bg-sidebar-item">
        <div className="relative shrink-0">
          <div className="size-7 rounded-full flex items-center justify-center text-xs font-medium text-text-inverse bg-primary">
            MI
          </div>
          <div className="absolute -bottom-px -right-px size-3.5 rounded-full flex items-center justify-center border-2 border-sidebar-bg text-3xs font-bold uppercase tracking-wide bg-warning text-text">
            O
          </div>
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-text-inverse leading-tight whitespace-nowrap">
            Mohamed Isa
          </span>
          <span className="text-2xs font-semibold text-warning uppercase tracking-wide whitespace-nowrap">
            Owner
          </span>
        </div>
      </div>
    </aside>
  );
}
