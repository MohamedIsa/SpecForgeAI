import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IngestPage } from "./IngestPage";
import { ProjectProvider } from "@/lib/project-context";
import type { UploadOutcome } from "@/lib/brd-upload-client";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

const saveTechPreferencesMutate = vi.fn();
const listFilesInvalidate = vi.fn();
const getTechPreferencesInvalidate = vi.fn();
const uploadBrdFileMock = vi.fn();
const getValidAccessTokenMock = vi.fn();

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      brd: {
        listFiles: { invalidate: listFilesInvalidate },
        getTechPreferences: { invalidate: getTechPreferencesInvalidate },
      },
    }),
    brd: {
      saveTechPreferences: {
        useMutation: () => ({ mutate: saveTechPreferencesMutate, isPending: false }),
      },
    },
  },
}));

vi.mock("@/lib/access-token-store", () => ({
  getValidAccessToken: () => getValidAccessTokenMock(),
}));

vi.mock("@/lib/brd-upload-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/brd-upload-client")>();
  return {
    ...actual,
    uploadBrdFile: (request: Parameters<typeof actual.uploadBrdFile>[0]) =>
      uploadBrdFileMock(request),
  };
});

function makeFile(name: string, size = 1024): File {
  const file = new File(["content"], name, { type: "text/markdown" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function renderPage(
  projectId: string | null = PROJECT_ID,
  onNavigateToClarify = vi.fn(),
) {
  if (projectId) {
    window.localStorage.setItem("specforge.workspace.currentProjectId", projectId);
  }
  render(
    <ProjectProvider>
      <IngestPage onNavigateToClarify={onNavigateToClarify} />
    </ProjectProvider>,
  );
  return { onNavigateToClarify };
}

function selectFiles(files: File[]): void {
  fireEvent.change(screen.getByLabelText("Choose BRD files"), { target: { files } });
}

beforeEach(() => {
  window.localStorage.clear();
  saveTechPreferencesMutate.mockReset();
  listFilesInvalidate.mockReset();
  getTechPreferencesInvalidate.mockReset();
  uploadBrdFileMock.mockReset();
  getValidAccessTokenMock.mockReset().mockResolvedValue("test-token");
});

describe("IngestPage — project scope", () => {
  it("prompts to pick a project when none is selected", () => {
    renderPage(null);
    expect(
      screen.getByText("Select or create a project to ingest BRD files."),
    ).toBeInTheDocument();
  });

  it("renders the dropzone once a project is active", () => {
    renderPage();
    expect(screen.getByTestId("brd-dropzone")).toBeInTheDocument();
  });
});

describe("IngestPage — upload lifecycle", () => {
  it("shows upload progress, then Scanning, then a green Clean pill", async () => {
    let reportProgress: ((percent: number) => void) | undefined;
    uploadBrdFileMock.mockImplementation(
      (request: { onProgress: (percent: number) => void }) => {
        reportProgress = request.onProgress;
        return new Promise<UploadOutcome>(() => {
          // Left pending so the intermediate states stay observable.
        });
      },
    );

    renderPage();
    selectFiles([makeFile("requirements.md")]);

    await waitFor(() => expect(uploadBrdFileMock).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("Choose BRD files"), { target: { files: [] } });
    await waitFor(() => expect(reportProgress).toBeDefined());

    reportProgress?.(40);
    await waitFor(() => expect(screen.getByText("40%")).toBeInTheDocument());
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");

    reportProgress?.(100);
    await waitFor(() => expect(screen.getByText("Scanning")).toBeInTheDocument());
  });

  it("marks a file Clean and refreshes the stored file list on success", async () => {
    uploadBrdFileMock.mockResolvedValue({ status: "clean", id: "file-1" });

    renderPage();
    selectFiles([makeFile("requirements.md")]);

    await waitFor(() => expect(screen.getByText("Clean")).toBeInTheDocument());
    expect(listFilesInvalidate).toHaveBeenCalledWith({ projectId: PROJECT_ID });
    expect(await screen.findByText("requirements.md scanned clean and stored")).toBeInTheDocument();
  });

  it("shows Threat Rejected and the malware warning card for an infected file", async () => {
    uploadBrdFileMock.mockResolvedValue({
      status: "infected",
      signature: "Win.Test.EICAR_HDB-1",
      message: "Malware signature detected — file was not stored",
    });

    renderPage();
    selectFiles([makeFile("eicar.md")]);

    await waitFor(() => expect(screen.getByText("Threat Rejected")).toBeInTheDocument());
    expect(
      screen.getByText("Malware signature detected — file was not stored"),
    ).toBeInTheDocument();
    expect(listFilesInvalidate).not.toHaveBeenCalled();
  });

  it("rejects an oversized file client-side without calling the upload API", async () => {
    renderPage();
    selectFiles([makeFile("huge.pdf", 26 * 1024 * 1024)]);

    await waitFor(() => expect(screen.getByText("Rejected")).toBeInTheDocument());
    expect(uploadBrdFileMock).not.toHaveBeenCalled();
    // Surfaced both on the file row and in the toast.
    expect(screen.getAllByText(/exceeds the 25MB limit/).length).toBeGreaterThan(0);
  });

  it("rejects a disallowed extension client-side without calling the upload API", async () => {
    renderPage();
    selectFiles([makeFile("malware.exe")]);

    await waitFor(() => expect(screen.getByText("Rejected")).toBeInTheDocument());
    expect(uploadBrdFileMock).not.toHaveBeenCalled();
  });

  it("surfaces a network failure as an error row", async () => {
    uploadBrdFileMock.mockResolvedValue({
      status: "error",
      message: "Network error while uploading",
    });

    renderPage();
    selectFiles([makeFile("spec.md")]);

    await waitFor(() =>
      expect(screen.getByText("Network error while uploading")).toBeInTheDocument(),
    );
  });

  it("uploads several files in one selection, each with its own row", async () => {
    uploadBrdFileMock.mockResolvedValue({ status: "clean", id: "file-1" });

    renderPage();
    selectFiles([makeFile("a.md"), makeFile("b.pdf"), makeFile("c.docx")]);

    await waitFor(() => expect(screen.getAllByText("Clean")).toHaveLength(3));
    expect(uploadBrdFileMock).toHaveBeenCalledTimes(3);
  });

  it("passes the access token and project scope to the uploader", async () => {
    uploadBrdFileMock.mockResolvedValue({ status: "clean", id: "file-1" });

    renderPage();
    selectFiles([makeFile("spec.md")]);

    await waitFor(() => expect(uploadBrdFileMock).toHaveBeenCalled());
    const request: { token: string; projectId: string } = uploadBrdFileMock.mock.calls[0]?.[0];
    expect(request.token).toBe("test-token");
    expect(request.projectId).toBe(PROJECT_ID);
  });
});

describe("IngestPage — Proceed to AI Clarification", () => {
  it("is disabled before any file is uploaded", () => {
    renderPage();
    expect(screen.getByRole("button", { name: /Proceed to AI Clarification/ })).toBeDisabled();
  });

  it("becomes enabled once a clean file is ready", async () => {
    uploadBrdFileMock.mockResolvedValue({ status: "clean", id: "file-1" });

    renderPage();
    selectFiles([makeFile("spec.md")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Proceed to AI Clarification/ })).toBeEnabled(),
    );
    expect(screen.getByText("1 clean file ready")).toBeInTheDocument();
  });

  it("stays disabled when the only file was infected", async () => {
    uploadBrdFileMock.mockResolvedValue({
      status: "infected",
      signature: "Win.Test.EICAR_HDB-1",
      message: "Malware signature detected — file was not stored",
    });

    renderPage();
    selectFiles([makeFile("eicar.md")]);

    await waitFor(() => expect(screen.getByText("Threat Rejected")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Proceed to AI Clarification/ })).toBeDisabled();
  });

  it("stays disabled while a scan is still in flight", async () => {
    uploadBrdFileMock.mockImplementation(() => new Promise<UploadOutcome>(() => {}));

    renderPage();
    selectFiles([makeFile("spec.md")]);

    await waitFor(() => expect(uploadBrdFileMock).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /Proceed to AI Clarification/ })).toBeDisabled();
  });

  it("navigates to the clarify view when the CTA is pressed", async () => {
    uploadBrdFileMock.mockResolvedValue({ status: "clean", id: "file-1" });

    const { onNavigateToClarify } = renderPage();
    selectFiles([makeFile("spec.md")]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Proceed to AI Clarification/ })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Proceed to AI Clarification/ }));

    expect(onNavigateToClarify).toHaveBeenCalledTimes(1);
  });
});

