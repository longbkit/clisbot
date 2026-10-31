export type StreamPlaceholder = "none" | "loading" | "empty";

export interface StreamPlaceholderInput {
  hasVirtualizedHistory: boolean;
  hasMountedHistory: boolean;
  hasLiveHead: boolean;
  hasAuxiliaryRows: boolean;
  /** The screen opened before any history (memory, device cache or Host) reached it. */
  isHistoryLoading: boolean;
}

/** What the stream shows when it has no row to render. */
export function resolveStreamPlaceholder(input: StreamPlaceholderInput): StreamPlaceholder {
  const hasRows =
    input.hasVirtualizedHistory ||
    input.hasMountedHistory ||
    input.hasLiveHead ||
    input.hasAuxiliaryRows;
  if (hasRows) return "none";
  return input.isHistoryLoading ? "loading" : "empty";
}
