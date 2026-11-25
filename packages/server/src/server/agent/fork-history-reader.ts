import { buildAgentForkContextAttachment } from "./activity-curator.js";
import type {
  AgentTimelineCursor,
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
} from "./agent-timeline-store-types.js";
import { timelineItemIdentity } from "@clisbot/protocol/timeline-identity";
import { projectTimelineRows } from "./timeline-projection.js";

/**
 * Fork history reads only as much of a session as the fork attachment can carry.
 *
 * A `limit: 0` read asked durable storage for the whole history in one page. A long session
 * exceeds the 8 MiB session page budget (`SESSION_STORAGE_LIMITS.readPageBytes`) and every
 * fork of it failed with "Session page exceeds byte budget". This reader pages backwards from
 * the selected boundary, halves a page that is too large, and stops once the attachment is
 * full, the session start is reached, or `MAX_SCANNED_BYTES` of rows were held.
 */
export type FetchForkTimeline = (
  options: AgentTimelineFetchOptions,
) => Promise<AgentTimelineFetchResult<AgentTimelineRow>>;

const PAGE_BUDGET_ERROR = "Session page exceeds byte budget; request a smaller page";
const FIRST_PAGE_ROWS = 64;
const MAX_PAGE_ROWS = 2048;
/** Rows held at once while reading backwards; history past it is reported as omitted. */
const MAX_SCANNED_BYTES = 16 * 1024 * 1024;
/** The session's timeline was rewritten (rewind, reset) between two pages of one read. */
export class ForkTimelineChangedError extends Error {
  constructor() {
    super("The session changed while its history was read. Fork again.");
    this.name = "ForkTimelineChangedError";
  }
}
const POSITION_GONE = "Selected timeline position is no longer available.";
const MESSAGE_GONE = "Selected assistant message is no longer available.";
const CHECKPOINT_CHANGED =
  "This checkpoint changed after it was created. Fork from a later completed response instead.";

/** Reads pages whose row count adapts to the byte budget the store enforces. */
export class AdaptiveTimelinePager {
  private limit = FIRST_PAGE_ROWS;
  private epoch: string | null;

  /** With `epoch`, every page must come from that epoch; otherwise the first page pins it. */
  constructor(
    private readonly fetch: FetchForkTimeline,
    epoch?: string,
  ) {
    this.epoch = epoch ?? null;
  }

  async read(
    direction: "tail" | "before" | "after",
    cursorSeq?: number,
  ): Promise<AgentTimelineFetchResult<AgentTimelineRow>> {
    for (;;) {
      let page: AgentTimelineFetchResult<AgentTimelineRow>;
      try {
        page = await this.fetch({
          direction,
          limit: this.limit,
          ...(cursorSeq !== undefined && this.epoch !== null
            ? { cursor: { epoch: this.epoch, seq: cursorSeq } }
            : {}),
        });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== PAGE_BUDGET_ERROR || this.limit === 1)
          throw error;
        this.limit = Math.max(1, Math.floor(this.limit / 2));
        continue;
      }
      if (this.epoch === null) this.epoch = page.epoch;
      else if (page.epoch !== this.epoch || page.reset) throw new ForkTimelineChangedError();
      if (page.rows.length >= this.limit) this.limit = Math.min(MAX_PAGE_ROWS, this.limit * 2);
      return page;
    }
  }
}

function rowBytes(rows: readonly AgentTimelineRow[]): number {
  return rows.reduce((total, row) => total + JSON.stringify(row).length * 2, 0);
}

function isText(row: AgentTimelineRow | undefined): boolean {
  return row?.item.type === "assistant_message" || row?.item.type === "reasoning";
}

/**
 * The first read row may continue a message that starts before it. Drop that group so the
 * history never shows half a message as if it were whole; the omission marker covers it.
 */
function dropPartialLeadingGroup(rows: AgentTimelineRow[]): AgentTimelineRow[] {
  if (!isText(rows[0])) return rows;
  const first = projectTimelineRows({ rows, mode: "projected" })[0];
  if (!first) return rows;
  const rest = rows.filter((row) => row.seq > first.seqEnd);
  // One message larger than the whole read stays: its head is truncated, not lost.
  return rest.length > 0 ? rest : rows;
}