describe("IngestPage — preferred tech stack", () => {
  it("keeps the form collapsed until the header is clicked", () => {
    renderPage();
    expect(screen.queryByLabelText("Frontend")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Preferred tech stack/ }));
    expect(screen.getByLabelText("Frontend")).toBeInTheDocument();
    expect(screen.getByLabelText("Backend")).toBeInTheDocument();
    expect(screen.getByLabelText("Database")).toBeInTheDocument();
    expect(screen.getByLabelText("Infra")).toBeInTheDocument();
  });

  it("toggles the expanded state on repeated clicks", () => {
    renderPage();
    const toggle = screen.getByRole("button", { name: /Preferred tech stack/ });

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Frontend")).not.toBeInTheDocument();
  });

  it("saves all four preference fields scoped to the active project", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Preferred tech stack/ }));

    fireEvent.change(screen.getByLabelText("Frontend"), { target: { value: "React + Vite" } });
    fireEvent.change(screen.getByLabelText("Backend"), { target: { value: "Fastify + tRPC" } });
    fireEvent.change(screen.getByLabelText("Database"), { target: { value: "PostgreSQL" } });
    fireEvent.change(screen.getByLabelText("Infra"), { target: { value: "Terraform" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    expect(saveTechPreferencesMutate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      frontend: "React + Vite",
      backend: "Fastify + tRPC",
      database: "PostgreSQL",
      infra: "Terraform",
    });
  });

  it("allows saving a partial set of preferences", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Preferred tech stack/ }));
    fireEvent.change(screen.getByLabelText("Database"), { target: { value: "PostgreSQL" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    expect(saveTechPreferencesMutate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      frontend: "",
      backend: "",
      database: "PostgreSQL",
      infra: "",
    });
  });
});
