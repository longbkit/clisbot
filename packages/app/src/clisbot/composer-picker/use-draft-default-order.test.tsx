// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSnapshotEntry } from "@clisbot/protocol/agent-types";
import { useProviderRailStore } from "./rail-store";
import {
  DRAFT_DEFAULT_WAIT_MS,
  resolveDraftDefaultOrder,
  useDraftDefaultOrder,
} from "./use-draft-default-order";

function entry(provider: string, status: ProviderSnapshotEntry["status"]): ProviderSnapshotEntry {
  return { provider, status, enabled: true } as ProviderSnapshotEntry;
}

describe("resolveDraftDefaultOrder", () => {
  const LOADING_FIRST = [entry("claude", "loading"), entry("codex", "ready")];

  it("offers only the rail's first provider while it loads", () => {
    expect(
      resolveDraftDefaultOrder({ entries: LOADING_FIRST, savedOrder: [], waitOver: false }),
    ).toEqual(["claude"]);
  });

  it("offers every provider once the wait is over", () => {
    expect(
      resolveDraftDefaultOrder({ entries: LOADING_FIRST, savedOrder: [], waitOver: true }),
    ).toEqual(["claude", "codex"]);
  });

  it("follows the saved rail order", () => {
    expect(
      resolveDraftDefaultOrder({ entries: LOADING_FIRST, savedOrder: ["codex"], waitOver: false }),
    ).toEqual(["codex", "claude"]);
  });

  it("does not wait for a provider that cannot run", () => {
    const entries = [entry("claude", "unavailable"), entry("codex", "ready")];
    expect(resolveDraftDefaultOrder({ entries, savedOrder: [], waitOver: false })).toEqual([
      "claude",
      "codex",
    ]);
  });
});

describe("useDraftDefaultOrder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useProviderRailStore.setState({ order: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits a bounded time for the first provider, then takes the rest", () => {
    const entries = [entry("claude", "loading"), entry("codex", "ready")];
    const { result } = renderHook(() => useDraftDefaultOrder(entries, "host"));
    expect(result.current).toEqual(["claude"]);
    act(() => {
      vi.advanceTimersByTime(DRAFT_DEFAULT_WAIT_MS - 1);
    });
    expect(result.current).toEqual(["claude"]);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toEqual(["claude", "codex"]);
  });
});