async function locateMessage(
  pager: AgentTimelineFetchResult<AgentTimelineRow>,
  read: AdaptiveTimelinePager,
  messageId: string,
): Promise<number> {
  let page = pager;
  for (;;) {
    const match = page.rows.findLast(
      (row) => row.item.type === "assistant_message" && row.item.messageId === messageId,
    );
    if (match) return match.seq;
    const oldest = page.rows[0];
    if (!oldest || oldest.seq <= page.window.minSeq) throw new Error(MESSAGE_GONE);
    page = await read.read("before", oldest.seq);
  }
}

/** Merge key of a tool lifecycle or plugin row; text merges only with its neighbour. */
function mergeKey(row: AgentTimelineRow): string | null {
  const identity = timelineItemIdentity(row.item);
  return identity === null ? null : `${row.item.type}:${identity}`;
}

/** Whether `row` may fold into a later row with the same key (tools only within a turn). */
function canMergeWith(row: AgentTimelineRow, later: { turnIds: Set<string | undefined> }) {
  return row.item.type !== "tool_call" || later.turnIds.has(row.turnId);
}

interface BoundaryEvidence {
  /** Rows after the anchor that can fold into a row at or before it. */
  rows: AgentTimelineRow[];
  /** Keys first seen after the anchor, with the turns they occur in. */
  unknown: Map<string, { turnIds: Set<string | undefined> }>;
}

/**
 * Reads every row after the anchor once, keeping only those that can merge across it: the
 * text continuing the anchor's message and later rows of a tool or plugin already in the
 * window. Nothing else is held, so the scan is bounded in memory however long it runs.
 */
async function readBoundaryEvidence(
  read: AdaptiveTimelinePager,
  anchorSeq: number,
  maxSeq: number,
  window: readonly AgentTimelineRow[],
): Promise<BoundaryEvidence> {
  const known = new Set(window.map(mergeKey).filter((key) => key !== null));
  const evidence: BoundaryEvidence = { rows: [], unknown: new Map() };
  let bytes = 0;
  // The anchor's message may continue in adjacent chunks of the same kind and turn.
  let previous = window.find((row) => row.seq === anchorSeq);
  let continuing = isText(previous);
  for (let seq = anchorSeq; seq < maxSeq; ) {
    const page = await read.read("after", seq);
    if (!page.rows.length) break;
    for (const row of page.rows) {
      continuing &&=
        row.item.type === previous?.item.type &&
        row.turnId === previous.turnId &&
        row.seq === previous.seq + 1;
      previous = row;
      const key = mergeKey(row);
      if (continuing || (key !== null && known.has(key))) {
        evidence.rows.push(row);
        bytes += rowBytes([row]);
      } else if (key !== null) {
        const entry = evidence.unknown.get(key) ?? { turnIds: new Set() };
        entry.turnIds.add(row.turnId);
        evidence.unknown.set(key, entry);
      }
    }
    if (bytes > MAX_SCANNED_BYTES) throw new Error(CHECKPOINT_CHANGED);
    seq = page.rows.at(-1)!.seq;
  }
  return evidence;
}

/**
 * Older history that was not read can still hold the start of a tool or plugin that ends
 * after the anchor. Scan it page by page for those keys, holding nothing; a match means the
 * checkpoint cannot be proven unchanged, so the fork is refused as the whole-history read
 * would refuse it.
 */
async function assertNoOlderOccurrence(
  read: AdaptiveTimelinePager,
  beforeSeq: number,
  unknown: BoundaryEvidence["unknown"],
): Promise<void> {
  for (let cursor = beforeSeq; unknown.size > 0; ) {
    const page = await read.read("before", cursor);
    if (!page.rows.length) return;
    for (const row of page.rows) {
      const later = mergeKey(row) === null ? undefined : unknown.get(mergeKey(row)!);
      if (later && canMergeWith(row, later)) throw new Error(CHECKPOINT_CHANGED);
    }
    cursor = page.rows[0]!.seq;
    if (cursor <= page.window.minSeq) return;
  }
}

export interface ForkHistoryRows {
  rows: AgentTimelineRow[];
  epoch: string;
  olderOmitted: boolean;
}

/**
 * Reads the rows a fork attachment needs: the newest history up to the selected boundary,
 * plus every later row that can merge across it, so the builder refuses a checkpoint that
 * changed exactly as a whole-history read would.
 * `isFull` reports when the rows read so far already overflow the attachment.
 */
