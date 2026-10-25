import type { SearchViewContext } from "./candidates";
import { inSearchScope, type ResolvedSearchScope } from "./model";

/** Where an item row lives, so scope chips and the view filter can place it. */
export interface ItemPlacement {
  serverId: string;
  projectKey: string | null;
}

export function filterItemsToScope<Row>(
  rows: readonly Row[],
  scope: ResolvedSearchScope,
  placementOf: (row: Row) => ItemPlacement,
): Row[] {
  return rows.filter((row) => {
    const placement = placementOf(row);
    return inSearchScope(scope, placement.serverId, placement.projectKey);
  });
}

export function isInView(view: SearchViewContext | null, placement: ItemPlacement): boolean {
  if (!view) return true;
  if (view.serverIds && !view.serverIds.has(placement.serverId)) return false;
  if (view.projectKeys && (!placement.projectKey || !view.projectKeys.has(placement.projectKey))) {
    return false;
  }
  return true;
}

/**
 * Keep every match, inside the view filter first (R1). Stable, so the matcher's order holds within
 * each half and the highlighted row does not jump while results stream in.
 */
export function rankItemsByView<Row>(
  rows: readonly Row[],
  view: SearchViewContext | null,
  placementOf: (row: Row) => ItemPlacement,
): { rows: Row[]; outside: ReadonlySet<Row> } {
  if (!view) return { rows: [...rows], outside: new Set() };
  const inside: Row[] = [];
  const outside: Row[] = [];
  for (const row of rows) (isInView(view, placementOf(row)) ? inside : outside).push(row);
  return { rows: [...inside, ...outside], outside: new Set(outside) };
}

export interface AttentionRow {
  activityAt: Date | null;
  needsAction: boolean;
  running: boolean;
}

/** Empty query inside a scope: needs action, then running, then most recent (R6). */
export function compareByAttention(left: AttentionRow, right: AttentionRow): number {
  return (
    Number(right.needsAction) - Number(left.needsAction) ||
    Number(right.running) - Number(left.running) ||
    (right.activityAt?.getTime() ?? 0) - (left.activityAt?.getTime() ?? 0)
  );
}
