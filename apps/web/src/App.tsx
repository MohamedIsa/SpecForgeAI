import { Layout } from "./components/layout/Layout.tsx";
import { trpc } from "./trpc.ts";

export function App() {
  const healthQuery = trpc.health.useQuery();

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
