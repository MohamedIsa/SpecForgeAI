import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BrdUploadZone, type UploadItem } from "./BrdUploadZone";

function makeItem(overrides: Partial<UploadItem> = {}): UploadItem {
  return {
    id: "item-1",
    fileName: "requirements.md",
    extension: "md",
    byteSize: 2048,
    progress: 0,
    state: "uploading",
    ...overrides,
  };
}

function makeFile(name: string): File {
  return new File(["content"], name, { type: "text/markdown" });
}

describe("BrdUploadZone — dropzone", () => {
  it("renders the dashed dropzone with accepted types and size limit", () => {
    render(<BrdUploadZone items={[]} onFilesSelected={vi.fn()} />);
    expect(screen.getByText("Drag and drop your BRD files here")).toBeInTheDocument();
    expect(screen.getByText("PDF, DOCX or MD · up to 25MB each")).toBeInTheDocument();
    expect(screen.getByTestId("brd-dropzone").className).toContain("border-dashed");
  });

  it("restricts the file picker to the accepted extensions and allows multiple", () => {
    render(<BrdUploadZone items={[]} onFilesSelected={vi.fn()} />);
    const input = screen.getByLabelText("Choose BRD files");
    expect(input).toHaveAttribute("accept", ".pdf,.docx,.md");
    expect(input).toHaveAttribute("multiple");
  });

  it("emits selected files from the file picker", () => {
    const onFilesSelected = vi.fn();
    render(<BrdUploadZone items={[]} onFilesSelected={onFilesSelected} />);

    fireEvent.change(screen.getByLabelText("Choose BRD files"), {
      target: { files: [makeFile("a.md"), makeFile("b.pdf")] },
    });

    expect(onFilesSelected).toHaveBeenCalledTimes(1);
    const emitted: File[] = onFilesSelected.mock.calls[0]?.[0];
    expect(emitted.map((file) => file.name)).toEqual(["a.md", "b.pdf"]);
  });

  it("emits dropped files", () => {
    const onFilesSelected = vi.fn();
    render(<BrdUploadZone items={[]} onFilesSelected={onFilesSelected} />);

    fireEvent.drop(screen.getByTestId("brd-dropzone"), {
      dataTransfer: { files: [makeFile("dropped.md")] },
    });

    expect(onFilesSelected).toHaveBeenCalledTimes(1);
  });

  it("ignores a drop containing no files", () => {
    const onFilesSelected = vi.fn();
    render(<BrdUploadZone items={[]} onFilesSelected={onFilesSelected} />);
    fireEvent.drop(screen.getByTestId("brd-dropzone"), { dataTransfer: { files: [] } });
    expect(onFilesSelected).not.toHaveBeenCalled();
  });

  it("highlights the zone while dragging and clears it on leave", () => {
    render(<BrdUploadZone items={[]} onFilesSelected={vi.fn()} />);
    const zone = screen.getByTestId("brd-dropzone");

    fireEvent.dragOver(zone);
    expect(zone.className).toContain("border-primary");

    fireEvent.dragLeave(zone);
    expect(zone.className).not.toContain("border-primary");
  });

  it("does not emit dropped files when disabled", () => {
    const onFilesSelected = vi.fn();
    render(<BrdUploadZone items={[]} onFilesSelected={onFilesSelected} disabled />);
    fireEvent.drop(screen.getByTestId("brd-dropzone"), {
      dataTransfer: { files: [makeFile("a.md")] },
    });
    expect(onFilesSelected).not.toHaveBeenCalled();
  });
});

describe("BrdUploadZone — file rows", () => {
  it("renders the file name and a human-readable size", () => {
    render(<BrdUploadZone items={[makeItem({ byteSize: 2048 })]} onFilesSelected={vi.fn()} />);
    expect(screen.getByText("requirements.md")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  it.each([
    ["pdf", "bg-priority-p0-bg"],
    ["docx", "bg-priority-p2-bg"],
    ["md", "bg-priority-p3-bg"],
  ])("renders the %s extension badge with its colour", (extension, expectedClass) => {
    render(
      <BrdUploadZone items={[makeItem({ extension })]} onFilesSelected={vi.fn()} />,
    );
    expect(screen.getByText(extension).className).toContain(expectedClass);
  });

  it("renders an animated progress bar while uploading", () => {
    render(<BrdUploadZone items={[makeItem({ state: "uploading", progress: 42 })]} onFilesSelected={vi.fn()} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("value", "42");
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("renders the Scanning pill with a spinner once the bytes are uploaded", () => {
    render(<BrdUploadZone items={[makeItem({ state: "scanning", progress: 100 })]} onFilesSelected={vi.fn()} />);
    expect(screen.getByText("Scanning")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("renders a green Clean pill and hides the progress bar when scanning succeeds", () => {
    render(<BrdUploadZone items={[makeItem({ state: "clean", progress: 100 })]} onFilesSelected={vi.fn()} />);
    const pill = screen.getByText("Clean");
    expect(pill.className).toContain("text-success");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("renders a red Threat Rejected pill and the malware warning card for an infected file", () => {
    render(<BrdUploadZone items={[makeItem({ state: "infected", progress: 100 })]} onFilesSelected={vi.fn()} />);
    const pill = screen.getByText("Threat Rejected");
    expect(pill.className).toContain("text-error");
    expect(
      screen.getByText("Malware signature detected — file was not stored"),
    ).toBeInTheDocument();
  });

  it("does not show the malware card for a merely rejected (non-infected) file", () => {
    render(
      <BrdUploadZone
        items={[makeItem({ state: "rejected", message: "File exceeds the 25MB limit" })]}
        onFilesSelected={vi.fn()}
      />,
    );
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(screen.getByText("File exceeds the 25MB limit")).toBeInTheDocument();
    expect(
      screen.queryByText("Malware signature detected — file was not stored"),
    ).not.toBeInTheDocument();
  });

  it("shows an error message for a failed upload", () => {
    render(
      <BrdUploadZone
        items={[makeItem({ state: "error", message: "Network error while uploading" })]}
        onFilesSelected={vi.fn()}
      />,
    );
    expect(screen.getByText("Network error while uploading")).toBeInTheDocument();
  });

  it("renders one row per file", () => {
    render(
      <BrdUploadZone
        items={[
          makeItem({ id: "a", fileName: "a.md" }),
          makeItem({ id: "b", fileName: "b.pdf", extension: "pdf" }),
        ]}
        onFilesSelected={vi.fn()}
      />,
    );
    expect(screen.getByText("a.md")).toBeInTheDocument();
    expect(screen.getByText("b.pdf")).toBeInTheDocument();
  });
});
