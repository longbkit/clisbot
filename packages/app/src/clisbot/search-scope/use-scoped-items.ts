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
 * Notes and the reveal signal, once per directory or filter change — never per keystroke. An
 * unchanged row keeps its object, so the list's memoized rows do not re-render (upstream's
 * "live updates render only the changed row" contract).
 */
function useAnnotatedRows<Row extends ScopedItemRow>(
  input: ScopedItemsInput<Row>,
): Annotated<Row>[] {
  const cache = useRef(new WeakMap<Row, { key: string; row: Row }>());
  const { rows, catalog, view, t, formatTime, itemKind, placementOf } = input;
  return useMemo(() => {
    if (!catalog)
      return rows.map((row) => ({ row, placement: { serverId: "", projectKey: null } }));
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

/** Item rows inside the chips' scope, matched, in-filter first (R1, R5, R6). */
export function useScopedItems<Row extends ScopedItemRow>(
  input: ScopedItemsInput<Row> & { active: boolean },
): Row[] {
  const annotated = useAnnotatedRows(input);
  const { scope, active, query, view, rank, attentionOf } = input;
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
    if (!active) return rank(inScope.rows, query);
    if (isScoped(scope) && !query.trim()) {
      return [...inScope.rows]
        .sort((left, right) => compareByAttention(attentionOf(left), attentionOf(right)))
        .slice(0, SCOPED_EMPTY_QUERY_LIMIT);
    }
    const ranked = rank(inScope.rows, query);
    return rankItemsByView(ranked, view, (row) => inScope.placement.get(row)!).rows;
  }, [active, attentionOf, inScope, query, rank, scope, view]);
}
