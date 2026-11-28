// Page selection over a bounded window of canonical (or already projected) timeline rows.
//
// Upstream v0.17 moved page selection into the retained `TimelineProjection` of the in-memory
// store and kept the old free function only as a test oracle. Clisbot's durable session storage
// and its in-memory fallback read a window of rows per request, so they select a page by building
// the same projection over that window. That keeps one set of paging rules, including
// `wholeTurns`, for every read path.

import type { AgentTimelineRow } from "../agent-timeline-store-types.js";
import {
  TimelineProjection,
  type ProjectedTimelinePageSelection,
  type ProjectedTimelineRow,
  type TimelineLimitDirection,
} from "../timeline-projection.js";

export interface TimelinePageInput {
  rows: readonly AgentTimelineRow[];
  /** The history's seq bounds; defaults to the rows' own span. */
  bounds?: { minSeq: number; maxSeq: number };
  direction: TimelineLimitDirection;
  cursorSeq?: number;
  limit?: number;
  /** Extend a tail or before page to whole turns, as the in-memory store does. */
  wholeTurns?: boolean;
}

function rowBounds(rows: readonly AgentTimelineRow[]): { minSeq: number; maxSeq: number } {
  let minSeq = Infinity;
  let maxSeq = 0;
  for (const row of rows) {
    const projected = row as Partial<ProjectedTimelineRow>;
    minSeq = Math.min(minSeq, projected.seqStart ?? row.seq);
    maxSeq = Math.max(maxSeq, projected.seqEnd ?? row.seq);
  }
  return Number.isFinite(minSeq) ? { minSeq, maxSeq } : { minSeq: 0, maxSeq: 0 };
}

export function selectProjectedTimelinePage(
  input: TimelinePageInput,
): ProjectedTimelinePageSelection {
  const projection = new TimelineProjection(input.rows);
  const page = projection.selectPage({
    bounds: input.bounds ?? rowBounds(input.rows),
    direction: input.direction,
    cursorSeq: input.cursorSeq,
    limit: input.limit,
    wholeTurns: input.wholeTurns,
  });
  return {
    ...page,
    entries: page.entries.map((row) => {
      const { seq: _seq, ...entry } = row as ProjectedTimelineRow;
      return entry;
    }),
  };
}
