// A Chat's `transcript.jsonl`: append-only, one line per message, seq allocated
// here (docs/features/bots-and-chats/README.md, D5). Reuses `SessionEventLog`
// for the file pair, the fsync'd append, the rebuildable index and seq-window
// reads; this wrapper owns seq allocation and the id lookup.
import type { ChatMessagePayload, ChatTranscriptDirection } from "@getpaseo/protocol/chats/types";
import { SessionEventLog } from "../agent/session-storage/session-event-log.js";
import { KeyedSerialQueue } from "./keyed-queue.js";

export type TranscriptLine = ChatMessagePayload;
/** What a caller appends: the line without the seq the log allocates. */
export type TranscriptLineInput = Omit<ChatMessagePayload, "seq">;

export interface TranscriptWindow {
  lines: TranscriptLine[];
  hasOlder: boolean;
  hasNewer: boolean;
  startSeq: number;
  endSeq: number;
}

export interface TranscriptFetchOptions {
  direction?: ChatTranscriptDirection;
  cursor?: { seq: number };
  /** Lines per page; `0` = the whole window. */
  limit?: number;
}

const TRANSCRIPT_STEM = "transcript";
const TRANSCRIPT_KIND = "transcript" as const;
/** The index namespace of a message id lookup. */
const MESSAGE_ID_NAMESPACE = "transcript-message";
/** How far back `findById` scans when the index has no lookup for the id. */
const RECENT_SCAN_LINES = 256;
const DEFAULT_PAGE_LIMIT = 200;

export class TranscriptLog {
  private readonly log: SessionEventLog;
  private readonly writes = new KeyedSerialQueue();

  constructor(readonly directory: string) {
    this.log = SessionEventLog.for(directory, { stem: TRANSCRIPT_STEM });
  }

  /** `minSeq`/`maxSeq` of the transcript; `0/0` when empty. */
  async state(): Promise<{ minSeq: number; maxSeq: number }> {
    const { minSeq, maxSeq } = await this.log.state(TRANSCRIPT_KIND);
    return { minSeq, maxSeq };
  }

  /**
   * Appends one line with the next seq. Appends are serialized here, not in the
   * event log's lock: the seq read and the write must be one step, and the
   * log's `append` already takes that lock, so nesting would deadlock.
   */
  append(input: TranscriptLineInput): Promise<TranscriptLine> {
    return this.writes.run("append", async () => {
      const seq = (await this.log.state(TRANSCRIPT_KIND)).maxSeq + 1;
      const value = structuredClone(input);
      await this.log.append(TRANSCRIPT_KIND, [{ seq, value }]);
      await this.log.putId(MESSAGE_ID_NAMESPACE, input.id, seq);
      return { ...value, seq };
    });
  }

  /** Lines in `[start, end]`, oldest first. Seqs never carry gaps, so the read is one page. */
  private async read(start: number, end: number): Promise<TranscriptLine[]> {
    if (end < start) return [];
    const entries = await this.log.read<TranscriptLineInput>(TRANSCRIPT_KIND, start, end);
    // The read parsed a fresh object per entry; giving it the seq in place copies nothing.
    return entries.map((entry) => Object.assign(entry.value, { seq: entry.seq }));
  }

  /** A seq window in the `fetch_agent_timeline` shape: tail by default, or around a cursor. */
  async fetch(options: TranscriptFetchOptions = {}): Promise<TranscriptWindow> {
    const state = await this.state();
    const { start, end } = selectRange(state, options);
    const lines = await this.read(start, end);
    return {
      lines,
      hasOlder: lines.length > 0 && start > state.minSeq,
      hasNewer: lines.length > 0 && end < state.maxSeq,
      startSeq: lines.length ? start : 0,
      endSeq: lines.length ? end : 0,
    };
  }

  /** The newest `limit` lines with `seq > afterSeq`, oldest first; the context window read. */
  async since(afterSeq: number, limit: number): Promise<TranscriptLine[]> {
    const { minSeq, maxSeq } = await this.state();
    const start = Math.max(minSeq, afterSeq + 1, maxSeq - limit + 1);
    return this.read(start, maxSeq);
  }

  /**
   * The line carrying a message id, for idempotent sends. The index lookup is written after
   * the append, so a crash between the two leaves the id findable only by the tail scan.
   */
  async findById(id: string): Promise<TranscriptLine | null> {
    const seq = await this.log.lookupId(MESSAGE_ID_NAMESPACE, id);
    if (seq !== undefined && seq > 0) {
      const [line] = await this.read(seq, seq);
      if (line?.id === id) return line;
    }
    const { minSeq, maxSeq } = await this.state();
    const recent = await this.read(Math.max(minSeq, maxSeq - RECENT_SCAN_LINES + 1), maxSeq);
    return recent.find((line) => line.id === id) ?? null;
  }

  /** Checkpoints the index so a clean stop leaves no tail to rescan. */
  flush(): Promise<void> {
    return this.log.flush();
  }
}

function selectRange(
  state: { minSeq: number; maxSeq: number },
  options: TranscriptFetchOptions,
): { start: number; end: number } {
  const limit =
    options.limit === 0
      ? Math.max(1, state.maxSeq)
      : Math.max(1, Math.floor(options.limit ?? DEFAULT_PAGE_LIMIT));
  let start = state.minSeq;
  let end = state.maxSeq;
  if (options.direction === "after") {
    start = Math.max(start, (options.cursor?.seq ?? 0) + 1);
    end = Math.min(end, start + limit - 1);
    return { start, end };
  }
  if (options.direction === "before")
    end = Math.min(end, (options.cursor?.seq ?? state.maxSeq + 1) - 1);
  start = Math.max(start, end - limit + 1);
  return { start, end };
}
