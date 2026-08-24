import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { UploadCloudIcon, CheckIcon, XIcon, LoaderIcon, ShieldAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BRD_ACCEPT_ATTRIBUTE } from "@specforge/backend/brd-constants";
import { MALWARE_WARNING_MESSAGE } from "@/lib/brd-upload-client";
import { formatBytes } from "@/lib/format-bytes";

export type UploadItemState = "uploading" | "scanning" | "clean" | "infected" | "rejected" | "error";

export interface UploadItem {
  id: string;
  fileName: string;
  extension: string;
  byteSize: number;
  progress: number;
  state: UploadItemState;
  message?: string;
}

const EXTENSION_BADGE_STYLES: Record<string, string> = {
  pdf: "bg-priority-p0-bg text-error",
  docx: "bg-priority-p2-bg text-primary",
  md: "bg-priority-p3-bg text-text-secondary",
};

function extensionBadgeClass(extension: string): string {
  return EXTENSION_BADGE_STYLES[extension] ?? "bg-priority-p3-bg text-text-secondary";
}

function StatusPill({ item }: { item: UploadItem }) {
  if (item.state === "uploading") {
    return (
      <span className="flex items-center gap-xs text-2xs font-medium text-text-secondary">
        {item.progress}%
      </span>
    );
  }

  if (item.state === "scanning") {
    return (
      <span className="flex items-center gap-xs px-1.5 py-px rounded-full text-2xs font-medium bg-sidebar-item text-text-secondary">
        <LoaderIcon size={11} className="animate-spin" aria-hidden="true" />
        Scanning
      </span>
    );
  }

  if (item.state === "clean") {
    return (
      <span className="flex items-center gap-xs px-1.5 py-px rounded-full text-2xs font-medium bg-success-light text-success">
        <CheckIcon size={11} aria-hidden="true" />
        Clean
      </span>
    );
  }

  if (item.state === "infected") {
    return (
      <span className="flex items-center gap-xs px-1.5 py-px rounded-full text-2xs font-medium bg-priority-p0-bg text-error">
        <XIcon size={11} aria-hidden="true" />
        Threat Rejected
      </span>
    );
  }

  return (
    <span className="flex items-center gap-xs px-1.5 py-px rounded-full text-2xs font-medium bg-priority-p0-bg text-error">
      <XIcon size={11} aria-hidden="true" />
      Rejected
    </span>
  );
}

function UploadRow({ item }: { item: UploadItem }) {
  const isInFlight = item.state === "uploading" || item.state === "scanning";

  return (
    <li className="flex flex-col gap-xs rounded-md border border-column-border bg-input-bg p-sm">
      <div className="flex items-center gap-sm">
        <span
          className={`px-1.5 py-px rounded-sm text-3xs font-mono font-semibold uppercase shrink-0 ${extensionBadgeClass(item.extension)}`}
        >
          {item.extension}
        </span>
        <span className="text-sm text-text-inverse truncate flex-1">{item.fileName}</span>
        <span className="text-2xs text-text-secondary shrink-0">{formatBytes(item.byteSize)}</span>
        <StatusPill item={item} />
      </div>

      {isInFlight && (
        <div className="h-1 w-full rounded-full bg-sidebar-item overflow-hidden">
          <progress
            className="sr-only"
            aria-label={`Upload progress for ${item.fileName}`}
            value={item.progress}
            max={100}
          />
          <div
            aria-hidden="true"
            className="h-full rounded-full bg-primary transition-all duration-300"
            /* Width is a runtime percentage, so it cannot be a static Tailwind
               class; same data-driven-style exception as the board's status dots. */
            style={{ width: `${item.progress}%` }}
          />
        </div>
      )}

      {item.state === "infected" && (
        <div className="flex items-start gap-sm rounded-md border border-error-border bg-priority-p0-bg p-sm">
          <ShieldAlertIcon size={14} className="text-error shrink-0 mt-px" aria-hidden="true" />
          <p className="text-xs text-error">{MALWARE_WARNING_MESSAGE}</p>
        </div>
      )}

      {(item.state === "rejected" || item.state === "error") && item.message && (
        <p className="text-xs text-error">{item.message}</p>
      )}
    </li>
  );
}

export function BrdUploadZone({
  items,
  onFilesSelected,
  disabled = false,
}: {
  items: UploadItem[];
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  function emitFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    onFilesSelected(Array.from(fileList));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    emitFiles(event.dataTransfer.files);
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    emitFiles(event.target.files);
    // Reset so selecting the same file twice still fires a change event.
    event.target.value = "";
  }

  return (
    <div className="flex flex-col gap-md">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        data-testid="brd-dropzone"
        className={`flex flex-col items-center justify-center gap-sm rounded-2lg border border-dashed p-xl transition-colors ${
          isDragging ? "border-primary bg-priority-p2-bg" : "border-sidebar-item-border bg-modal-bg"
        } ${disabled ? "opacity-50" : ""}`}
      >
        <UploadCloudIcon size={28} className="text-text-secondary" aria-hidden="true" />
        <p className="text-sm text-text-inverse">Drag and drop your BRD files here</p>
        <p className="text-2xs text-text-secondary">PDF, DOCX or MD · up to 25MB each</p>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={BRD_ACCEPT_ATTRIBUTE}
          onChange={handleInputChange}
          disabled={disabled}
          aria-label="Choose BRD files"
          className="hidden"
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          Choose files
        </Button>
      </div>

      {items.length > 0 && (
        <ul className="flex flex-col gap-sm">
          {items.map((item) => (
            <UploadRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
