import { createHash } from "node:crypto";
import type {
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  TimelineDocumentPage,
  TimelineSourceRangePage,
} from "../agent-timeline-store-types.js";
import type { AgentTimelineItem, ToolCallDetail } from "../agent-sdk-types.js";
import {
  selectProjectedTimelinePage,
  projectTimelineRows,
  type ProjectedTimelinePageSelection,
  type TimelineProjectionEntry,
  type TimelineSeqRange,
} from "../timeline-projection.js";
import { SESSION_STORAGE_LIMITS } from "./paged-journal.js";
import type { SessionEventState, SessionEventStream } from "./session-event-log.js";

export type ProjectedTimelineFetchResult = AgentTimelineFetchResult &
  ProjectedTimelinePageSelection;

/** Entries above this stay on the wire as a preview plus a descriptor the client pages. */
const INLINE_BYTES = 64 * 1024;
const INLINE_RANGES = 128;
const READ_PAGE_ROWS = SESSION_STORAGE_LIMITS.indexPageRows;
const MERGE_STEP_ROWS = 64;
/** Above this a bounded window is no longer cheaper than projecting the whole history. */
const MAX_WINDOW_ROWS = 8192;
const GLOBAL_BYTES = 32 * 1024 * 1024;
let activeBytes = 0;

/** Projected history is derived per read and never retained per open agent. */
class ProjectionBudget {
  private bytes = 0;
  reserve(bytes: number): void {
    if (activeBytes + bytes > GLOBAL_BYTES)
      throw new Error("Projected history exceeds its read memory budget");
    this.bytes += bytes;
    activeBytes += bytes;
  }
  release(): void {
    activeBytes -= this.bytes;
    this.bytes = 0;
  }
}

function detailPreview(detail: ToolCallDetail): ToolCallDetail {
  switch (detail.type) {
    case "shell":
      return { type: detail.type, command: "", cwd: detail.cwd, exitCode: detail.exitCode };
    case "read":
    case "edit":
    case "write":
      return { type: detail.type, filePath: detail.filePath };
    case "search":
      return { type: detail.type, query: "", toolName: detail.toolName };
    case "fetch":
      return { type: detail.type, url: detail.url };
    case "worktree_setup":
      return {
        type: detail.type,
        worktreePath: detail.worktreePath,
        branchName: detail.branchName,
        log: "",
        commands: [],
      };
    case "sub_agent":
      return {
        type: detail.type,
        subAgentType: detail.subAgentType,
        childSessionId: detail.childSessionId,
        log: "",
      };
    case "plain_text":
      return { type: detail.type, label: detail.label, icon: detail.icon };
    case "plan":
      return { type: detail.type, text: "" };
    case "unknown":
      return { type: detail.type, input: null, output: null };
  }
}

function itemPreview(item: AgentTimelineItem): AgentTimelineItem {
  switch (item.type) {
    case "assistant_message":
    case "reasoning":
    case "user_message":
      return { ...item, text: "" };
    case "tool_call":
      return item.status === "failed"
        ? {
            ...item,
            detail: detailPreview(item.detail),
            metadata: undefined,
            error: "Deferred error details",
          }
        : { ...item, detail: detailPreview(item.detail), metadata: undefined, error: null };
    case "todo":
      return { ...item, items: [] };
    case "error":
      return { ...item, message: "" };
    case "notification":
      return { ...item, message: "" };
    // A plugin item's payload is opaque to the daemon, so the preview drops it whole
    // rather than guessing which of its fields are the heavy ones.
    case "plugin":
      return { ...item, data: null };
    case "compaction":
      return {
        type: item.type,
        status: item.status,
        trigger: item.trigger,
        preTokens: item.preTokens,
      };
  }
}

/** Stable across reads because it is derived only from facts the canonical log already fixes. */
function descriptorId(epoch: string, entry: TimelineProjectionEntry): string {
  return createHash("sha256").update(`${epoch}:${entry.seqStart}:${entry.seqEnd}`).digest("hex");
}

