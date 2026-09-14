import { z } from "zod";
import {
  SessionActorSchema,
  SessionChannelReferenceSchema,
} from "@getpaseo/protocol/session-authorship";
import type { SessionOperationIdentity } from "../session-authorship.js";
import { randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { createDurableDirectory, syncDirectory, writeDurableJson } from "./durable-file.js";

export const SESSION_STORAGE_LIMITS = {
  queueBytes: 16 * 1024 * 1024,
  batchBytes: 1024 * 1024,
  concurrentIo: 4,
  segmentBytes: 8 * 1024 * 1024,
  indexPageRows: 256,
  readPageBytes: 8 * 1024 * 1024,
} as const;

/** Private journal envelope metadata; canonical timeline rows and wire items stay unchanged. */
export interface JournalOperation extends SessionOperationIdentity {
  order: number;
  timestamp: string;
}
export interface JournalEntry<T> {
  seq: number;
  value: T;
  operation?: JournalOperation;
}

interface Pointer {
  segment: number;
  offset: number;
  length: number;
}
interface Checkpoint {
  version: 1;
  epoch: string;
  maxSeq: number;
  operationOrder?: number;
  revision?: number;
  minSeq: number;
  segment: number;
  offset: number;
}
interface IndexPage {
  version: 1;
  epoch: string;
  entries: Record<string, Pointer>;
}
export const JOURNAL_READ_CACHE_BYTES = 4 * 64 * 1024 * 2;
/** Read-operation metadata only; no source payloads or open file handles are retained. */
function validPointer(pointer: Pointer | undefined): Pointer {
  if (
    !pointer ||
    !Number.isSafeInteger(pointer.segment) ||
    pointer.segment < 1 ||
    !Number.isSafeInteger(pointer.offset) ||
    pointer.offset < 0 ||
    !Number.isSafeInteger(pointer.length) ||
    pointer.length < 1 ||
    pointer.length > SESSION_STORAGE_LIMITS.readPageBytes
  )
    throw new Error("Invalid or missing journal index pointer");
  return pointer;
}

export class JournalReadCache {
  private readonly pages = new Map<string, IndexPage>();
  get(key: string): IndexPage | undefined {
    const page = this.pages.get(key);
    if (page) {
      this.pages.delete(key);
      this.pages.set(key, page);
    }
    return page;
  }
  set(key: string, page: IndexPage): void {
    this.pages.set(key, page);
    while (this.pages.size > 4) this.pages.delete(this.pages.keys().next().value!);
  }
  clear(): void {
    this.pages.clear();
  }
}
interface Entry<T> extends JournalEntry<T> {
  version: 1;
  epoch: string;
  seq: number;
  value: T;
}
interface Pending<T> {
  entries: JournalEntry<T>[];
  bytes: number;
  resolve: () => void;
  reject: (error: unknown) => void;
}

const journalOperationSchema = z.object({
  order: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  timestamp: z.string().datetime({ offset: true }),
  actor: SessionActorSchema.optional(),
  channel: SessionChannelReferenceSchema.optional(),
});
function validateOperation(operation: unknown): void {
  if (operation !== undefined) journalOperationSchema.parse(operation);
}
function validateCheckpoint(checkpoint: Checkpoint): void {
  if (
    checkpoint.revision !== undefined &&
    (!Number.isSafeInteger(checkpoint.revision) || checkpoint.revision < 0)
  )
    throw new Error("Invalid journal revision");
  if (
    checkpoint.operationOrder !== undefined &&
    (!Number.isSafeInteger(checkpoint.operationOrder) || checkpoint.operationOrder < 0)
  )
    throw new Error("Invalid journal operation order");
  if (
    checkpoint.version !== 1 ||
    typeof checkpoint.epoch !== "string" ||
    !checkpoint.epoch ||
    !Number.isSafeInteger(checkpoint.maxSeq) ||
    checkpoint.maxSeq < 0 ||
    !Number.isSafeInteger(checkpoint.minSeq) ||
    checkpoint.minSeq < 0 ||
    checkpoint.minSeq > checkpoint.maxSeq ||
    !Number.isSafeInteger(checkpoint.segment) ||
    checkpoint.segment < 1 ||
    !Number.isSafeInteger(checkpoint.offset) ||
    checkpoint.offset < 0
  )
    throw new Error("Invalid journal checkpoint");
}

let queuedBytes = 0;
let activeIo = 0;
const ioWaiters: (() => void)[] = [];
export async function withSessionStorageIo<T>(operation: () => Promise<T>): Promise<T> {
  if (activeIo >= SESSION_STORAGE_LIMITS.concurrentIo)
    await new Promise<void>((resolve) => ioWaiters.push(resolve));
  else activeIo += 1;
  try {
    return await operation();
  } finally {
    const next = ioWaiters.shift();
    if (next) next();
    else activeIo -= 1;
  }
}

/** One owner per directory. Payloads never remain cached after the operation settles. */
export class PagedJournal<T> {
  private checkpoint: Checkpoint | null = null;
  private readonly pending: Pending<T>[] = [];
  private draining: Promise<void> | null = null;
  private fatalError: unknown = null;
  private initializing: Promise<Checkpoint> | null = null;
  private deleted = false;
  private closing = false;
  private operationTail: Promise<unknown> = Promise.resolve();

  private exclusive<R>(operation: () => Promise<R>): Promise<R> {
    const task = this.operationTail.catch(() => undefined).then(operation);
    this.operationTail = task;
    return task;
  }
  constructor(
    readonly directory: string,
    private readonly segmentBytes: number = SESSION_STORAGE_LIMITS.segmentBytes,
  ) {}

  private segmentPath(segment: number): string {
    return path.join(this.directory, `events-${String(segment).padStart(6, "0")}.jsonl`);
  }
  private pagePath(seq: number): string {
    return path.join(
      this.directory,
      "index",
      `${Math.floor((seq - 1) / SESSION_STORAGE_LIMITS.indexPageRows)}.json`,
    );
  }
  private get checkpointPath(): string {
    return path.join(this.directory, "events-000001.index.json");
  }

  async state(): Promise<Readonly<Checkpoint>> {
    if (this.deleted) throw new Error("Session journal is deleted");
    if (this.fatalError) throw this.fatalError;
    if (this.checkpoint) return this.checkpoint;
    if (!this.initializing) this.initializing = this.loadCheckpoint();
    try {
      this.checkpoint = await this.initializing;
      return this.checkpoint;
    } finally {
      this.initializing = null;
    }
  }

  private async loadCheckpoint(): Promise<Checkpoint> {
    await createDurableDirectory(this.directory);
    const segments = (await fs.readdir(this.directory))
      .filter((name) => /^events-\d{6,}\.jsonl$/.test(name))
      .sort();
    try {
      const checkpoint = JSON.parse(await fs.readFile(this.checkpointPath, "utf8")) as Checkpoint;
      validateCheckpoint(checkpoint);
      const last = segments.at(-1);
      if (!last && checkpoint.maxSeq > 0)
        throw Object.assign(new Error("Missing committed journal segments"), {
          code: "EJOURNALMISSING",
        });
      if (
        (!last && checkpoint.offset === 0 && checkpoint.maxSeq === 0 && checkpoint.minSeq === 0) ||
        (last === path.basename(this.segmentPath(checkpoint.segment)) &&
          (await fs.stat(this.segmentPath(checkpoint.segment))).size === checkpoint.offset)
      )
        return checkpoint;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code &&
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      )
        throw error;
    }
    return this.rebuild(segments);
  }

  private async *scanRecords(
    segments: string[],
  ): AsyncGenerator<{ entry: Entry<T>; pointer: Pointer }> {
    for (let index = 0; index < segments.length; index += 1) {
      const segment = Number(segments[index].slice(7, -6));
      if (segment !== index + 1) throw new Error("Missing journal segment");
      const file = path.join(this.directory, segments[index]);
      let offset = 0;
      let remainder = Buffer.alloc(0);
      for await (const chunk of createReadStream(file, { highWaterMark: 64 * 1024 })) {
        remainder = Buffer.concat([remainder, chunk as Buffer]);
        let end: number;
        while ((end = remainder.indexOf(10)) >= 0) {
          if (end > SESSION_STORAGE_LIMITS.readPageBytes)
            throw new Error(`Journal entry exceeds byte limit: ${file}`);
          let entry: Entry<T>;
          try {
            entry = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(remainder.subarray(0, end)),
            ) as Entry<T>;
          } catch (error) {
            throw new Error(`Corrupt journal ${file} at byte ${offset}`, { cause: error });
          }
          if (
            entry.version !== 1 ||
            typeof entry.epoch !== "string" ||
            !entry.epoch ||
            !Number.isSafeInteger(entry.seq) ||
            entry.seq < 0
          ) {
            throw new Error(`Invalid journal entry ${file}:${offset}`);
          }
          validateOperation(entry.operation);
          yield { entry, pointer: { segment, offset, length: end + 1 } };
          offset += end + 1;
          remainder = remainder.subarray(end + 1);
        }
        if (remainder.length > SESSION_STORAGE_LIMITS.readPageBytes)
          throw new Error(`Journal entry exceeds byte limit: ${file}`);
      }
      if (remainder.length) {
        if (index !== segments.length - 1)
          throw new Error(`Incomplete interior journal segment: ${file}`);
        const handle = await fs.open(file, "r+");
        try {
          await handle.truncate(offset);
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
    }
  }

  private async rebuild(segments: string[]): Promise<Checkpoint> {
    let checkpoint: Checkpoint = {
      version: 1,
      epoch: randomUUID(),
      maxSeq: 0,
      minSeq: 0,
      segment: 1,
      offset: 0,
    };
    let initialEpoch: string | undefined;
    let committedEpoch: string | undefined;
    // Discover only committed replacements before indexing. A process can die halfway through
    // replacement rows; until its final seq=0 boundary, the previous epoch remains authoritative.
    for await (const { entry, pointer } of this.scanRecords(segments)) {
      initialEpoch ??= entry.epoch;
      if (entry.seq === 0) committedEpoch = entry.epoch;
      checkpoint.segment = pointer.segment;
      checkpoint.offset = pointer.offset + pointer.length;
    }
    checkpoint.epoch = committedEpoch ?? initialEpoch ?? checkpoint.epoch;
    await fs.rm(path.join(this.directory, "index"), { recursive: true, force: true });
    let pageNumber = -1;
    let page: IndexPage = { version: 1, epoch: checkpoint.epoch, entries: {} };
    const flushPage = async () => {
      if (pageNumber >= 0)
        await writeDurableJson(
          this.pagePath(pageNumber * SESSION_STORAGE_LIMITS.indexPageRows + 1),
          page,
        );
    };
    for await (const { entry, pointer } of this.scanRecords(segments)) {
      if (entry.epoch !== checkpoint.epoch || entry.seq === 0) continue;
      const nextPage = Math.floor((entry.seq - 1) / SESSION_STORAGE_LIMITS.indexPageRows);
      if (nextPage !== pageNumber) {
        await flushPage();
        page = await this.readIndexPage(entry.seq, checkpoint.epoch);
        pageNumber = nextPage;
      }
      page.entries[entry.seq] = pointer;
      if (entry.seq <= checkpoint.maxSeq) checkpoint.revision = (checkpoint.revision ?? 0) + 1;
      checkpoint.maxSeq = Math.max(checkpoint.maxSeq, entry.seq);
      checkpoint.operationOrder = Math.max(
        checkpoint.operationOrder ?? 0,
        entry.operation?.order ?? 0,
      );
      checkpoint.minSeq = checkpoint.minSeq ? Math.min(checkpoint.minSeq, entry.seq) : entry.seq;
    }
    await flushPage();
    await writeDurableJson(this.checkpointPath, checkpoint);
    return checkpoint;
  }

  private async readIndexPage(seq: number, epoch: string): Promise<IndexPage> {
    try {
      const file = this.pagePath(seq);
      if ((await fs.stat(file)).size > 64 * 1024)
        throw new Error("Invalid oversized journal index page");
      const value = JSON.parse(await fs.readFile(file, "utf8")) as IndexPage;
      if (
        value.version !== 1 ||
        value.epoch !== epoch ||
        !value.entries ||
        typeof value.entries !== "object" ||
        Array.isArray(value.entries) ||
        Object.keys(value.entries).length > SESSION_STORAGE_LIMITS.indexPageRows
      )
        throw new Error("Invalid journal index page");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { version: 1, epoch, entries: {} };
      throw error;
    }
  }

  append(entries: JournalEntry<T>[]): Promise<void> {
    if (this.deleted || this.closing)
      return Promise.reject(new Error("Session journal is deleted"));
    if (this.fatalError) return Promise.reject(this.fatalError);
    // Freeze the accepted operation before yielding: callers may reuse/mutate live rows.
    entries = structuredClone(entries);
    for (const entry of entries) validateOperation(entry.operation);
    const bytes = Buffer.byteLength(JSON.stringify(entries));
    if (
      bytes > SESSION_STORAGE_LIMITS.batchBytes ||
      queuedBytes + bytes > SESSION_STORAGE_LIMITS.queueBytes
    )
      return Promise.reject(new Error("Session storage overloaded: pending byte limit exceeded"));
    queuedBytes += bytes;
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ entries, bytes, resolve, reject });
      if (!this.draining) {
        this.draining = Promise.resolve()
          .then(() => this.drain())
          .finally(() => {
            this.draining = null;
            if (this.pending.length) this.startDrain();
          });
      }
    });
  }

  private startDrain(): void {
    if (this.draining || !this.pending.length) return;
    this.draining = Promise.resolve()
      .then(() => this.drain())
      .finally(() => {
        this.draining = null;
        if (this.pending.length) this.startDrain();
      });
  }

  private async drain(): Promise<void> {
    while (this.pending.length) {
      const batch: Pending<T>[] = [];
      let bytes = 0;
      while (
        this.pending.length &&
        bytes + this.pending[0].bytes <= SESSION_STORAGE_LIMITS.batchBytes
      ) {
        const next = this.pending.shift()!;
        batch.push(next);
        bytes += next.bytes;
      }
      try {
        await this.exclusive(() =>
          withSessionStorageIo(async () => {
            const checkpoint = await this.state();
            await this.commit(
              batch.flatMap((pending) => pending.entries),
              checkpoint,
            );
          }),
        );
        for (const pending of batch) pending.resolve();
      } catch (error) {
        this.fatalError = error; // Do not continue through an uncertain partial append; restart performs recovery.
        for (const pending of batch) pending.reject(error);
      } finally {
        queuedBytes -= bytes;
      }
    }
  }

  private async commit(entries: JournalEntry<T>[], previous: Readonly<Checkpoint>): Promise<void> {
    const checkpoint = { ...previous };
    const pages = new Map<number, IndexPage>();
    let segmentData: Buffer[] = [];
    let segmentStart = checkpoint.offset;
    const flushSegment = async () => {
      if (!segmentData.length) return;
      const handle = await fs.open(this.segmentPath(checkpoint.segment), "a", 0o600);
      try {
        await handle.writeFile(Buffer.concat(segmentData));
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (segmentStart === 0) await syncDirectory(this.directory);
      segmentData = [];
    };
    for (const entry of entries) {
      if (!Number.isSafeInteger(entry.seq) || entry.seq < 1)
        throw new Error("Journal sequence must be a positive integer");
      const data = Buffer.from(
        JSON.stringify({ version: 1, epoch: checkpoint.epoch, ...entry }) + "\n",
      );
      if (checkpoint.offset && checkpoint.offset + data.length > this.segmentBytes) {
        await flushSegment();
        checkpoint.segment += 1;
        checkpoint.offset = 0;
        segmentStart = 0;
      }
      segmentData.push(data);
      const pageNumber = Math.floor((entry.seq - 1) / SESSION_STORAGE_LIMITS.indexPageRows);
      let page = pages.get(pageNumber);
      if (!page) {
        page = await this.readIndexPage(entry.seq, checkpoint.epoch);
        pages.set(pageNumber, page);
      }
      page.entries[entry.seq] = {
        segment: checkpoint.segment,
        offset: checkpoint.offset,
        length: data.length,
      };
      checkpoint.offset += data.length;
      if (entry.seq <= checkpoint.maxSeq) checkpoint.revision = (checkpoint.revision ?? 0) + 1;
      checkpoint.maxSeq = Math.max(checkpoint.maxSeq, entry.seq);
      checkpoint.operationOrder = Math.max(
        checkpoint.operationOrder ?? 0,
        entry.operation?.order ?? 0,
      );
      checkpoint.minSeq = checkpoint.minSeq ? Math.min(checkpoint.minSeq, entry.seq) : entry.seq;
    }
    await flushSegment();
    for (const [pageNumber, page] of pages)
      await writeDurableJson(
        this.pagePath(pageNumber * SESSION_STORAGE_LIMITS.indexPageRows + 1),
        page,
      );
    await writeDurableJson(this.checkpointPath, checkpoint);
    this.checkpoint = checkpoint;
  }

  async read(
    startSeq: number,
    endSeq: number,
    cache?: JournalReadCache,
  ): Promise<JournalEntry<T>[]> {
    await this.flush();
    return this.exclusive(() =>
      withSessionStorageIo(async () => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            return await this.readIndexed(startSeq, endSeq, cache);
          } catch (error) {
            if (
              attempt ||
              this.deleted ||
              (error instanceof Error && error.message.includes("byte budget"))
            )
              throw error;
            cache?.clear();
            // Indexes are disposable; a rebuild validates the journal and surfaces interior corruption.
            const segments = (await fs.readdir(this.directory))
              .filter((name) => /^events-\d{6,}\.jsonl$/.test(name))
              .sort();
            this.checkpoint = await this.rebuild(segments);
          }
        }
        throw new Error("Unable to recover session index");
      }),
    );
  }

  /** Reads exactly one indexed record, tolerating short reads from the segment file. */
  private async readPointer(pointer: Pointer): Promise<Buffer> {
    const buffer = Buffer.alloc(pointer.length);
    const handle = await fs.open(this.segmentPath(pointer.segment), "r");
    try {
      let offset = 0;
      while (offset < buffer.length) {
        const read = await handle.read(
          buffer,
          offset,
          buffer.length - offset,
          pointer.offset + offset,
        );
        if (!read.bytesRead) throw new Error("Truncated indexed journal entry");
        offset += read.bytesRead;
      }
    } finally {
      await handle.close();
    }
    return buffer;
  }

  private async readIndexed(
    startSeq: number,
    endSeq: number,
    cache?: JournalReadCache,
  ): Promise<JournalEntry<T>[]> {
    const checkpoint = await this.state();
    const result: JournalEntry<T>[] = [];
    let totalBytes = 0;
    let pageNumber = -1;
    let page: IndexPage | null = null;
    for (
      let seq = Math.max(checkpoint.minSeq, startSeq, 1);
      seq <= Math.min(checkpoint.maxSeq, endSeq);
      seq += 1
    ) {
      const nextPage = Math.floor((seq - 1) / SESSION_STORAGE_LIMITS.indexPageRows);
      if (nextPage !== pageNumber) {
        const key = `${this.pagePath(seq)}:${checkpoint.epoch}:${checkpoint.segment}:${checkpoint.offset}:${checkpoint.revision ?? 0}`;
        page = cache?.get(key) ?? (await this.readIndexPage(seq, checkpoint.epoch));
        cache?.set(key, page);
        pageNumber = nextPage;
      }
      const pointer = validPointer(page?.entries[seq]);
      totalBytes += pointer.length;
      if (totalBytes > SESSION_STORAGE_LIMITS.readPageBytes)
        throw new Error("Session page exceeds byte budget; request a smaller page");
      const buffer = await this.readPointer(pointer);
      const entry = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(buffer),
      ) as Entry<T>;
      if (
        buffer.at(-1) !== 10 ||
        entry.version !== 1 ||
        entry.seq !== seq ||
        entry.epoch !== checkpoint.epoch
      ) {
        throw new Error("Journal index does not match its record");
      }
      validateOperation(entry.operation);
      result.push({
        seq,
        value: entry.value,
        ...(entry.operation ? { operation: entry.operation } : {}),
      });
    }
    return result;
  }

  async flush(): Promise<void> {
    while (this.draining) await this.draining;
    if (this.fatalError) throw this.fatalError;
  }
  /** Commit a replacement epoch only after every replacement row has reached disk. */
  async replace(entries: JournalEntry<T>[], epoch: string = randomUUID()): Promise<string> {
    if (!epoch || this.closing || this.deleted)
      throw new Error("Invalid or deleted replacement journal");
    const admissionBytes = Buffer.byteLength(JSON.stringify(entries));
    if (queuedBytes + admissionBytes > SESSION_STORAGE_LIMITS.queueBytes)
      throw new Error("Session storage overloaded: replacement byte limit exceeded");
    const snapshot = structuredClone(entries);
    queuedBytes += admissionBytes;
    try {
      await this.flush();
    } catch (error) {
      queuedBytes -= admissionBytes;
      throw error;
    }
    return this.exclusive(() =>
      withSessionStorageIo(async () => {
        const previous = await this.state();
        if (epoch === previous.epoch) throw new Error("Replacement timeline must use a new epoch");
        let segment = previous.segment;
        let offset = previous.offset;
        let data: Buffer[] = [];
        let bytes = 0;
        const flush = async () => {
          if (!bytes) return;
          const handle = await fs.open(this.segmentPath(segment), "a", 0o600);
          try {
            await handle.writeFile(Buffer.concat(data));
            await handle.sync();
          } finally {
            await handle.close();
          }
          await syncDirectory(this.directory);
          data = [];
          bytes = 0;
        };
        for (let index = 0; index <= snapshot.length; index += 1) {
          const entry = index < snapshot.length ? snapshot[index] : { seq: 0, value: null };
          if (
            index < snapshot.length &&
            (!Number.isSafeInteger(entry.seq) || entry.seq !== index + 1)
          )
            throw new Error("Replacement rows must start at sequence one and remain contiguous");
          const encoded = Buffer.from(JSON.stringify({ version: 1, epoch, ...entry }) + "\n");
          if (encoded.length > SESSION_STORAGE_LIMITS.batchBytes)
            throw new Error("Replacement row exceeds byte budget");
          if (offset && offset + encoded.length > this.segmentBytes) {
            await flush();
            segment += 1;
            offset = 0;
          }
          if (bytes + encoded.length > SESSION_STORAGE_LIMITS.batchBytes) await flush();
          data.push(encoded);
          bytes += encoded.length;
          offset += encoded.length;
        }
        await flush();
        this.checkpoint = await this.rebuild(
          (await fs.readdir(this.directory))
            .filter((name) => /^events-\d{6,}\.jsonl$/.test(name))
            .sort(),
        );
        return epoch;
      }),
    )
      .catch((error) => {
        this.fatalError = error;
        throw error;
      })
      .finally(() => {
        queuedBytes -= admissionBytes;
      });
  }

  /** Append an epoch boundary; old events remain on disk and recovery selects the latest epoch. */
  async reset(epoch: string = randomUUID()): Promise<string> {
    if (!epoch) throw new Error("Timeline epoch must not be empty");
    if (this.closing || this.deleted) throw new Error("Session journal is deleted");
    await this.flush();
    return this.exclusive(() =>
      withSessionStorageIo(async () => {
        const previous = await this.state();
        if (epoch === previous.epoch) throw new Error("Replacement timeline must use a new epoch");
        const data = Buffer.from(JSON.stringify({ version: 1, epoch, seq: 0, value: null }) + "\n");
        const handle = await fs.open(this.segmentPath(previous.segment), "a", 0o600);
        try {
          await handle.writeFile(data);
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (previous.offset === 0) await syncDirectory(this.directory);
        const next: Checkpoint = {
          ...previous,
          epoch,
          minSeq: 0,
          maxSeq: 0,
          offset: previous.offset + data.length,
        };
        await fs.rm(path.join(this.directory, "index"), { recursive: true, force: true });
        await writeDurableJson(this.checkpointPath, next);
        this.checkpoint = next;
        return epoch;
      }),
    ).catch((error) => {
      this.fatalError = error;
      throw error;
    });
  }

  async remove(): Promise<void> {
    this.closing = true;
    await this.flush();
    await this.exclusive(async () => {
      this.deleted = true;
      let names: string[];
      try {
        names = await fs.readdir(this.directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      for (const name of names) {
        if (/^events-\d{6,}\.(jsonl|index\.json)$/.test(name) || name === "index")
          await fs.rm(path.join(this.directory, name), {
            recursive: true,
            force: true,
          });
      }
      await syncDirectory(this.directory);
    });
  }
}
