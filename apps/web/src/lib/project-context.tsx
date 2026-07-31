import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "specforge.workspace.currentProjectId";

interface ProjectContextValue {
  currentProjectId: string | null;
  setCurrentProjectId: (projectId: string) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

function readStoredProjectId(): string | null {
  return window.localStorage.getItem(STORAGE_KEY);
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [currentProjectId, setCurrentProjectIdState] = useState<string | null>(() =>
    readStoredProjectId(),
  );

  const setCurrentProjectId = useCallback((projectId: string) => {
    window.localStorage.setItem(STORAGE_KEY, projectId);
    setCurrentProjectIdState(projectId);
  }, []);

  const value = useMemo(
    () => ({ currentProjectId, setCurrentProjectId }),
    [currentProjectId, setCurrentProjectId],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjectWorkspace(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProjectWorkspace must be used within a ProjectProvider");
  }
  return ctx;
}