function projectionControl(state: SessionEventState, options: AgentTimelineFetchOptions) {
  const direction = options.direction ?? "tail";
  const staleCursor = options.cursor !== undefined && options.cursor.epoch !== state.epoch;
  const gap =
    !staleCursor &&
    direction === "after" &&
    options.cursor !== undefined &&
    state.minSeq > 0 &&
    options.cursor.seq < state.minSeq - 1;
  const reset = staleCursor || gap;
  return {
    direction,
    staleCursor,
    gap,
    reset,
    selectedDirection: reset ? ("tail" as const) : direction,
    limit:
      options.limit === 0 ? Number.MAX_SAFE_INTEGER : Math.max(1, Math.floor(options.limit ?? 40)),
  };
}

/** Only these merge with an adjacent row, so only these can truncate at a window edge. */
function mergesWithNeighbour(row: AgentTimelineRow): boolean {
  return row.item.type === "assistant_message" || row.item.type === "reasoning";
}

function containingRange(
  entry: TimelineProjectionEntry,
  seq: number,
): TimelineSeqRange | undefined {
  return entry.sourceSeqRanges.find((range) => range.startSeq <= seq && range.endSeq >= seq);
}

/** Follow direct canonical-to-display references, never a tool's min/max envelope. */
function selectSourceRanges(
  entries: readonly TimelineProjectionEntry[],
  state: SessionEventState,
  direction: "tail" | "before" | "after",
  cursor: number | undefined,
  limit: number,
): ProjectedTimelinePageSelection {
  const bySeq = new Map<number, TimelineProjectionEntry>();
  for (const entry of entries)
    for (const range of entry.sourceSeqRanges)
      for (let seq = range.startSeq; seq <= range.endSeq; seq += 1) bySeq.set(seq, entry);
  const forward = direction === "after";
  const boundary = forward
    ? Math.max(state.minSeq, (cursor ?? state.minSeq - 1) + 1)
    : Math.min(
        state.maxSeq,
        direction === "before" ? (cursor ?? state.maxSeq + 1) - 1 : state.maxSeq,
      );
  let seq = boundary;
  const selected = new Map<number, TimelineProjectionEntry>();
  while (seq >= state.minSeq && seq <= state.maxSeq && selected.size < limit) {
    const entry = bySeq.get(seq);
    const range = entry ? containingRange(entry, seq) : undefined;
    if (!entry || !range) throw new Error("Invalid projected source reference");
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

/**
 * Projection is logic, not layout: entries are derived from canonical rows on every read.
 * Nothing about the projected view is persisted, so nothing about it can go stale or corrupt.
 */
export class ProjectedTimeline {
  constructor(private readonly source: SessionEventStream<AgentTimelineRow>) {}

  /** Reads a canonical range in journal pages so one huge history cannot own the heap alone. */
  private async readRange(
    start: number,
    end: number,
    budget: ProjectionBudget,
  ): Promise<AgentTimelineRow[]> {
    const rows: AgentTimelineRow[] = [];
    for (let seq = start; seq <= end; seq += READ_PAGE_ROWS) {
      const page = await this.source.read(seq, Math.min(end, seq + READ_PAGE_ROWS - 1));
      let bytes = 0;
      for (const entry of page) {
        bytes += JSON.stringify(entry.value).length * 2;
        rows.push(entry.value);
      }
      budget.reserve(bytes);
    }
    return rows;
  }

  private async readRows(
    state: SessionEventState,
    budget: ProjectionBudget,
  ): Promise<AgentTimelineRow[]> {
    if (state.maxSeq === 0) return [];
    return this.readRange(state.minSeq, state.maxSeq, budget);
  }

  private async project(
    state: SessionEventState,
    budget: ProjectionBudget,
  ): Promise<TimelineProjectionEntry[]> {
    return projectTimelineRows({ rows: await this.readRows(state, budget), mode: "projected" });
  }

  /** The seq range a page of `span` rows starts from, before any merge can widen it. */
  private windowBounds(
    state: SessionEventState,
    span: number,
    direction: "tail" | "before" | "after",
    cursorSeq: number | undefined,
  ): { start: number; end: number } {
    if (direction === "after") {
      const start = Math.max(state.minSeq, (cursorSeq ?? state.minSeq - 1) + 1);
      return { start, end: Math.min(state.maxSeq, start + span - 1) };
    }
    const end =
      direction === "before"
        ? Math.min(state.maxSeq, (cursorSeq ?? state.maxSeq + 1) - 1)
        : state.maxSeq;
    return { start: Math.max(state.minSeq, end - span + 1), end };
  }

  /** Text merges only chain to a neighbour, so stepping outwards reaches the group edge. */
  private async extendMerges(
    rows: AgentTimelineRow[],
    state: SessionEventState,
    budget: ProjectionBudget,
  ): Promise<boolean> {
    while (rows[0] && rows[0].seq > state.minSeq && mergesWithNeighbour(rows[0])) {
      const from = Math.max(state.minSeq, rows[0].seq - MERGE_STEP_ROWS);
      const step = await this.readRange(from, rows[0].seq - 1, budget);
      if (!step.length) break;
      rows.unshift(...step);
      if (rows.length > MAX_WINDOW_ROWS) return false;
    }
    let last = rows.at(-1);
    while (last && last.seq < state.maxSeq && mergesWithNeighbour(last)) {
      const to = Math.min(state.maxSeq, last.seq + MERGE_STEP_ROWS);
      const step = await this.readRange(last.seq + 1, to, budget);
      if (!step.length) break;
      rows.push(...step);
      if (rows.length > MAX_WINDOW_ROWS) return false;
      last = rows.at(-1);
    }
    return true;
  }

  /** A tool lifecycle can reach across the whole history; pull its other rows by canonical id. */
  private async pullToolRows(rows: AgentTimelineRow[]): Promise<boolean> {
    const present = new Set(rows.map((row) => row.seq));
    const missing = new Set<number>();
    for (const row of rows) {
      if (row.item.type !== "tool_call") continue;
      const { seqs, complete } = await this.source.owner.toolOccurrences(row.item.callId);
      if (!complete) return false;
      for (const seq of seqs) if (!present.has(seq)) missing.add(seq);
    }
    if (missing.size > MAX_WINDOW_ROWS) return false;
    for (const seq of missing) {
      const entry = (await this.source.read(seq, seq))[0];
      if (entry) rows.push(entry.value);
    }
    if (missing.size) rows.sort((left, right) => left.seq - right.seq);
    return true;
  }

  /**
   * A page needs only the rows that can reach it. Projecting that set gives the same
   * entries as projecting everything — with a bounded read. `null` means the window
   * would grow past the point where bounding is still cheaper than a full projection.
   */
  private async windowRows(
    state: SessionEventState,
    span: number,
    direction: "tail" | "before" | "after",
    cursorSeq: number | undefined,
    budget: ProjectionBudget,
  ): Promise<AgentTimelineRow[] | null> {
    const { start, end } = this.windowBounds(state, span, direction, cursorSeq);
    if (end < start) return [];
    const rows = await this.readRange(start, end, budget);
    if (!(await this.extendMerges(rows, state, budget))) return null;
    return (await this.pullToolRows(rows)) ? rows : null;
  }

  /** Widens until the page cannot be truncated by its own window, then gives up on bounding. */
  private async pageRows(
    state: SessionEventState,
    direction: "tail" | "before" | "after",
    cursorSeq: number | undefined,
    limit: number,
    budget: ProjectionBudget,
  ): Promise<AgentTimelineRow[]> {
    if (state.maxSeq === 0) return [];
    if (limit >= MAX_WINDOW_ROWS) return this.readRows(state, budget);
    for (let span = Math.max(MERGE_STEP_ROWS, limit * 8); span <= MAX_WINDOW_ROWS; span *= 4) {
      const rows = await this.windowRows(state, span, direction, cursorSeq, budget);
      if (!rows) break;
      const covers =
        rows.length === 0 || (rows[0]!.seq <= state.minSeq && rows.at(-1)!.seq >= state.maxSeq);
      // One spare entry at each edge proves the returned page is not the truncated one.
      if (covers || projectTimelineRows({ rows, mode: "projected" }).length > limit + 1)
        return rows;
    }
    return this.readRows(state, budget);
  }

  /** A large entry travels as a preview plus a descriptor; the client pages the rest by id. */
  private defer(epoch: string, entry: TimelineProjectionEntry): TimelineProjectionEntry {
    const oversizedItem = Buffer.byteLength(JSON.stringify(entry.item)) > INLINE_BYTES;
    const oversizedRanges = entry.sourceSeqRanges.length > INLINE_RANGES;
    if (!oversizedItem && !oversizedRanges) return entry;
    const id = descriptorId(epoch, entry);
    const result: TimelineProjectionEntry = { ...entry };
    if (oversizedItem) {
      result.item = itemPreview(entry.item);
      result.deferredPayload = {
        id,
        byteLength: Buffer.byteLength(JSON.stringify(entry.item)),
        format: "timeline_item_json",
      };
    }
    if (oversizedRanges) {
      result.sourceSeqRanges = [];
      result.sourceSeqRangesRef = { id, count: entry.sourceSeqRanges.length };
    }
    return result;
  }

  async fetch(options: AgentTimelineFetchOptions = {}): Promise<ProjectedTimelineFetchResult> {
    const state = await this.source.state();
    const control = projectionControl(state, options);
    const budget = new ProjectionBudget();
    try {
      const rows =
        options.pagingMode === "source_ranges"
          ? await this.readRows(state, budget)
          : await this.pageRows(
              state,
              control.selectedDirection,
              options.cursor?.seq,
              control.limit,
              budget,
            );
      const page =
        options.pagingMode === "source_ranges"
          ? selectSourceRanges(
              projectTimelineRows({ rows, mode: "projected" }),
              state,
              control.selectedDirection,
              options.cursor?.seq,
              Math.min(control.limit, 200),
            )
          : selectProjectedTimelinePage({
              rows,
              // A bounded window must still answer for the whole history it was cut from.
              ...(state.maxSeq > 0
                ? { bounds: { minSeq: state.minSeq, maxSeq: state.maxSeq } }
                : {}),
              direction: control.selectedDirection,
              cursorSeq: options.cursor?.seq,
              limit: control.limit,
            });
      const deferrable = options.allowDeferredPayloads === true;
      return {
        epoch: state.epoch,
        direction: control.direction,
        reset: control.reset,
        staleCursor: control.staleCursor,
        gap: control.gap,
        window: { minSeq: state.minSeq, maxSeq: state.maxSeq, nextSeq: state.maxSeq + 1 },
        rows: [],
        ...page,
        entries: deferrable
          ? page.entries.map((entry) => this.defer(state.epoch, entry))
          : page.entries,
        ...(page.contextEntries
          ? {
              contextEntries: deferrable
                ? page.contextEntries.map((entry) => this.defer(state.epoch, entry))
                : page.contextEntries,
            }
          : {}),
      };
    } finally {
      budget.release();
    }
  }

  /** Resolves a descriptor by re-deriving it; an unknown or stale id can never read a payload. */
  private async resolve(epoch: string, id: string): Promise<TimelineProjectionEntry> {
    const state = await this.source.state();
    if (state.epoch !== epoch) throw new Error("Stale timeline document epoch");
    const budget = new ProjectionBudget();
    try {
      for (const entry of await this.project(state, budget))
        if (descriptorId(epoch, entry) === id) return entry;
    } finally {
      budget.release();
    }
    throw new Error("Invalid or stale projected document descriptor");
  }

  async payload(options: {
    epoch: string;
    id: string;
    offset?: number;
    limit?: number;
  }): Promise<TimelineDocumentPage> {
    const entry = await this.resolve(options.epoch, options.id);
    const text = JSON.stringify(entry.item);
    const totalBytes = Buffer.byteLength(text);
    const offset = options.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > totalBytes)
      throw new Error("Invalid timeline payload page");
    const end = Math.min(totalBytes, offset + (options.limit ?? INLINE_BYTES));
    return {
      text: Buffer.from(text).subarray(offset, end).toString("utf8"),
      nextOffset: end < totalBytes ? end : null,
      totalBytes,
    };
  }

  async sourceRanges(options: {
    epoch: string;
    id: string;
    offset?: number;
    limit?: number;
    seq?: number;
  }): Promise<TimelineSourceRangePage> {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? INLINE_RANGES;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > INLINE_RANGES
    )
      throw new Error("Invalid source range page");
    const entry = await this.resolve(options.epoch, options.id);
    const total = entry.sourceSeqRanges.length;
    if (options.seq !== undefined) {
      const range = containingRange(entry, options.seq);
      return { ranges: range ? [range] : [], nextOffset: null, totalCount: total };
    }
    const stop = Math.min(total, offset + limit);
    return {
      ranges: entry.sourceSeqRanges.slice(offset, stop),
      nextOffset: stop < total ? stop : null,
      totalCount: total,
    };
  }
}
