import { useMemo, useRef } from "react";
import type { SearchViewContext } from "./candidates";
import type { SearchScopeCatalog } from "./catalog";
import { annotateItem, type ItemAnnotation } from "./item-notes";
import {
  compareByAttention,
  filterItemsToScope,
  rankItemsByView,
  type AttentionRow,
  type ItemPlacement,
} from "./items";
import { isScoped, type ResolvedSearchScope } from "./model";
import type { ScopeT } from "./rows";
import { setOutsideFilterReveal, type OutsideFilterReveal } from "./work-navigation";

/** Before the catalog loads, every row is the reader's and in no project. */
const UNPLACED: ItemPlacement = {
  serverId: "",
  projectKey: null,
  workspaceId: null,
  ownership: "mine",
};

/** Rows shown for an empty query inside a scope: a little more than upstream's five. */
const SCOPED_EMPTY_QUERY_LIMIT = 8;

export interface ScopedItemRow {
  id: string;
  note?: string | null;
  run(): void;
}

interface Annotated<Row> {
  row: Row;
  placement: ItemPlacement;
}

export interface ScopedItemsInput<Row extends ScopedItemRow> {
  rows: readonly Row[];
  query: string;
  catalog: SearchScopeCatalog | null;
  view: SearchViewContext | null;
  scope: ResolvedSearchScope;
  t: ScopeT;
  formatTime(iso: string): string;
  itemKind: OutsideFilterReveal["itemKind"];
  placementOf(row: Row, catalog: SearchScopeCatalog): ItemPlacement;
  attentionOf(row: Row): AttentionRow;
  rank(rows: readonly Row[], query: string): Row[];
}

function annotationKey(annotation: ItemAnnotation): string {
  return `${annotation.note ?? ""}\u0000${JSON.stringify(annotation.reveal)}`;
}

/**
 * Notes and the reveal signal for the rows the query kept. An unchanged row keeps its object, so
 * the list's memoized rows do not re-render (upstream's "live updates render only the changed row"
 * contract).
 */
function useAnnotatedRows<Row extends ScopedItemRow>(
  input: ScopedItemsInput<Row>,
  rows: readonly Row[],
): Annotated<Row>[] {
  const cache = useRef(new WeakMap<Row, { key: string; row: Row }>());
  const { catalog, view, t, formatTime, itemKind, placementOf } = input;
  return useMemo(() => {
    if (!catalog) return rows.map((row) => ({ row, placement: UNPLACED }));
    return rows.map((row) => {
      const placement = placementOf(row, catalog);
      const annotation = annotateItem({ itemKind, placement, catalog, view, t, formatTime });
      if (!annotation.note && !view) return { row, placement };
      const key = annotationKey(annotation);
      const cached = cache.current.get(row);
      if (cached?.key === key) return { row: cached.row, placement };
      const annotated: Row = {
        ...row,
        note: annotation.note,
        run: () => {
          setOutsideFilterReveal(annotation.reveal);
          row.run();
        },
      };
      cache.current.set(row, { key, row: annotated });
      return { row: annotated, placement };
    });
  }, [catalog, formatTime, itemKind, placementOf, rows, t, view]);
}

/**
 * The rows the query keeps, in the matcher's order. Matching reads only the row's own text, so it
 * reruns when the query or a row changes, not when a Host's status or the view filter does. A phone
 * with ~7,000 sessions and Hosts that keep retrying matched and annotated every row on each status
 * change; the JS thread never went idle and a pressed row did not run.
 */
function useMatchedRows<Row extends ScopedItemRow>(
  input: ScopedItemsInput<Row>,
  everyRow: boolean,
): readonly Row[] {
  const { rows, query, rank } = input;
  return useMemo(() => (everyRow ? rows : rank(rows, query)), [everyRow, query, rank, rows]);
}

/** Item rows inside the chips' scope, matched, in-filter first (R1, R5, R6). */
export function useScopedItems<Row extends ScopedItemRow>(
  input: ScopedItemsInput<Row> & { active: boolean },
): Row[] {
  const { scope, active, query, view, attentionOf } = input;
  // An empty query inside a scope lists the scope's rows by attention, so it needs every row.
  const byAttention = active && isScoped(scope) && !query.trim();
  const matched = useMatchedRows(input, byAttention);
  const annotated = useAnnotatedRows(input, matched);
  const inScope = useMemo(() => {
    const kept = active
      ? filterItemsToScope(annotated, scope, (entry) => entry.placement)
      : annotated;
    return {
      rows: kept.map((entry) => entry.row),
      placement: new Map(kept.map((entry) => [entry.row, entry.placement])),
    };
  }, [active, annotated, scope]);
  return useMemo(() => {
    if (!active) return inScope.rows;
    if (byAttention) {
      return [...inScope.rows]
        .sort((left, right) => compareByAttention(attentionOf(left), attentionOf(right)))
        .slice(0, SCOPED_EMPTY_QUERY_LIMIT);
    }
    return rankItemsByView(inScope.rows, view, (row) => inScope.placement.get(row)!);
  }, [active, attentionOf, byAttention, inScope, view]);
}
