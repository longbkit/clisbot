import { describe, expect, it } from "vitest";
import { applyOrderedChanges } from "./aggregated-agent-order";

interface Row {
  id: string;
  at: number;
}

const byAt = (left: Row, right: Row) => right.at - left.at || left.id.localeCompare(right.id);

describe("applyOrderedChanges", () => {
  it("moves a changed row by binary search", () => {
    const a = { id: "a", at: 3 };
    const b = { id: "b", at: 2 };
    const c = { id: "c", at: 1 };
    const newerC = { id: "c", at: 4 };
    expect(applyOrderedChanges([a, b, c], { removed: [c], added: [newerC] }, byAt)).toEqual([
      newerC,
      a,
      b,
    ]);
  });

  it("finds a removed row by identity when its order no longer places it, instead of throwing", () => {
    // NaN compares as neither before nor after, so binary search cannot place this row.
    const broken = { id: "x", at: Number.NaN };
    const a = { id: "a", at: 3 };
    const b = { id: "b", at: 1 };
    const next = applyOrderedChanges([a, broken, b], { removed: [broken], added: [] }, byAt);
    expect(next).toEqual([a, b]);
  });

  it("ignores a removed row that is not in the list", () => {
    const a = { id: "a", at: 3 };
    const ghost = { id: "g", at: 2 };
    expect(applyOrderedChanges([a], { removed: [ghost], added: [] }, byAt)).toEqual([a]);
  });
});
