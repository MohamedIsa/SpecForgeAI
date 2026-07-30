import { FolderIcon, SearchIcon, BellIcon, PanelLeft } from "lucide-react";

export function Header({
  sidebarCollapsed,
  onToggleSidebar,
}: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  return (
    <header className="flex items-center shrink-0 px-lg h-14 border-b border-sidebar-border bg-header-bg">
      {sidebarCollapsed && (
        <button
          onClick={onToggleSidebar}
          className="mr-sm size-8 flex items-center justify-center rounded-md text-text-secondary hover:text-text-inverse hover:bg-text-inverse/5 transition-colors cursor-pointer shrink-0"
          aria-label="Expand sidebar"
        >
          <PanelLeft size={16} />
        </button>
      )}

      <div className="flex items-center gap-xs text-sm text-text-disabled">
        <FolderIcon size={14} className="shrink-0" />
        <span className="text-text-secondary">/</span>
        <span className="text-text-inverse font-medium">clarify</span>
        <span className="text-sidebar-item-border">·</span>
        <span className="flex items-center gap-1">
          <span className="inline-flex items-center justify-center size-4.5 rounded-full text-2xs font-semibold bg-primary text-text-inverse">
            3
          </span>
          <span className="text-text-secondary">open questions</span>
        </span>
      </div>

      <div className="flex items-center gap-sm ml-auto">
        <button className="flex items-center gap-sm px-sm py-1 rounded-md text-sm text-text-secondary bg-sidebar-item border border-sidebar-border transition-colors hover:text-text-disabled hover:border-sidebar-item-border cursor-pointer">
          <SearchIcon size={14} />
          <span className="hidden sm:inline">Search</span>
          <span className="px-1 py-px rounded text-2xs font-medium bg-sidebar-border text-text-secondary">
            &#8984;K
          </span>
        </button>

        <button
          className="relative size-8 flex items-center justify-center rounded-md text-text-secondary hover:text-text-inverse hover:bg-text-inverse/5 transition-colors cursor-pointer"
          aria-label="Notifications"
        >
          <BellIcon size={16} />
          <span className="absolute top-1 right-1 size-1.5 rounded-full bg-error" />
        </button>

        <div className="size-7 rounded-full flex items-center justify-center text-xs font-medium text-text-inverse bg-primary shrink-0">
          MI
        </div>
      </div>
    </header>
  );
}
