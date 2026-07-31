import { Layout } from "./components/layout/Layout.tsx";
import { AuthModal } from "./components/auth/AuthModal.tsx";
import { trpc } from "./trpc.ts";
import { useAuth } from "./lib/auth-context.tsx";

export function App() {
  const healthQuery = trpc.health.useQuery();
  const { session } = useAuth();

  if (!session) {
    return <AuthModal />;
  }

  return (
    <Layout>
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
    </Layout>
  );
}