export async function readForkHistoryRows(input: {
  fetch: FetchForkTimeline;
  boundaryCursor?: AgentTimelineCursor | null;
  boundaryMessageId?: string | null;
  isFull: (rows: AgentTimelineRow[], epoch: string, olderOmitted: boolean) => boolean;
}): Promise<ForkHistoryRows> {
  const read = new AdaptiveTimelinePager(input.fetch);
  const tail = await read.read("tail");
  if (!tail.rows.length) return { rows: [], epoch: tail.epoch, olderOmitted: false };
  const anchorSeq = await resolveAnchor(tail, read, input);
  const backward = await readBackward(read, tail, anchorSeq, input.isFull);
  const evidence =
    anchorSeq < tail.window.maxSeq
      ? await readBoundaryEvidence(read, anchorSeq, tail.window.maxSeq, backward.rows)
      : null;
  if (evidence && !backward.reachedStart && backward.rows[0])
    await assertNoOlderOccurrence(read, backward.rows[0].seq, evidence.unknown);
  const kept = backward.reachedStart ? backward.rows : dropPartialLeadingGroup(backward.rows);
  return {
    rows: [...kept, ...(evidence?.rows ?? [])],
    epoch: tail.epoch,
    olderOmitted: !backward.reachedStart,
  };
}

/** The newest row the fork includes: the tail, a timeline cursor, or an assistant message. */
async function resolveAnchor(
  tail: AgentTimelineFetchResult<AgentTimelineRow>,
  read: AdaptiveTimelinePager,
  input: { boundaryCursor?: AgentTimelineCursor | null; boundaryMessageId?: string | null },
): Promise<number> {
  const { epoch, window } = tail;
  if (input.boundaryCursor) {
    const { seq } = input.boundaryCursor;
    if (input.boundaryCursor.epoch !== epoch || seq < window.minSeq || seq > window.maxSeq)
      throw new Error(POSITION_GONE);
    return seq;
  }
  const messageId = input.boundaryMessageId?.trim();
  return messageId ? locateMessage(tail, read, messageId) : window.maxSeq;
}

/**
 * Pages back from the anchor until the attachment is full, the session start is reached or
 * `MAX_SCANNED_BYTES` are held.
 */
async function readBackward(
  read: AdaptiveTimelinePager,
  tail: AgentTimelineFetchResult<AgentTimelineRow>,
  anchorSeq: number,
  isFull: (rows: AgentTimelineRow[], epoch: string, olderOmitted: boolean) => boolean,
): Promise<{ rows: AgentTimelineRow[]; reachedStart: boolean }> {
  const pages: AgentTimelineRow[][] = [];
  const collected = () => pages.toReversed().flat();
  let bytes = 0;
  let cursor = anchorSeq + 1;
  for (;;) {
    const page = await read.read("before", cursor);
    if (page.rows.length) {
      pages.push(page.rows);
      bytes += rowBytes(page.rows);
      cursor = page.rows[0]!.seq;
    }
    if (!page.rows.length || cursor <= page.window.minSeq)
      return { rows: collected(), reachedStart: true };
    const rows = collected();
    if (!rows.some((row) => row.seq === anchorSeq)) throw new Error(POSITION_GONE);
    if (bytes >= MAX_SCANNED_BYTES || isFull(rows, tail.epoch, true))
      return { rows, reachedStart: false };
  }
}

type ForkContext = ReturnType<typeof buildAgentForkContextAttachment>;

/** One fork attachment from a session timeline, for every fork path (Work, Bot, Hub). */
export async function readAgentForkContext(input: {
  fetch: FetchForkTimeline;
  sourceAgentId?: string;
  boundaryCursor?: AgentTimelineCursor | null;
  boundaryMessageId?: string | null;
  agentTitle?: string | null;
  cwd?: string | null;
}): Promise<ForkContext> {
  const build = (rows: AgentTimelineRow[], epoch: string, olderOmitted: boolean): ForkContext =>
    buildAgentForkContextAttachment({
      rows,
      ...(input.sourceAgentId ? { sourceSession: { agentId: input.sourceAgentId, epoch } } : {}),
      cursorBoundary: input.boundaryCursor
        ? { timelineEpoch: epoch, cursor: input.boundaryCursor }
        : null,
      boundaryMessageId: input.boundaryMessageId,
      agentTitle: input.agentTitle,
      cwd: input.cwd,
      olderOmitted,
    });
  const history = await readForkHistoryRows({
    fetch: input.fetch,
    boundaryCursor: input.boundaryCursor,
    boundaryMessageId: input.boundaryMessageId,
    isFull: (rows, epoch, olderOmitted) => build(rows, epoch, olderOmitted).truncated,
  });
  return build(history.rows, history.epoch, history.olderOmitted);
}
