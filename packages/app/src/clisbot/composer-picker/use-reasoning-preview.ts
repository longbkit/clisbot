import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProviderSelectionModelRow } from "@/provider-selection/provider-selection";
import { formatCompactModelName } from "./model-name";
import { normalizeReasoning } from "./normalize";
import type { ReasoningColumnProps } from "./reasoning-column";

export type ReasoningProps = Omit<ReasoningColumnProps, "orientation">;

/** Picks a model and one of its efforts in one press, from the previewed column. */
export type PickModelWithEffort = (row: ProviderSelectionModelRow, effortId: string) => void;

/**
 * On desktop the Reasoning column previews the hovered or keyboard-highlighted model's efforts
 * without changing the selection; leaving the list restores the selected model's. Picking an
 * effort while previewing another model selects that model with that effort. Touch has no
 * hover, so the column follows the selected model.
 */
export function useReasoningPreview(input: {
  enabled: boolean;
  rows: readonly ProviderSelectionModelRow[];
  highlight: number;
  selectedKey: string;
  reasoning: ReasoningProps;
  onPickWithEffort: PickModelWithEffort;
}): { reasoning: ReasoningProps; onHoverRow: (key: string) => void; onLeaveList: () => void } {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const onLeaveList = useCallback(() => setHoveredKey(null), []);
  const { enabled, rows, highlight, selectedKey, reasoning, onPickWithEffort } = input;
  // The latest of pointer and keyboard wins: moving the highlight ends a hover preview.
  useEffect(() => setHoveredKey(null), [highlight]);
  // The column only changes content, never appears or leaves, so a row never moves under the
  // pointer: with the selected model showing no efforts there is no column to preview in.
  const hasColumn = reasoning.options.length > 0;
  const preview = useMemo(() => {
    if (!enabled || !hasColumn) return null;
    const row = rows.find((entry) => entry.favoriteKey === hoveredKey) ?? rows[highlight];
    // A row without efforts data (a fallback list) cannot preview.
    if (!row || row.favoriteKey === selectedKey || row.thinkingOptions === undefined) return null;
    return row;
  }, [enabled, hasColumn, highlight, hoveredKey, rows, selectedKey]);
  const previewed = useMemo<ReasoningProps>(() => {
    if (!preview) return reasoning;
    const { options } = normalizeReasoning(preview);
    return {
      modelName: formatCompactModelName(preview.modelLabel),
      options,
      selectedId: undefined,
      onSelect: (effortId: string) => onPickWithEffort(preview, effortId),
      previewing: true,
    };
  }, [onPickWithEffort, preview, reasoning]);
  return { reasoning: previewed, onHoverRow: setHoveredKey, onLeaveList };
}
