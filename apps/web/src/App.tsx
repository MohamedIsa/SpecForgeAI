import { useState } from "react";
import { Layout } from "./components/layout/Layout.tsx";
import { AuthModal } from "./components/auth/AuthModal.tsx";
import { SuccessToast } from "./components/ui/toast.tsx";
import { ProjectOnboardingWizard } from "./components/projects/ProjectOnboardingWizard.tsx";
import type { SidebarView } from "./components/layout/Sidebar.tsx";
import { trpc } from "./trpc.ts";
import { useAuth } from "./lib/auth-context.tsx";
import { useProjectWorkspace } from "./lib/project-context.tsx";
import { useLifecycleGating } from "./lib/use-lifecycle-gating.ts";
import { BoardPage } from "./pages/board/BoardPage.tsx";
import { IngestPage } from "./pages/ingest/IngestPage.tsx";
import { ClarifyPage } from "./pages/clarify/ClarifyPage.tsx";
import { BacklogReviewPage } from "./pages/backlog/BacklogReviewPage.tsx";

interface ActiveViewProps {
  view: SidebarView;
  autoStartBacklog: boolean;
  onAutoStartConsumed: () => void;
  onNavigateToClarify: () => void;
  onBacklogReady: () => void;
  onPublished: (message: string) => void;
}

function ActiveView({
  view,
  autoStartBacklog,
  onAutoStartConsumed,
  onNavigateToClarify,
  onBacklogReady,
  onPublished,
}: ActiveViewProps) {
  if (view === "ingest") {
    return <IngestPage onNavigateToClarify={onNavigateToClarify} />;
  }
  if (view === "clarify") {
    return <ClarifyPage onBacklogReady={onBacklogReady} />;
  }
  if (view === "backlog") {
    // The spec's "TanStack Router navigation to /board": this app has no
    // URL router, so publishing moves the view state to the board instead.
    return (
      <BacklogReviewPage
        autoStart={autoStartBacklog}
        onAutoStartConsumed={onAutoStartConsumed}
        onPublished={onPublished}
      />
    );
  }
  return <BoardPage />;
}

export function App() {
  trpc.health.useQuery();
  const { session, isHydrating } = useAuth();
  const { currentProjectId, isOnboarding, stopOnboarding } = useProjectWorkspace();
  const projectsQuery = trpc.project.listUserProjects.useQuery(undefined, {
    enabled: Boolean(session),
  });
  const { unlocked } = useLifecycleGating(currentProjectId);

  const [view, setView] = useState<SidebarView>("dashboard");
  // Autostart is a one-shot signal from the Clarify CTA, not a property of
  // the "backlog" view itself — arriving here via the sidebar must not spend
  // an AI call the user didn't ask for.
  const [autoStartBacklog, setAutoStartBacklog] = useState(false);
  // Lives here, not in BacklogReviewPage: publishing navigates away and
  // unmounts that page, so a toast owned by it would vanish before anyone
  // could read it.
  const [globalToast, setGlobalToast] = useState<string | null>(null);

  function handleNavigate(nextView: SidebarView): void {
    // Defense in depth alongside Sidebar's own click-guard: a locked stage
    // is never actually reachable, no matter how navigation is triggered.
    if (!unlocked[nextView]) return;
    setView(nextView);
  }

  if (isHydrating) {
    return null;
  }

  if (!session) {
    return <AuthModal />;
  }

  const hasNoProjects = projectsQuery.data !== undefined && projectsQuery.data.length === 0;

  if (hasNoProjects || isOnboarding) {
    return (
      <ProjectOnboardingWizard
        // A user with an existing project can cancel back out of "New
        // workspace"; a brand-new account with zero projects has nothing to
        // cancel back to, so the flow is mandatory until one is created.
        onCancel={hasNoProjects ? undefined : stopOnboarding}
        onCreated={(message) => {
          stopOnboarding();
          setGlobalToast(message);
        }}
      />
    );
  }

  return (
    <Layout activeView={view} onNavigate={handleNavigate} unlocked={unlocked}>
      <ActiveView
        view={view}
        autoStartBacklog={autoStartBacklog}
        onAutoStartConsumed={() => setAutoStartBacklog(false)}
        onNavigateToClarify={() => handleNavigate("clarify")}
        onBacklogReady={() => {
          setAutoStartBacklog(true);
          handleNavigate("backlog");
        }}
        onPublished={(message) => {
          setGlobalToast(message);
          setView("board");
        }}
      />
      {globalToast && (
        <SuccessToast message={globalToast} onDismiss={() => setGlobalToast(null)} />
      )}
    </Layout>
  );
}
