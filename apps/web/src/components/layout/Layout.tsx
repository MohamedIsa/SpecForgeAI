import { useState, type ReactNode } from "react";
import { Sidebar, type SidebarView } from "./Sidebar.tsx";
import { Header } from "./Header.tsx";

export function Layout({
  children,
  activeView,
  onNavigate,
}: {
  children: ReactNode;
  activeView?: SidebarView;
  onNavigate?: (view: SidebarView) => void;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-header-bg">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((v) => !v)}
        activeView={activeView}
        onNavigate={onNavigate}
      />
      <div className="flex flex-1 flex-col min-w-0 w-full h-full">
        <Header
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          activeView={activeView}
        />
        <main className="flex-1 overflow-auto w-full min-w-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(37,99,235,0.08),transparent)]">
          {children}
        </main>
      </div>
    </div>
  );
}
