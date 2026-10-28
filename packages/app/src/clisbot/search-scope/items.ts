import { inScope, type Ownership } from "@/clisbot/navigation/ownership";
import type { SearchViewContext } from "./candidates";
import { inSearchScope, type ResolvedSearchScope } from "./model";

/** Where an item row lives and whose it is, so chips and the view filter can place it. */
export interface ItemPlacement {
  serverId: string;
  projectKey: string | null;
  /** The workspace the item opens into; null for a session outside any workspace. */
  workspaceId: string | null;
  ownership: Ownership;
}

/** Which part of the view filter hides an item. */
export type HiddenBy = "host" | "project" | "others";

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

/** The part of the view filter that hides the item, or null when the view shows it. */
export function hiddenBy(
  view: SearchViewContext | null,
  placement: ItemPlacement,
): HiddenBy | null {
  if (!view) return null;
  if (view.serverIds && !view.serverIds.has(placement.serverId)) return "host";
  if (view.projectKeys && (!placement.projectKey || !view.projectKeys.has(placement.projectKey))) {
    return "project";
  }
  if (view.ownership && !inScope(view.ownership, placement.ownership)) {
    return "others";
  }
  return null;
}

export function isInView(view: SearchViewContext | null, placement: ItemPlacement): boolean {
  return hiddenBy(view, placement) === null;
}

/**
 * Keep every match (R1) in four bands: in view and For me, in view and not mine (Others, or
 * nobody can tell), then the same two outside the view. Stable, so the matcher's order holds
 * within each band and the highlighted row does not jump while results stream in.
 */
export function rankItemsByView<Row>(
  rows: readonly Row[],
  view: SearchViewContext | null,
  placementOf: (row: Row) => ItemPlacement,
): Row[] {
  const bands: Row[][] = [[], [], [], []];
  for (const row of rows) {
    const placement = placementOf(row);
    const band = (isInView(view, placement) ? 0 : 2) + (placement.ownership === "mine" ? 0 : 1);
    bands[band]!.push(row);
  }
  return bands.flat();
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
