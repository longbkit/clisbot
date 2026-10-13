import type { AgentTimelineRow } from "../agent-timeline-store-types.js";
import { mergeToolCallItems, type ProjectedTimelineRow } from "../timeline-projection.js";

interface ReadBudget {
  reserve(bytes: number): void;
  releaseBytes(bytes: number): void;
}

export function projectionRowBytes(rows: readonly AgentTimelineRow[]): number {
  return rows.reduce((bytes, row) => bytes + JSON.stringify(row).length * 2, 0);
}

/** Own mutable tool state; exported snapshots never share the mutable source ranges. */
export class ToolRowProjection {
  private readonly rows: ProjectedTimelineRow[] = [];
  private readonly latest = new Map<string, { row: ProjectedTimelineRow; bytes: number }>();

  append(rows: AgentTimelineRow[], budget: ReadBudget): AgentTimelineRow[] {
    const rawBytes = projectionRowBytes(rows);
    budget.reserve(rawBytes);
    const touched = new Set<{ row: ProjectedTimelineRow; bytes: number }>();
    for (const source of rows) {
      if (source.item.type !== "tool_call") continue;
      const previous = this.latest.get(source.item.callId);
      let row: ProjectedTimelineRow;
      if (
        previous &&
        previous.row.turnId === (source.turnId || undefined) &&
        previous.row.item.type === "tool_call"
      ) {
        row = previous.row;
        row.item = mergeToolCallItems(previous.row.item, source.item);
        row.timestamp = source.timestamp;
        row.seqEnd = source.seq;
        const last = row.sourceSeqRanges.at(-1)!;
        if (last.endSeq + 1 === source.seq) last.endSeq = source.seq;
        else row.sourceSeqRanges.push({ startSeq: source.seq, endSeq: source.seq });
        row.collapsed = ["tool_lifecycle"];
      } else {
        row = {
          seq: source.seq,
          item: source.item,
          timestamp: source.timestamp,
          ...(source.turnId ? { turnId: source.turnId } : {}),
          ...(source.providerMessageId ? { providerMessageId: source.providerMessageId } : {}),
          seqStart: source.seq,
          seqEnd: source.seq,
          sourceSeqRanges: [{ startSeq: source.seq, endSeq: source.seq }],
          collapsed: [],
        };
        this.rows.push(row);
      }
      const retained = previous?.row === row ? previous : { row, bytes: 0 };
      this.latest.set(source.item.callId, retained);
      touched.add(retained);
    }
    for (const retained of touched) {
      const { row } = retained;
      budget.releaseBytes(retained.bytes);
      // Measure each changed item once per batch, without serializing old ranges.
      const bytes =
        JSON.stringify({ ...row, sourceSeqRanges: [] }).length * 2 +
        row.sourceSeqRanges.length * 128;
      budget.reserve(bytes);
      retained.bytes = bytes;
    }
    budget.releaseBytes(projectionRowBytes(rows.filter((row) => row.item.type === "tool_call")));
    return rows.filter((row) => row.item.type !== "tool_call");
  }

  getRows(): ProjectedTimelineRow[] {
    return this.rows.map((row) => ({
      ...row,
      seq: row.seqStart,
      sourceSeqRanges: row.sourceSeqRanges.map((range) => ({ ...range })),
    }));
  }
}
