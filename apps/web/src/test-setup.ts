import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
  observe(): void {
    // no-op: jsdom never fires resize callbacks, so components under test
    // just keep whatever layout they rendered with.
  }

  unobserve(): void {
    // no-op: nothing was ever actually observed above.
  }

  disconnect(): void {
    // no-op: nothing was ever actually observed above.
  }
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub;
}
