import { useState } from "react";
import { Layout } from "./components/layout/Layout.tsx";
import { AuthModal } from "./components/auth/AuthModal.tsx";
import { SuccessToast } from "./components/ui/toast.tsx";
import type { SidebarView } from "./components/layout/Sidebar.tsx";
import { trpc } from "./trpc.ts";
import { useAuth } from "./lib/auth-context.tsx";
import { BoardPage } from "./pages/board/BoardPage.tsx";
import { IngestPage } from "./pages/ingest/IngestPage.tsx";
import { ClarifyPage } from "./pages/clarify/ClarifyPage.tsx";
import { BacklogReviewPage } from "./pages/backlog/BacklogReviewPage.tsx";

export function App() {
  const healthQuery = trpc.health.useQuery();
  const { session, isHydrating } = useAuth();
  const [view, setView] = useState<SidebarView>("dashboard");
  // Autostart is a one-shot signal from the Clarify CTA, not a property of
  // the "backlog" view itself — arriving here via the sidebar must not spend
  // an AI call the user didn't ask for.
  const [autoStartBacklog, setAutoStartBacklog] = useState(false);
  // Lives here, not in BacklogReviewPage: publishing navigates away and
  // unmounts that page, so a toast owned by it would vanish before anyone
  // could read it.
  const [globalToast, setGlobalToast] = useState<string | null>(null);

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
        <ClarifyPage
          onBacklogReady={() => {
            setAutoStartBacklog(true);
            setView("backlog");
          }}
        />
      ) : view === "backlog" ? (
        // The spec's "TanStack Router navigation to /board": this app has no
        // URL router, so publishing moves the view state to the board instead.
        <BacklogReviewPage
          autoStart={autoStartBacklog}
          onAutoStartConsumed={() => setAutoStartBacklog(false)}
          onPublished={(message) => {
            setGlobalToast(message);
            setView("board");
          }}
        />
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
      {globalToast && (
        <SuccessToast message={globalToast} onDismiss={() => setGlobalToast(null)} />
      )}
    </Layout>
  );
}
