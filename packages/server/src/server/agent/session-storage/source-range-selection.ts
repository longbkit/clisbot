import type {
  ProjectedTimelinePageSelection,
  TimelineProjectionEntry,
  TimelineSeqRange,
} from "../timeline-projection.js";
import type { SessionEventState } from "./session-event-log.js";

interface SourceRange {
  entry: TimelineProjectionEntry;
  range: TimelineSeqRange;
}

/** Search intervals without allocating an entry for every seq in a long tool lifecycle. */
function sourceAt(ranges: SourceRange[], seq: number): SourceRange | undefined {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (ranges[middle]!.range.startSeq <= seq) low = middle + 1;
    else high = middle;
  }
  const source = ranges[low - 1];
  return source && source.range.endSeq >= seq ? source : undefined;
}

/** Follow direct canonical-to-display references, never a tool's min/max envelope. */
export function selectSourceRanges(
  entries: readonly TimelineProjectionEntry[],
  state: SessionEventState,
  direction: "tail" | "before" | "after",
  cursor: number | undefined,
  limit: number,
  readRanges: readonly TimelineSeqRange[] = [],
): ProjectedTimelinePageSelection | { missingSeq: number } {
  const ranges = entries
    .flatMap((entry) => entry.sourceSeqRanges.map((range) => ({ entry, range })))
    .sort((left, right) => left.range.startSeq - right.range.startSeq);
  const forward = direction === "after";
  const minSeq = Math.max(1, state.minSeq);
  const boundary = forward
    ? Math.max(minSeq, (cursor ?? state.minSeq - 1) + 1)
    : Math.min(
        state.maxSeq,
        direction === "before" ? (cursor ?? state.maxSeq + 1) - 1 : state.maxSeq,
      );
  let seq = boundary;
  const selected = new Map<number, TimelineProjectionEntry>();
  while (seq >= minSeq && seq <= state.maxSeq && selected.size < limit) {
    const source = sourceAt(ranges, seq);
    if (!source) {
      if (!readRanges.some((range) => range.startSeq <= seq && seq <= range.endSeq))
        return { missingSeq: seq };
      seq += forward ? 1 : -1;
      continue;
    }
    const { entry, range } = source;
    selected.set(entry.seqStart, entry);
    seq = forward ? range.endSeq + 1 : range.startSeq - 1;
  }
  if (!selected.size)
    return {
      pagingMode: "source_ranges",
      entries: [],
      contextEntries: [],
      startSeq: null,
      endSeq: null,
      hasOlder: false,
      hasNewer: false,
    };
  const startSeq = forward ? boundary : seq + 1;
  const endSeq = forward ? seq - 1 : boundary;
  const page: TimelineProjectionEntry[] = [];
  const contextEntries: TimelineProjectionEntry[] = [];
  for (const [, entry] of [...selected].sort(([left], [right]) => left - right))
    (entry.seqStart < startSeq ? contextEntries : page).push(entry);
  return {
    pagingMode: "source_ranges",
    entries: page,
    contextEntries,
    startSeq,
    endSeq,
    hasOlder: startSeq > state.minSeq,
    hasNewer: endSeq < state.maxSeq,
  };
}
