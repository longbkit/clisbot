import { beforeEach, describe, expect, it } from "vitest";
import {
  moveProvider,
  orderProviderIds,
  resolveRailExpanded,
  useProviderRailStore,
  WIDE_RAIL_MIN_WINDOW_WIDTH,
} from "./rail-store";

describe("provider rail order", () => {
  it("keeps the saved order and appends providers added later", () => {
    expect(orderProviderIds(["claude", "codex", "opencode"], ["codex", "claude"])).toEqual([
      "codex",
      "claude",
      "opencode",
    ]);
  });

  it("forgets providers the Host no longer offers", () => {
    expect(orderProviderIds(["claude"], ["gone", "claude"])).toEqual(["claude"]);
  });

  it("moves a provider up or down within the shown list", () => {
    expect(moveProvider(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
    expect(moveProvider(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveProvider(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
  });
});

describe("provider rail expansion", () => {
  beforeEach(() => useProviderRailStore.setState({ expanded: null, order: [] }));

  it("opens expanded for a first-time user on a wide window, icons only on a narrow one", () => {
    expect(resolveRailExpanded(null, WIDE_RAIL_MIN_WINDOW_WIDTH)).toBe(true);
    expect(resolveRailExpanded(null, WIDE_RAIL_MIN_WINDOW_WIDTH - 1)).toBe(false);
  });

  it("remembers the user's choice on this device", () => {
    useProviderRailStore.getState().setExpanded(false);
    expect(resolveRailExpanded(useProviderRailStore.getState().expanded, 2000)).toBe(false);
  });

  it("stores the order a move produces", () => {
    useProviderRailStore.getState().move(["claude", "codex"], "codex", -1);
    expect(useProviderRailStore.getState().order).toEqual(["codex", "claude"]);
  });
});
