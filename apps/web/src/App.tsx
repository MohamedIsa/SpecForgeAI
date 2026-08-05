import { useState } from "react";
import { Layout } from "./components/layout/Layout.tsx";
import { AuthModal } from "./components/auth/AuthModal.tsx";
import type { SidebarView } from "./components/layout/Sidebar.tsx";
import { trpc } from "./trpc.ts";
import { useAuth } from "./lib/auth-context.tsx";
import { BoardPage } from "./pages/board/BoardPage.tsx";
import { IngestPage } from "./pages/ingest/IngestPage.tsx";
import { ClarifyPage } from "./pages/clarify/ClarifyPage.tsx";

export function App() {
  const healthQuery = trpc.health.useQuery();
  const { session, isHydrating } = useAuth();
  const [view, setView] = useState<SidebarView>("dashboard");

  if (isHydrating) {
    return null;
  }

  if (!session) {
    return <AuthModal />;
  }

  return (
    <Layout activeView={view} onNavigate={setView}>
      {view === "board" ? (
        <BoardPage />
      ) : view === "ingest" ? (
        <IngestPage onNavigateToClarify={() => setView("clarify")} />
      ) : view === "clarify" ? (
        // AC5's "redirect to the backlog generator": the board is the backlog,
        // and navigation here is view state (this app has no URL router).
        <ClarifyPage onBacklogReady={() => setView("board")} />
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-md">
          <h1 className="text-2xl font-semibold text-text">SpecForge AI</h1>
          <p className="text-text-secondary">
            Backend status:{" "}
            {healthQuery.isLoading
              ? "Connecting..."
              : healthQuery.data
                ? healthQuery.data.status
                : "Unreachable"}
          </p>
        </div>
      )}
    </Layout>
  );
}
