import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createDurableDirectory, writeDurableFile } from "./durable-file.js";
import {
  SESSION_STORAGE_LIMITS,
  type JournalEntry,
  type JournalOperation,
} from "./paged-journal.js";
import {
  TOOL_OCCURRENCE_LIMIT,
  absorbEnvelope,
  absorbLine,
  checkpointDue,
  emptyIndex,
  ensureSeqRanges,
  isIndex,
  markScanned,
  mergeId,
  seqRange,
  type EventPointer,
  type SessionEventEnvelope,
  type SessionEventIndex,
  type SessionMessageAnchor,
} from "./session-event-index.js";
import { withSessionLogWriteIo } from "./session-storage-io.js";

export { AMBIGUOUS_ID, messagePreview, type SessionMessageAnchor } from "./session-event-index.js";

/** One canonical stream per record family. Every family shares `events.jsonl`. */
export type SessionEventKind = "timeline" | "submission" | "permission";

export interface SessionEventState {
  epoch: string;
  minSeq: number;
  maxSeq: number;
  operationOrder: number;
  revision: number;
}

/**
 * The whole durable session: one append-only `events.jsonl` plus one rebuildable
 * `events.index.json`. Kinds share the file, so they must also share one writer lock —
 * two locks over one file race on the append offset.
 */
export class SessionEventLog {
  private static readonly open = new Map<string, SessionEventLog>();
  private static readonly maxOpen = 128;
  readonly directory: string;
  private index: SessionEventIndex | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private removed = false;
  private busy = 0;
  private pendingRows = 0;
  private pendingBytes = 0;
  /** Size of the last checkpoint, which sets how much tail the next one waits for. */
  private saved = { pointers: 0, bytes: 0 };

  private constructor(directory: string) {
    this.directory = directory;
  }

  /** One log per directory: the lock and the cached index must be shared by every kind. */
  static for(directory: string): SessionEventLog {
    const resolved = path.resolve(directory);
    const existing = SessionEventLog.open.get(resolved);
    if (existing) {
      SessionEventLog.open.delete(resolved);
      SessionEventLog.open.set(resolved, existing);
      return existing;
    }
    // Dropping an idle log only drops its cached index. Evicting a busy one would
    // hand the next caller a second writer over the same file.
    for (const [key, log] of SessionEventLog.open) {
      if (SessionEventLog.open.size < SessionEventLog.maxOpen) break;
      if (!log.busy) SessionEventLog.open.delete(key);
    }
    const log = new SessionEventLog(resolved);
    SessionEventLog.open.set(resolved, log);
    return log;
  }

  private async lease<R>(operation: () => Promise<R>): Promise<R> {
    this.busy += 1;
    try {
      return await operation();
    } finally {
      this.busy -= 1;
    }
  }

  static forget(directory: string): void {
    SessionEventLog.open.delete(path.resolve(directory));
  }

  /** How many session logs currently hold a cached index. */
  static get residentCount(): number {
    return SessionEventLog.open.size;
  }

  /** The cap on resident logs. Eviction only ever drops an idle log's cached index. */
  static get residentLimit(): number {
    return SessionEventLog.maxOpen;
  }

  /** Drops every cached index. Only a new process does this for real; tests simulate it. */
  static forgetAll(): void {
    SessionEventLog.open.clear();
  }

  /** Checkpoints every open log so a clean shutdown leaves no tail to rescan. */
  static async flushAll(): Promise<void> {
    for (const log of Array.from(SessionEventLog.open.values())) await log.flush();
  }

  stream<T>(kind: SessionEventKind): SessionEventStream<T> {
    return new SessionEventStream<T>(this, kind);
  }

  private get eventPath(): string {
    return path.join(this.directory, "events.jsonl");
  }
  private get indexPath(): string {
    return path.join(this.directory, "events.index.json");
  }

  /** Serializes every mutation and every index repair against this session's files. */
  exclusive<R>(operation: () => Promise<R>): Promise<R> {
    return this.lease(() => {
      const task = this.tail.catch(() => undefined).then(operation);
      this.tail = task;
      return task;
    });
  }

  async flush(): Promise<void> {
    await this.tail.catch(() => undefined);
    if (this.pendingRows || this.pendingBytes)
      await this.exclusive(async () => {
        const index = await this.load();
        if (this.pendingRows || this.pendingBytes) await this.save(index);
      });
  }

