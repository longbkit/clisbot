import type { ReplicaRow } from "./row-store";
import { isReplicaTailKind } from "./row-store-schema";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A tail is written only while its session or chat was opened within this window. */
export const TAIL_SAVE_WINDOW_MS = 7 * DAY_MS;

/** Tails not opened for this long are dropped when the store is first used. */
export const TAIL_MAX_AGE_MS = 30 * DAY_MS;

/**
 * The tail rows to drop, least recently opened first, until `totalBytes` fits `maxBytes`.
 * Session, workspace and project rows are never chosen: they stay while their Host is registered.
 */
export function selectTailEvictions(
  rows: Iterable<ReplicaRow>,
  totalBytes: number,
  maxBytes: number,
  sizeOf: (row: ReplicaRow) => number,
): ReplicaRow[] {
  if (totalBytes <= maxBytes) return [];
  const tails = [...rows]
    .filter((row) => isReplicaTailKind(row.kind))
    .sort((left, right) => (left.openedAt ?? 0) - (right.openedAt ?? 0));
  const evicted: ReplicaRow[] = [];
  let remaining = totalBytes;
  for (const row of tails) {
    if (remaining <= maxBytes) break;
    evicted.push(row);
    remaining -= sizeOf(row);
  }
  return evicted;
}
