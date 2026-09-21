import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { watchSlowCreate } from "./pending-marker.js";

describe("watchSlowCreate", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps the surface for as long as the create runs and tells the sender once", () => {
    let kept = 0;
    let told = 0;
    const stop = watchSlowCreate({ keepSurface: () => kept++, tellSender: () => told++ });
    vi.advanceTimersByTime(19_000);
    assert.deepEqual([kept, told], [0, 0], "a create that is quick says nothing");
    vi.advanceTimersByTime(45_000);
    assert.deepEqual([kept, told], [3, 1]);
    stop();
    vi.advanceTimersByTime(60_000);
    assert.deepEqual([kept, told], [3, 1]);
  });
});
