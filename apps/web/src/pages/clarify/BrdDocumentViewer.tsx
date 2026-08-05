import { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, FileTextIcon } from "lucide-react";
import type { RouterOutputs } from "@/trpc";
import { segmentDocumentText, countRequirements } from "@/lib/requirement-callouts";

type BrdDocument = RouterOutputs["clarification"]["getBrdDocuments"][number];

const EXTENSION_BADGE_STYLES: Record<string, string> = {
  pdf: "bg-priority-p0-bg text-error",
  docx: "bg-priority-p2-bg text-primary",
  md: "bg-priority-p3-bg text-text-secondary",
};

function badgeClass(extension: string): string {
  return EXTENSION_BADGE_STYLES[extension] ?? "bg-priority-p3-bg text-text-secondary";
}

export function BrdDocumentViewer({ documents }: { documents: BrdDocument[] }) {
  const [documentIndex, setDocumentIndex] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);

  const activeDocument = documents[documentIndex];
  const activePage = activeDocument?.pages[pageIndex];
  const segments = activePage ? segmentDocumentText(activePage.text) : [];
  const requirementCount = countRequirements(segments);

  function goToPage(nextIndex: number): void {
    if (!activeDocument) return;
    if (nextIndex < 0 || nextIndex >= activeDocument.pages.length) return;
    setPageIndex(nextIndex);
  }

  function selectDocument(nextIndex: number): void {
    setDocumentIndex(nextIndex);
    setPageIndex(0);
  }

  if (!activeDocument) {
    return (
      <section
        aria-label="BRD document viewer"
        className="w-[34%] shrink-0 flex flex-col border-r border-column-border bg-modal-bg"
      >
        <div className="flex items-center justify-center h-full p-lg">
          <p className="text-sm text-text-secondary text-center">
            No BRD documents found for this project.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="BRD document viewer"
      className="w-[34%] shrink-0 flex flex-col border-r border-column-border bg-modal-bg"
    >
      <header className="flex items-center gap-sm px-md h-14 shrink-0 border-b border-column-border">
        <FileTextIcon size={14} className="text-text-secondary shrink-0" aria-hidden="true" />
        <span
          className={`px-1.5 py-px rounded-sm text-3xs font-mono font-semibold uppercase shrink-0 ${badgeClass(activeDocument.extension)}`}
        >
          {activeDocument.extension}
        </span>
        <span className="text-sm text-text-inverse truncate flex-1">
          {activeDocument.fileName}
        </span>
        <span className="text-2xs text-text-secondary shrink-0">
          {requirementCount} {requirementCount === 1 ? "requirement" : "requirements"}
        </span>
      </header>

      {documents.length > 1 && (
        <div className="flex gap-xs px-md py-sm shrink-0 border-b border-column-border overflow-x-auto">
          {documents.map((document, index) => (
            <button
              key={document.fileId}
              type="button"
              onClick={() => selectDocument(index)}
              aria-current={index === documentIndex ? "true" : undefined}
              className={`px-sm py-px rounded-full text-2xs whitespace-nowrap transition-colors cursor-pointer ${
                index === documentIndex
                  ? "bg-sidebar-item text-text-inverse"
                  : "text-text-secondary hover:text-text-inverse"
              }`}
            >
              {document.fileName}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-md flex flex-col gap-sm">
        {segments.length === 0 ? (
          <p className="text-xs text-text-disabled">This page has no readable text.</p>
        ) : (
          segments.map((segment) =>
            segment.isRequirement ? (
              <p
                key={segment.id}
                data-testid="requirement-callout"
                className="rounded-md border border-callout-border bg-callout-bg px-sm py-sm text-xs text-text-inverse leading-relaxed"
              >
                {segment.text}
              </p>
            ) : (
              <p key={segment.id} className="text-xs text-text-secondary leading-relaxed">
                {segment.text}
              </p>
            ),
          )
        )}
      </div>

      <footer className="flex items-center justify-between px-md py-sm shrink-0 border-t border-column-border">
        <button
          type="button"
          onClick={() => goToPage(pageIndex - 1)}
          disabled={pageIndex === 0}
          aria-label="Previous page"
          className="text-text-secondary hover:text-text-inverse disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          <ChevronLeftIcon size={14} />
        </button>
        <span className="text-2xs font-mono text-text-secondary">
          Page {pageIndex + 1} of {activeDocument.pages.length}
        </span>
        <button
          type="button"
          onClick={() => goToPage(pageIndex + 1)}
          disabled={pageIndex >= activeDocument.pages.length - 1}
          aria-label="Next page"
          className="text-text-secondary hover:text-text-inverse disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          <ChevronRightIcon size={14} />
        </button>
      </footer>
    </section>
  );
}