  private async load(): Promise<SessionEventIndex> {
    if (this.index) return this.index;
    await createDurableDirectory(this.directory);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(this.indexPath, "utf8"));
    } catch {
      // A missing or damaged derived index is never fatal; the log carries every fact.
      return this.rebuild();
    }
    if (!isIndex(parsed)) return this.rebuild();
    const index: SessionEventIndex = parsed;
    ensureSeqRanges(index);
    this.index = index;
    const size = await fs.stat(this.eventPath).then(
      (stat) => stat.size,
      () => 0,
    );
    if (size < index.scannedBytes) return this.rebuild();
    if (size > index.scannedBytes) await this.catchUp(index, size);
    return index;
  }

  /** Folds in whatever was appended after the last checkpoint. Bounded by that gap. */
  private async catchUp(index: SessionEventIndex, size: number): Promise<void> {
    const handle = await fs.open(this.eventPath, "r");
    let text: string;
    try {
      const buffer = Buffer.alloc(size - index.scannedBytes);
      await handle.read(buffer, 0, buffer.length, index.scannedBytes);
      text = buffer.toString("utf8");
    } finally {
      await handle.close();
    }
    const anchors = new Map(index.anchors.map((anchor) => [anchor.messageId, anchor]));
    let offset = index.scannedBytes;
    for (const line of text.split("\n")) {
      if (line) absorbLine(index, anchors, line, offset);
      offset += Buffer.byteLength(line) + 1;
    }
    index.anchors = [...anchors.values()].sort((left, right) => left.seq - right.seq);
    markScanned(index, size);
  }

  /** Reconstructs pointers, anchors, id lookups and the operation order from the log alone. */
  private async rebuild(): Promise<SessionEventIndex> {
    const index = emptyIndex();
    let text: string;
    try {
      text = await fs.readFile(this.eventPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.save(index);
      return index;
    }
    const anchors = new Map<string, SessionMessageAnchor>();
    let offset = 0;
    for (const line of text.split("\n")) {
      const length = Buffer.byteLength(line) + 1;
      if (line) absorbLine(index, anchors, line, offset);
      offset += length;
    }
    index.anchors = [...anchors.values()].sort((left, right) => left.seq - right.seq);
    markScanned(index, offset === 0 ? 0 : Buffer.byteLength(text));
    await this.save(index);
    return index;
  }

  private async save(index: SessionEventIndex): Promise<void> {
    this.index = index;
    this.pendingRows = 0;
    this.pendingBytes = 0;
    const text = JSON.stringify(index);
    this.saved = { pointers: Object.keys(index.pointers).length, bytes: Buffer.byteLength(text) };
    await withSessionLogWriteIo(() => writeDurableFile(this.indexPath, text));
  }

  /** Checkpoints only when the unwritten tail is large enough to be worth rescanning. */
  private async checkpoint(index: SessionEventIndex, rows: number, bytes: number): Promise<void> {
    this.pendingRows += rows;
    this.pendingBytes += bytes;
    if (checkpointDue({ rows: this.pendingRows, bytes: this.pendingBytes }, this.saved))
      await this.save(index);
  }

  async state(kind: SessionEventKind): Promise<SessionEventState> {
    const index = await this.lease(() => this.load());
    const { minSeq, maxSeq } = seqRange(index, kind);
    return {
      epoch: index.epoch,
      minSeq,
      maxSeq,
      operationOrder: index.operationOrder,
      revision: index.revision,
    };
  }

  /**
   * Appends every entry with one write and one fsync. The index learns about the entries only
   * after the fsync returns, so a failed append leaves no pointer to an unacknowledged line.
   */
  async append<T>(kind: SessionEventKind, entries: readonly JournalEntry<T>[]): Promise<void> {
    if (!entries.length) return;
    return this.exclusive(async () => {
      if (this.removed) throw new Error("Session log is deleted");
      const index = await this.load();
      // JSON.stringify never mutates, so the envelope can reference the caller's entry directly.
      const envelopes = entries.map((entry) => ({ kind, epoch: index.epoch, ...entry }));
      const lines = envelopes.map((envelope) => Buffer.from(`${JSON.stringify(envelope)}\n`));
      let start: number;
      try {
        start = await withSessionLogWriteIo(() => this.appendLines(lines));
      } catch (error) {
        // Whether the lines reached the disk is unknown. Forget the cached index so the next
        // reader folds in exactly what the log holds, as a restart would.
        this.index = null;
        throw error;
      }
      // Anchors change only for user messages; most appends never rebuild the sorted list.
      const anchors = new LazyAnchors(index.anchors);
      let offset = start;
      for (const [position, envelope] of envelopes.entries()) {
        // An in-place rewrite of an existing seq is a revision, not a new row.
        if (index.pointers[`${kind}:${envelope.seq}`]) index.revision += 1;
        const length = lines[position]!.length;
        absorbEnvelope(index, anchors, envelope, offset, length);
        offset += length;
      }
      if (anchors.changed) index.anchors = anchors.sorted();
      markScanned(index, offset);
      await this.checkpoint(index, entries.length, offset - start);
    });
  }

  /** Returns the offset the first line landed at. */
  private async appendLines(lines: readonly Buffer[]): Promise<number> {
    const handle = await fs.open(this.eventPath, "a", 0o600);
    try {
      const start = (await handle.stat()).size;
      const expected = lines.reduce((total, line) => total + line.length, 0);
      const { bytesWritten } = await handle.writev(lines);
      if (bytesWritten !== expected) throw new Error("Session log append was short");
      await handle.sync();
      return start;
    } finally {
      await handle.close();
    }
  }

  async read<T>(kind: SessionEventKind, start: number, end: number): Promise<JournalEntry<T>[]> {
    return this.lease(() => this.readPage<T>(kind, start, end));
  }

  private async readPage<T>(
    kind: SessionEventKind,
    start: number,
    end: number,
  ): Promise<JournalEntry<T>[]> {
    const index = await this.load();
    const wanted: { seq: number; pointer: EventPointer }[] = [];
    for (let seq = start; seq <= end; seq += 1) {
      const pointer = index.pointers[`${kind}:${seq}`];
      if (pointer) wanted.push({ seq, pointer });
    }
    if (!wanted.length) return [];
    const bytes = wanted.reduce((total, item) => total + item.pointer.length, 0);
    if (bytes > SESSION_STORAGE_LIMITS.readPageBytes)
      throw new Error("Session page exceeds byte budget; request a smaller page");
    const handle = await fs.open(this.eventPath, "r").catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    if (!handle) return [];
    try {
      return await readPointers<T>(handle, wanted, bytes);
    } finally {
      await handle.close();
    }
  }

  /** Rewrites one kind and preserves every other kind's lines byte for byte. */
  async replace<T>(
    kind: SessionEventKind,
    entries: readonly JournalEntry<T>[],
    epoch: string = randomUUID(),
  ): Promise<string> {
    return this.exclusive(async () => {
      const previous = await this.load();
      const kept: string[] = [];
      try {
        const existing = await fs.readFile(this.eventPath, "utf8");
        for (const line of existing.split("\n")) {
          if (!line) continue;
          try {
            const value = JSON.parse(line) as { kind?: string };
            // Preserved lines adopt the new epoch so a lost index rebuilds to the same one.
            if (value.kind && value.kind !== kind)
              kept.push(`${JSON.stringify({ ...value, epoch })}\n`);
          } catch {
            // A corrupt line has no kind and cannot be attributed; the rewrite drops it.
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const written = entries.map(
        (entry) => `${JSON.stringify({ kind, epoch, ...structuredClone(entry) })}\n`,
      );
      await withSessionLogWriteIo(() =>
        writeDurableFile(this.eventPath, [...kept, ...written].join("")),
      );
      const index = emptyIndex(epoch);
      index.operationOrder = previous.operationOrder;
      index.revision = previous.revision + 1;
      const anchors = new Map<string, SessionMessageAnchor>();
      let offset = 0;
      for (const line of [...kept, ...written]) {
        absorbLine(index, anchors, line.slice(0, -1), offset);
        offset += Buffer.byteLength(line);
      }
      // The rewritten kind owns the new epoch; absorbing preserved lines must not restore the old one.
      index.epoch = epoch;
      const rewritten = [...anchors.values()].sort((left, right) => left.seq - right.seq);
      for (const anchor of rewritten) anchor.epoch = epoch;
      index.anchors = rewritten;
      markScanned(index, offset);
      await this.save(index);
      return epoch;
    });
  }

  async anchors(): Promise<readonly SessionMessageAnchor[]> {
    return (await this.lease(() => this.load())).anchors;
  }

  /** Every canonical seq that carries this tool call, so a page can complete its lifecycle merge. */
  async toolOccurrences(callId: string): Promise<{ seqs: readonly number[]; complete: boolean }> {
    const seqs = (await this.lease(() => this.load())).tools[callId] ?? [];
    return { seqs, complete: seqs.length < TOOL_OCCURRENCE_LIMIT };
  }

  async lookupId(namespace: string, id: string): Promise<number | undefined> {
    return (await this.lease(() => this.load())).ids[`${namespace}:${id}`];
  }

  /** Records a lookup the log cannot derive on its own, such as a scan repair. */
  async putId(namespace: string, id: string, seq: number): Promise<void> {
    return this.exclusive(async () => {
      const index = await this.load();
      const key = `${namespace}:${id}`;
      const merged = mergeId(namespace, index.ids[key], seq);
      if (index.ids[key] === merged) return;
      index.ids[key] = merged;
      await this.checkpoint(index, 1, 0);
    });
  }

  async readSummary(): Promise<unknown> {
    return (await this.lease(() => this.load())).summary;
  }

  async writeSummary(value: unknown): Promise<void> {
    return this.exclusive(async () => {
      const index = await this.load();
      index.summary = value;
      await this.checkpoint(index, 1, 0);
    });
  }

  async clearSummary(): Promise<void> {
    return this.exclusive(async () => {
      const index = await this.load();
      if (index.summary === undefined) return;
      delete index.summary;
      await this.save(index);
    });
  }

  async claimOperationOrder(): Promise<number> {
    return this.exclusive(async () => {
      const index = await this.load();
      index.operationOrder += 1;
      await this.checkpoint(index, 1, 0);
      return index.operationOrder;
    });
  }

  async remove(): Promise<void> {
    return this.exclusive(async () => {
      this.removed = true;
      this.index = null;
      await fs.rm(this.eventPath, { force: true });
      await fs.rm(this.indexPath, { force: true });
      SessionEventLog.forget(this.directory);
    });
  }
}

/**
 * Record streams keep the newest row for an id, because a later record is a status update.
 * Timeline identity is different: two rows claiming one message id answer nothing.
 */
/** One contiguous read covers a page; scattered pointers fall back to per-row reads. */
async function readPointers<T>(
  handle: fs.FileHandle,
  wanted: readonly { seq: number; pointer: EventPointer }[],
  bytes: number,
): Promise<JournalEntry<T>[]> {
  const first = Math.min(...wanted.map((item) => item.pointer.offset));
  const last = Math.max(...wanted.map((item) => item.pointer.offset + item.pointer.length));
  const span = last - first;
  let slice: ((pointer: EventPointer) => Promise<string>) | null = null;
  if (span <= Math.max(bytes * 2, 64 * 1024) && span <= SESSION_STORAGE_LIMITS.readPageBytes) {
    const buffer = Buffer.alloc(span);
    await handle.read(buffer, 0, span, first);
    slice = async (pointer) =>
      buffer.toString("utf8", pointer.offset - first, pointer.offset - first + pointer.length);
  }
  const result: JournalEntry<T>[] = [];
  for (const { pointer } of wanted) {
    let text: string;
    if (slice) text = await slice(pointer);
    else {
      const buffer = Buffer.alloc(pointer.length);
      await handle.read(buffer, 0, pointer.length, pointer.offset);
      text = buffer.toString("utf8");
    }
    const envelope = JSON.parse(text) as SessionEventEnvelope<T>;
    result.push({
      seq: envelope.seq,
      value: envelope.value,
      ...(envelope.operation ? { operation: envelope.operation } : {}),
    });
  }
  return result;
}

/** Copies the anchor list into a map only once an append actually derives an anchor. */
class LazyAnchors {
  private map: Map<string, SessionMessageAnchor> | null = null;
  constructor(private readonly known: readonly SessionMessageAnchor[]) {}
  get changed(): boolean {
    return this.map !== null;
  }
  set(messageId: string, anchor: SessionMessageAnchor): void {
    this.map ??= new Map(this.known.map((existing) => [existing.messageId, existing]));
    this.map.set(messageId, anchor);
  }
  sorted(): SessionMessageAnchor[] {
    return [...(this.map?.values() ?? [])].sort((left, right) => left.seq - right.seq);
  }
}

/** A kind-scoped view. Shares the log's lock, index and file with every other kind. */
export class SessionEventStream<T> {
  constructor(
    private readonly log: SessionEventLog,
    private readonly kind: SessionEventKind,
  ) {}
  get directory(): string {
    return this.log.directory;
  }
  get owner(): SessionEventLog {
    return this.log;
  }
  state(): Promise<SessionEventState> {
    return this.log.state(this.kind);
  }
  append(entries: readonly JournalEntry<T>[]): Promise<void> {
    return this.log.append(this.kind, entries);
  }
  read(start: number, end: number): Promise<JournalEntry<T>[]> {
    return this.log.read<T>(this.kind, start, end);
  }
  replace(entries: readonly JournalEntry<T>[], epoch?: string): Promise<string> {
    return this.log.replace(this.kind, entries, epoch);
  }
  reset(epoch?: string): Promise<string> {
    return this.log.replace(this.kind, [], epoch);
  }
  flush(): Promise<void> {
    return this.log.flush();
  }
}

export type { JournalOperation };
