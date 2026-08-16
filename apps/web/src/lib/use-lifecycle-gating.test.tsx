import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLifecycleGating } from "./use-lifecycle-gating";

let brdFiles: unknown[] = [];
let clarificationState: { status: "active" | "completed" } | null = null;
let tickets: unknown[] = [];

vi.mock("@/trpc", () => ({
  trpc: {
    brd: {
      listFiles: {
        useQuery: () => ({ data: brdFiles, isLoading: false }),
      },
    },
    clarification: {
      getSessionState: {
        useQuery: () => ({ data: clarificationState, isLoading: false }),
      },
    },
    ticket: {
      getProjectTickets: {
        useQuery: () => ({ data: tickets, isLoading: false }),
      },
    },
  },
}));

beforeEach(() => {
  brdFiles = [];
  clarificationState = null;
  tickets = [];
});

describe("useLifecycleGating", () => {
  it("always unlocks dashboard and ingest, regardless of other state", () => {
    const { result } = renderHook(() => useLifecycleGating("project-1"));
    expect(result.current.unlocked.dashboard).toBe(true);
    expect(result.current.unlocked.ingest).toBe(true);
  });

  it("locks clarify, backlog, and board when nothing has happened yet", () => {
    const { result } = renderHook(() => useLifecycleGating("project-1"));
    expect(result.current.unlocked.clarify).toBe(false);
    expect(result.current.unlocked.backlog).toBe(false);
    expect(result.current.unlocked.board).toBe(false);
  });

  it("unlocks clarify once at least one clean BRD file exists", () => {
    brdFiles = [{ id: "brd-1" }];
    const { result } = renderHook(() => useLifecycleGating("project-1"));
    expect(result.current.unlocked.clarify).toBe(true);
    expect(result.current.hasCleanBrdFile).toBe(true);
  });

  it("keeps backlog locked while clarification is only active, not completed", () => {
    clarificationState = { status: "active" };
    const { result } = renderHook(() => useLifecycleGating("project-1"));
    expect(result.current.unlocked.backlog).toBe(false);
    expect(result.current.clarificationCompleted).toBe(false);
  });

  it("unlocks backlog once clarification is completed", () => {
    clarificationState = { status: "completed" };
    const { result } = renderHook(() => useLifecycleGating("project-1"));
    expect(result.current.unlocked.backlog).toBe(true);
    expect(result.current.clarificationCompleted).toBe(true);
  });

  it("unlocks board once at least one ticket exists", () => {
    tickets = [{ id: "ticket-1" }];
    const { result } = renderHook(() => useLifecycleGating("project-1"));
    expect(result.current.unlocked.board).toBe(true);
    expect(result.current.hasTickets).toBe(true);
  });

  it("locks everything but dashboard/ingest when there is no current project", () => {
    const { result } = renderHook(() => useLifecycleGating(null));
    expect(result.current.unlocked).toEqual({
      dashboard: true,
      ingest: true,
      clarify: false,
      backlog: false,
      board: false,
    });
  });
});
