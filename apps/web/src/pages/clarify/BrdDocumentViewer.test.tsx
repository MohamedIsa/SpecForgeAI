import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BrdDocumentViewer } from "./BrdDocumentViewer";

type Document = Parameters<typeof BrdDocumentViewer>[0]["documents"][number];

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    fileId: "file-1",
    fileName: "requirements.md",
    extension: "md",
    pages: [{ pageNumber: 1, text: "Overview line\nThe system must authenticate users" }],
    ...overrides,
  };
}

describe("BrdDocumentViewer — empty state", () => {
  it("explains when there are no documents", () => {
    render(<BrdDocumentViewer documents={[]} />);
    expect(screen.getByText("No BRD documents found for this project.")).toBeInTheDocument();
  });
});

describe("BrdDocumentViewer — header", () => {
  it("renders the file name and an extension badge", () => {
    render(<BrdDocumentViewer documents={[makeDocument()]} />);
    expect(screen.getByText("requirements.md")).toBeInTheDocument();
    expect(screen.getByText("md")).toBeInTheDocument();
  });

  it.each([
    ["pdf", "bg-priority-p0-bg"],
    ["docx", "bg-priority-p2-bg"],
    ["md", "bg-priority-p3-bg"],
  ])("colours the %s badge", (extension, expectedClass) => {
    render(
      <BrdDocumentViewer
        documents={[makeDocument({ extension: extension as Document["extension"] })]}
      />,
    );
    expect(screen.getByText(extension).className).toContain(expectedClass);
  });

  it("reports how many requirements were detected on the page", () => {
    render(<BrdDocumentViewer documents={[makeDocument()]} />);
    expect(screen.getByText("1 requirement")).toBeInTheDocument();
  });

  it("pluralises the requirement count", () => {
    render(
      <BrdDocumentViewer
        documents={[
          makeDocument({
            pages: [
              { pageNumber: 1, text: "Users must log in\nThe API shall return JSON" },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("2 requirements")).toBeInTheDocument();
  });
});

describe("BrdDocumentViewer — requirement callouts", () => {
  it("wraps requirement lines in an amber callout box", () => {
    render(<BrdDocumentViewer documents={[makeDocument()]} />);
    const callouts = screen.getAllByTestId("requirement-callout");
    expect(callouts).toHaveLength(1);
    expect(callouts[0]).toHaveTextContent("The system must authenticate users");
    expect(callouts[0]?.className).toContain("bg-callout-bg");
    expect(callouts[0]?.className).toContain("border-callout-border");
  });

  it("renders non-requirement prose without a callout", () => {
    render(<BrdDocumentViewer documents={[makeDocument()]} />);
    expect(screen.getByText("Overview line")).toBeInTheDocument();
    expect(screen.getAllByTestId("requirement-callout")).toHaveLength(1);
  });

  it("explains when a page has no readable text", () => {
    render(
      <BrdDocumentViewer documents={[makeDocument({ pages: [{ pageNumber: 1, text: "" }] })]} />,
    );
    expect(screen.getByText("This page has no readable text.")).toBeInTheDocument();
  });
});

describe("BrdDocumentViewer — pagination", () => {
  const paginated = makeDocument({
    fileName: "spec.pdf",
    extension: "pdf",
    pages: [
      { pageNumber: 1, text: "Page one content" },
      { pageNumber: 2, text: "Page two must be reachable" },
    ],
  });

  it("shows the page indicator", () => {
    render(<BrdDocumentViewer documents={[paginated]} />);
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
  });

  it("advances to the next page", () => {
    render(<BrdDocumentViewer documents={[paginated]} />);
    fireEvent.click(screen.getByLabelText("Next page"));
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("Page two must be reachable")).toBeInTheDocument();
  });

  it("disables Previous on the first page and Next on the last", () => {
    render(<BrdDocumentViewer documents={[paginated]} />);
    expect(screen.getByLabelText("Previous page")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Next page"));
    expect(screen.getByLabelText("Next page")).toBeDisabled();
    expect(screen.getByLabelText("Previous page")).toBeEnabled();
  });

  it("goes back to the previous page", () => {
    render(<BrdDocumentViewer documents={[paginated]} />);
    fireEvent.click(screen.getByLabelText("Next page"));
    fireEvent.click(screen.getByLabelText("Previous page"));
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
  });
});

describe("BrdDocumentViewer — multiple documents", () => {
  const documents = [
    makeDocument({ fileId: "a", fileName: "one.md" }),
    makeDocument({
      fileId: "b",
      fileName: "two.pdf",
      extension: "pdf",
      pages: [
        { pageNumber: 1, text: "Doc two page one" },
        { pageNumber: 2, text: "Doc two page two" },
      ],
    }),
  ];

  it("offers a switcher only when there is more than one document", () => {
    const { rerender } = render(<BrdDocumentViewer documents={[documents[0] as Document]} />);
    expect(screen.queryByRole("button", { name: "two.pdf" })).not.toBeInTheDocument();

    rerender(<BrdDocumentViewer documents={documents} />);
    expect(screen.getByRole("button", { name: "two.pdf" })).toBeInTheDocument();
  });

  it("switches documents and resets to page one", () => {
    render(<BrdDocumentViewer documents={documents} />);
    fireEvent.click(screen.getByRole("button", { name: "two.pdf" }));
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Doc two page one")).toBeInTheDocument();
  });

  it("resets to page one when switching back after paging forward", () => {
    render(<BrdDocumentViewer documents={documents} />);
    fireEvent.click(screen.getByRole("button", { name: "two.pdf" }));
    fireEvent.click(screen.getByLabelText("Next page"));
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "one.md" }));
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  });
});
