import { useState, type SubmitEvent } from "react";
import { ChevronDownIcon, ChevronRightIcon, ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SuccessToast, ErrorToast } from "@/components/ui/toast";
import { trpc } from "@/trpc";
import { useProjectWorkspace } from "@/lib/project-context";
import { getValidAccessToken } from "@/lib/access-token-store";
import { extractExtension } from "@specforge/backend/brd-constants";
import {
  uploadBrdFile,
  validateFileBeforeUpload,
  type UploadOutcome,
} from "@/lib/brd-upload-client";
import { BrdUploadZone, type UploadItem } from "./BrdUploadZone";

let itemCounter = 0;
function nextItemId(): string {
  itemCounter += 1;
  return `upload-${Date.now()}-${itemCounter}`;
}

function outcomeToItem(outcome: UploadOutcome): Pick<UploadItem, "state" | "message"> {
  switch (outcome.status) {
    case "clean":
      return { state: "clean" };
    case "infected":
      return { state: "infected", message: outcome.message };
    case "rejected":
      return { state: "rejected", message: outcome.message };
    case "error":
      return { state: "error", message: outcome.message };
  }
}

export interface IngestPageProps {
  readonly onNavigateToClarify: () => void;
}

export function IngestPage({ onNavigateToClarify }: IngestPageProps) {
  const { currentProjectId } = useProjectWorkspace();
  const utils = trpc.useUtils();

  const [items, setItems] = useState<UploadItem[]>([]);
  const [isTechStackOpen, setIsTechStackOpen] = useState(false);
  const [frontend, setFrontend] = useState("");
  const [backend, setBackend] = useState("");
  const [database, setDatabase] = useState("");
  const [infra, setInfra] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const saveTechPreferences = trpc.brd.saveTechPreferences.useMutation({
    onSuccess: () => {
      if (currentProjectId) {
        void utils.brd.getTechPreferences.invalidate({ projectId: currentProjectId });
      }
      setSuccessMessage("Tech stack preferences saved");
    },
    onError: (error) => setErrorMessage(error.message),
  });

  function patchItem(id: string, patch: Partial<UploadItem>): void {
    setItems((previous) =>
      previous.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  async function handleFilesSelected(files: File[]): Promise<void> {
    if (!currentProjectId) {
      setErrorMessage("Select a project before uploading BRD files");
      return;
    }

    const token = await getValidAccessToken();

    await Promise.all(
      files.map(async (file) => {
        const id = nextItemId();
        const validation = validateFileBeforeUpload(file);

        setItems((previous) => [
          ...previous,
          {
            id,
            fileName: file.name,
            extension: extractExtension(file.name) ?? "file",
            byteSize: file.size,
            progress: 0,
            state: validation.ok ? "uploading" : "rejected",
            message: validation.ok ? undefined : validation.reason,
          },
        ]);

        if (!validation.ok) {
          setErrorMessage(`${file.name}: ${validation.reason}`);
          return;
        }

        const outcome = await uploadBrdFile({
          file,
          projectId: currentProjectId,
          token,
          onProgress: (percent) => {
            // Once every byte is on the wire the server is scanning, so the
            // row flips from the progress bar to the Scanning pill.
            patchItem(id, {
              progress: percent,
              state: percent >= 100 ? "scanning" : "uploading",
            });
          },
        });

        patchItem(id, { progress: 100, ...outcomeToItem(outcome) });

        if (outcome.status === "clean") {
          void utils.brd.listFiles.invalidate({ projectId: currentProjectId });
          setSuccessMessage(`${file.name} scanned clean and stored`);
        } else {
          setErrorMessage(`${file.name}: ${outcome.message}`);
        }
      }),
    );
  }

  function handleTechStackSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!currentProjectId) {
      setErrorMessage("Select a project before saving tech stack preferences");
      return;
    }
    saveTechPreferences.mutate({
      projectId: currentProjectId,
      frontend,
      backend,
      database,
      infra,
    });
  }

  const cleanCount = items.filter((item) => item.state === "clean").length;
  const hasInFlight = items.some(
    (item) => item.state === "uploading" || item.state === "scanning",
  );
  const canProceed = cleanCount > 0 && !hasInFlight;

  if (!currentProjectId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-sm">
        <p className="text-text-secondary">Select or create a project to ingest BRD files.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full min-w-0 overflow-y-auto">
      <div className="flex items-center justify-between px-lg h-14 shrink-0 border-b border-column-border w-full">
        <div className="flex items-center gap-sm min-w-0">
          <h1 className="text-sm font-semibold text-text-inverse truncate">Ingest BRD</h1>
          <span className="text-2xs text-text-secondary shrink-0">
            {cleanCount} clean {cleanCount === 1 ? "file" : "files"} ready
          </span>
        </div>
        <Button disabled={!canProceed} onClick={onNavigateToClarify}>
          Proceed to AI Clarification
          <ArrowRightIcon size={14} />
        </Button>
      </div>

      <div className="flex flex-col gap-lg p-lg max-w-4xl w-full mx-auto min-w-0">
        <BrdUploadZone
          items={items}
          onFilesSelected={(files) => {
            void handleFilesSelected(files);
          }}
        />

        <div className="rounded-2lg border border-modal-border bg-modal-bg">
          <button
            type="button"
            onClick={() => setIsTechStackOpen((open) => !open)}
            aria-expanded={isTechStackOpen}
            className="w-full flex items-center gap-sm px-md py-sm text-sm font-medium text-text-inverse cursor-pointer"
          >
            {isTechStackOpen ? (
              <ChevronDownIcon size={14} aria-hidden="true" />
            ) : (
              <ChevronRightIcon size={14} aria-hidden="true" />
            )}
            Preferred tech stack
            <span className="text-2xs font-normal text-text-secondary">(optional)</span>
          </button>

          {isTechStackOpen && (
            <form
              onSubmit={handleTechStackSubmit}
              className="flex flex-col gap-md border-t border-modal-border p-md"
            >
              <div className="grid grid-cols-2 gap-md">
                <div className="flex flex-col gap-xs">
                  <label htmlFor="tech-frontend" className="text-xs font-medium text-text-secondary">
                    Frontend
                  </label>
                  <Input
                    id="tech-frontend"
                    value={frontend}
                    onChange={(event) => setFrontend(event.target.value)}
                    placeholder="React + Vite"
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <label htmlFor="tech-backend" className="text-xs font-medium text-text-secondary">
                    Backend
                  </label>
                  <Input
                    id="tech-backend"
                    value={backend}
                    onChange={(event) => setBackend(event.target.value)}
                    placeholder="Fastify + tRPC"
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <label htmlFor="tech-database" className="text-xs font-medium text-text-secondary">
                    Database
                  </label>
                  <Input
                    id="tech-database"
                    value={database}
                    onChange={(event) => setDatabase(event.target.value)}
                    placeholder="PostgreSQL"
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <label htmlFor="tech-infra" className="text-xs font-medium text-text-secondary">
                    Infra
                  </label>
                  <Input
                    id="tech-infra"
                    value={infra}
                    onChange={(event) => setInfra(event.target.value)}
                    placeholder="Terraform on AWS"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button type="submit" disabled={saveTechPreferences.isPending}>
                  {saveTechPreferences.isPending ? "Saving..." : "Save preferences"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>

      {successMessage && (
        <SuccessToast message={successMessage} onDismiss={() => setSuccessMessage(null)} />
      )}
      {errorMessage && (
        <ErrorToast message={errorMessage} onDismiss={() => setErrorMessage(null)} />
      )}
    </div>
  );
}
