export function ErrorToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="fixed top-md left-1/2 -translate-x-1/2 z-50 flex items-center gap-sm rounded-md border border-error-border bg-modal-bg px-md py-sm text-sm text-text-inverse shadow-lg"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-text-secondary hover:text-text-inverse cursor-pointer"
      >
        &times;
      </button>
    </div>
  );
}

export function SuccessToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <output className="fixed top-md left-1/2 -translate-x-1/2 z-50 flex items-center gap-sm rounded-md border border-success bg-modal-bg px-md py-sm text-sm text-text-inverse shadow-lg">
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-text-secondary hover:text-text-inverse cursor-pointer"
      >
        &times;
      </button>
    </output>
  );
}
