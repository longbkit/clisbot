/** Rows leaving and entering an ordered list; a changed row is its old object out, new one in. */
export interface OrderedChanges<T> {
  removed: readonly T[];
  added: readonly T[];
}

/** Beyond this many changes one merge pass is cheaper than a splice per row. */
const SPLICE_LIMIT = 32;

/**
 * `sorted` with `changes` applied, in the same total order (`compare` never returns 0 for two
 * different rows). A few changes cost a binary search each; many cost one merge. Returns `sorted`
 * itself when nothing changed.
 */
export function applyOrderedChanges<T>(
  sorted: T[],
  changes: OrderedChanges<T>,
  compare: (left: T, right: T) => number,
): T[] {
  const { removed, added } = changes;
  if (removed.length + added.length === 0) return sorted;
  if (removed.length + added.length > SPLICE_LIMIT) {
    const gone = new Set(removed);
    const kept = gone.size ? sorted.filter((row) => !gone.has(row)) : sorted;
    return mergeOrdered(kept, [...added].sort(compare), compare);
  }
  const next = sorted.slice();
  for (const row of removed) {
    let index = lowerBound(next, row, compare);
    // A row its order no longer places (a NaN timestamp) is found by identity; a missing one is
    // skipped. Throwing here would take Home down for one bad row.
    if (next[index] !== row) index = next.indexOf(row);
    if (index !== -1) next.splice(index, 1);
  }
  for (const row of added) next.splice(lowerBound(next, row, compare), 0, row);
  return next;
}

/** The first index whose row does not sort before `row`. */
function lowerBound<T>(rows: readonly T[], row: T, compare: (left: T, right: T) => number) {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compare(rows[middle]!, row) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

function mergeOrdered<T>(
  left: T[],
  right: readonly T[],
  compare: (left: T, right: T) => number,
): T[] {
  const merged: T[] = [];
  let l = 0;
  let r = 0;
  while (l < left.length && r < right.length) {
    merged.push(compare(left[l]!, right[r]!) <= 0 ? left[l++]! : right[r++]!);
  }
  while (l < left.length) merged.push(left[l++]!);
  while (r < right.length) merged.push(right[r++]!);
  return merged;
}
