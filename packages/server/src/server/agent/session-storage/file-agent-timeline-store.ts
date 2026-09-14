import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentPermissionResponseRecord } from "@getpaseo/protocol/session-authorship";
import type { AgentTimelineItem } from "../agent-sdk-types.js";
import type { SessionOperationIdentity } from "../session-authorship.js";
import type { TimelinePromptIndex } from "../timeline-prompt-index.js";
import type {
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineStore,
  TimelineDocumentReadOptions,
} from "../agent-timeline-store-types.js";
import {
  AuthorshipRecoveryQueue,
  type AuthorshipRecoveryStatus,
} from "./authorship-recovery-queue.js";
import { findPermissionEntry } from "./permission-index.js";
import {
  readMessageSubmission,
  writeMessageSubmission,
  type MessageSubmission,
} from "./message-submissions.js";
import { recoverSessionSummary, type DurableSessionSummary } from "./session-summary.js";
import {
  SESSION_STORAGE_LIMITS,
  PagedJournal,
  type JournalEntry,
  type JournalOperation,
} from "./paged-journal.js";
import { ProjectedTimeline, type ProjectedTimelineFetchResult } from "./projected-timeline.js";
import {
  AMBIGUOUS_ID,
  SessionEventLog,
  type SessionEventState,
  type SessionEventStream,
} from "./session-event-log.js";

type DirectoryResolver = (agentId: string) => Promise<string>;
type TimelineStream = SessionEventStream<AgentTimelineRow>;
type PermissionStream = SessionEventStream<AgentPermissionResponseRecord>;
type SubmissionStream = SessionEventStream<MessageSubmission>;

let pendingStoreBytes = 0;
let pendingStoreOperations = 0;

function selectRowRange(
  state: SessionEventState,
  direction: AgentTimelineFetchResult["direction"],
  reset: boolean,
  options?: AgentTimelineFetchOptions,
): { start: number; end: number } {
  const limit =
    options?.limit === 0 ? state.maxSeq : Math.max(1, Math.floor(options?.limit ?? 200));
  let start = state.minSeq;
  let end = state.maxSeq;
  if (!reset && direction === "after") {
    start = Math.max(start, (options?.cursor?.seq ?? 0) + 1);
    end = Math.min(end, start + limit - 1);
  } else {
    if (!reset && direction === "before")
      end = Math.min(end, (options?.cursor?.seq ?? state.maxSeq + 1) - 1);
    start = Math.max(start, end - limit + 1);
  }
  return { start, end };
}

/**
 * Durable session storage: one `events.jsonl` per session holds the timeline, the
 * submission ledger and the permission history; one `events.index.json` holds every
 * derived pointer, anchor and id lookup. Nothing else is persisted.
 */
export class FileAgentTimelineStore implements AgentTimelineStore {
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly deleting = new Set<string>();
  private authorshipObserver?: (agentId: string, value: DurableSessionSummary) => Promise<void>;
  private readonly recovery = new AuthorshipRecoveryQueue({
    recover: (agentId) => this.recoverAuthorship(agentId),
    isDeleting: (agentId) => this.deleting.has(agentId),
  });

  constructor(private readonly resolveDirectory: DirectoryResolver) {}

  setAuthorshipObserver(
    observer: (agentId: string, value: DurableSessionSummary) => Promise<void>,
  ): void {
    this.authorshipObserver = observer;
  }
  setAuthorshipRecoveryObserver(
    observer: (agentId: string, status: AuthorshipRecoveryStatus) => Promise<void>,
  ): void {
    this.recovery.setStatusObserver(observer);
  }
  setAuthorshipRecoveryRefill(refill: () => Promise<readonly string[]>): void {
    this.recovery.setRefill(refill);
  }
  requestAuthorshipRecoverySweep(): void {
    this.recovery.requestSweep();
  }
  scheduleAuthorshipRecovery(agentId: string, prioritize = false): boolean {
    return this.recovery.schedule(agentId, prioritize);
  }

  private run<T>(agentId: string, operation: () => Promise<T>, bytes = 0): Promise<T> {
    if (this.deleting.has(agentId)) return Promise.reject(new Error("Session is being deleted"));
    if (
      pendingStoreBytes + bytes > SESSION_STORAGE_LIMITS.queueBytes ||
      pendingStoreOperations >= 1024
    )
      return Promise.reject(
        new Error("Session storage overloaded: operation queue limit exceeded"),
      );
    pendingStoreBytes += bytes;
    pendingStoreOperations += 1;
    const previous = this.tails.get(agentId) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(operation);
    this.tails.set(agentId, task);
    void task
      .finally(() => {
        pendingStoreBytes -= bytes;
        pendingStoreOperations -= 1;
        if (this.tails.get(agentId) === task) this.tails.delete(agentId);
      })
      .catch(() => undefined);
    return task;
  }

  /** Opens the session's one log, importing a pre-canonical segmented session on first touch. */
  private async open(agentId: string): Promise<SessionEventLog> {
    const directory = await this.resolveDirectory(agentId);
    const log = SessionEventLog.for(directory);
    await importSegmentedSession(log, directory);
    return log;
  }
  private async timeline(agentId: string): Promise<TimelineStream> {
    return (await this.open(agentId)).stream<AgentTimelineRow>("timeline");
  }
  private async permissions(agentId: string): Promise<PermissionStream> {
    return (await this.open(agentId)).stream<AgentPermissionResponseRecord>("permission");
  }
  private async submissions(agentId: string): Promise<SubmissionStream> {
    return (await this.open(agentId)).stream<MessageSubmission>("submission");
  }

  async recoverAuthorship(agentId: string): Promise<DurableSessionSummary> {
    return this.run(agentId, () => this.syncAuthorship(agentId));
  }
  private async syncAuthorship(agentId: string): Promise<DurableSessionSummary> {
    const value = await recoverSessionSummary(
      await this.timeline(agentId),
      await this.permissions(agentId),
    );
    await this.authorshipObserver?.(agentId, value);
    return value;
  }

  async getEpoch(agentId: string): Promise<string> {
    return this.run(agentId, async () => (await (await this.timeline(agentId)).state()).epoch);
  }
  async getLatestCommittedSeq(agentId: string): Promise<number> {
    return this.run(agentId, async () => (await (await this.timeline(agentId)).state()).maxSeq);
  }

  async appendCommitted(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string; turnId?: string },
  ): Promise<AgentTimelineRow> {
    const bytes = Buffer.byteLength(JSON.stringify(item));
    const snapshot = structuredClone(item);
    return this.run(
      agentId,
      async () => {
        const timeline = await this.timeline(agentId);
        const row: AgentTimelineRow = {
          seq: (await timeline.state()).maxSeq + 1,
          timestamp: options?.timestamp ?? new Date().toISOString(),
          item: snapshot,
          ...(options?.turnId ? { turnId: options.turnId } : {}),
        };
        await this.writeRows(agentId, timeline, [row]);
        return row;
      },
      bytes,
    );
  }

  async bulkInsert(agentId: string, rows: readonly AgentTimelineRow[]): Promise<void> {
    const bytes = Buffer.byteLength(JSON.stringify(rows));
    const snapshot = structuredClone(rows);
    return this.run(
      agentId,
      async () => this.writeRows(agentId, await this.timeline(agentId), snapshot),
      bytes,
    );
  }
  async updateCommittedRow(agentId: string, row: AgentTimelineRow): Promise<void> {
    await this.bulkInsert(agentId, [row]);
  }

  private async writeRows(
    agentId: string,
    timeline: TimelineStream,
    rows: readonly AgentTimelineRow[],
  ): Promise<void> {
    await timeline.append(await this.annotateRows(agentId, timeline, rows));
    await this.syncAuthorship(agentId);
  }

  /** Attaches the durable submission operation that admitted each user message. */
  private async annotateRows(
    agentId: string,
    timeline: TimelineStream,
    rows: readonly AgentTimelineRow[],
  ): Promise<JournalEntry<AgentTimelineRow>[]> {
    const submissions = await this.submissions(agentId);
    const head = await timeline.state();
    const entries: JournalEntry<AgentTimelineRow>[] = [];
    for (const row of rows) {
      let operation: JournalOperation | undefined;
      if (row.item.type === "user_message" && row.item.clientMessageId) {
        operation =
          row.seq <= head.maxSeq
            ? await this.existingOperation(timeline, row)
            : (await readMessageSubmission(submissions, row.item.clientMessageId))?.operation;
      }
      entries.push({ seq: row.seq, value: row, ...(operation ? { operation } : {}) });
    }
    return entries;
  }

  /** An in-place rewrite keeps whatever operation the original row already carried. */
  private async existingOperation(
    timeline: TimelineStream,
    row: AgentTimelineRow,
  ): Promise<JournalOperation | undefined> {
    return (await timeline.read(row.seq, row.seq))[0]?.operation;
  }

  private async fetchPage(
    timeline: TimelineStream,
    options?: AgentTimelineFetchOptions,
  ): Promise<AgentTimelineFetchResult> {
    const state = await timeline.state();
    const direction = options?.direction ?? "tail";
    const staleCursor = options?.cursor !== undefined && options.cursor.epoch !== state.epoch;
    const gap =
      !staleCursor &&
      direction === "after" &&
      options?.cursor !== undefined &&
      state.minSeq > 0 &&
      options.cursor.seq < state.minSeq - 1;
    const reset = staleCursor || gap;
    const { start, end } = selectRowRange(state, direction, reset, options);
    const rows =
      state.maxSeq === 0 || end < start
        ? []
        : (await timeline.read(start, end)).map((entry) => entry.value);
    return {
      epoch: state.epoch,
      direction,
      reset,
      staleCursor,
      gap,
      window: { minSeq: state.minSeq, maxSeq: state.maxSeq, nextSeq: state.maxSeq + 1 },
      hasOlder: rows.length > 0 && start > state.minSeq,
      hasNewer: rows.length > 0 && end < state.maxSeq,
      rows,
    };
  }

  async fetchCommitted(
    agentId: string,
    options?: AgentTimelineFetchOptions,
  ): Promise<AgentTimelineFetchResult> {
    return this.run(agentId, async () => this.fetchPage(await this.timeline(agentId), options));
  }
  async fetchProjectedCommitted(
    agentId: string,
    options?: AgentTimelineFetchOptions,
  ): Promise<ProjectedTimelineFetchResult> {
    return this.run(agentId, async () =>
      new ProjectedTimeline(await this.timeline(agentId)).fetch(options),
    );
  }
  async readProjectedPayload(agentId: string, options: TimelineDocumentReadOptions) {
    return this.run(agentId, async () =>
      new ProjectedTimeline(await this.timeline(agentId)).payload(options),
    );
  }
  async readProjectedSourceRanges(agentId: string, options: TimelineDocumentReadOptions) {
    return this.run(agentId, async () =>
      new ProjectedTimeline(await this.timeline(agentId)).sourceRanges(options),
    );
  }

  async getCommittedRows(agentId: string): Promise<AgentTimelineRow[]> {
    return this.run(agentId, async () => {
      const timeline = await this.timeline(agentId);
      const state = await timeline.state();
      // Legacy full-history API has a byte ceiling; paged consumers must use fetchCommitted.
      return (await timeline.read(state.minSeq, state.maxSeq)).map((entry) => entry.value);
    });
  }

  async getLastItem(agentId: string): Promise<AgentTimelineItem | null> {
    return (await this.fetchCommitted(agentId, { limit: 1 })).rows[0]?.item ?? null;
  }

  async getLastAssistantMessage(agentId: string): Promise<string | null> {
    return this.run(agentId, async () => {
      const timeline = await this.timeline(agentId);
      let cursor: { epoch: string; seq: number } | undefined;
      const chunks: string[] = [];
      let bytes = 0;
      do {
        const page = await this.fetchPage(timeline, {
          direction: cursor ? "before" : "tail",
          cursor,
          limit: 40,
        });
        for (const row of page.rows.toReversed()) {
          if (row.item.type === "assistant_message") {
            bytes += Buffer.byteLength(row.item.text);
            if (bytes > SESSION_STORAGE_LIMITS.readPageBytes)
              throw new Error("Assistant message exceeds read byte budget");
            chunks.push(row.item.text);
          } else if (chunks.length) return chunks.toReversed().join("");
        }
        cursor = page.hasOlder ? { epoch: page.epoch, seq: page.rows[0]!.seq } : undefined;
      } while (cursor);
      return chunks.length ? chunks.toReversed().join("") : null;
    });
  }

  /** Anchors are already derived; listing prompts never reads `events.jsonl`. */
  async listPromptIndex(agentId: string): Promise<TimelinePromptIndex> {
    return this.run(agentId, async () => {
      const log = await this.open(agentId);
      const state = await log.state("timeline");
      const prompts = (await log.anchors())
        .filter((anchor) => anchor.epoch === state.epoch)
        .map(({ seq, timestamp, preview }) => ({ seq, timestamp, preview }));
      return { epoch: state.epoch, prompts };
    });
  }

  async getSubmittedUserMessage(
    agentId: string,
    clientMessageId: string,
  ): Promise<AgentTimelineRow | null> {
    return this.run(agentId, async () => {
      const log = await this.open(agentId);
      const timeline = log.stream<AgentTimelineRow>("timeline");
      const seq = await log.lookupId("client", clientMessageId);
      if (seq === undefined || seq === AMBIGUOUS_ID) return null;
      const row = (await timeline.read(seq, seq))[0]?.value;
      return row?.item.type === "user_message" && row.item.clientMessageId === clientMessageId
        ? row
        : null;
    });
  }

  async getUserMessageByProviderId(agentId: string, id: string): Promise<AgentTimelineRow | null> {
    return this.run(agentId, async () => {
      const log = await this.open(agentId);
      const timeline = log.stream<AgentTimelineRow>("timeline");
      const seq = await log.lookupId("provider", id);
      if (seq === undefined || seq === AMBIGUOUS_ID) return null;
      const row = (await timeline.read(seq, seq))[0]?.value;
      if (row?.item.type !== "user_message") return null;
      return row.providerMessageId === id || row.item.messageId === id ? row : null;
    });
  }

  async writeMessageSubmission(
    agentId: string,
    record: MessageSubmission,
  ): Promise<{ record: MessageSubmission; created: boolean }> {
    const bytes = Buffer.byteLength(JSON.stringify(record));
    const snapshot = structuredClone(record);
    return this.run(
      agentId,
      async () => {
        const log = await this.open(agentId);
        snapshot.operation ??= {
          ...snapshot.identity,
          timestamp: snapshot.timestamp,
          order: await log.claimOperationOrder(),
        };
        return writeMessageSubmission(log.stream<MessageSubmission>("submission"), snapshot);
      },
      bytes,
    );
  }

  async readPermissionResponse(
    agentId: string,
    id: string,
  ): Promise<AgentPermissionResponseRecord | null> {
    return this.run(
      agentId,
      async () => (await findPermissionEntry(await this.permissions(agentId), id))?.value ?? null,
    );
  }

  async appendPermissionResponse(
    agentId: string,
    record: AgentPermissionResponseRecord,
    identity?: SessionOperationIdentity,
  ): Promise<void> {
    const bytes = Buffer.byteLength(JSON.stringify(record));
    const snapshot = structuredClone(record);
    const channel = identity?.channel ? structuredClone(identity.channel) : undefined;
    return this.run(
      agentId,
      async () => {
        const log = await this.open(agentId);
        const permissions = log.stream<AgentPermissionResponseRecord>("permission");
        const previous = await findPermissionEntry(permissions, snapshot.id);
        // Status changes preserve the original pending operation's time and order.
        const operation =
          previous?.operation ??
          (snapshot.status === "pending"
            ? {
                actor: snapshot.respondedBy,
                channel,
                timestamp: snapshot.timestamp,
                order: await log.claimOperationOrder(),
              }
            : undefined);
        await permissions.append([
          {
            seq: (await permissions.state()).maxSeq + 1,
            value: snapshot,
            ...(operation ? { operation } : {}),
          },
        ]);
        await this.syncAuthorship(agentId);
      },
      bytes,
    );
  }

  async fetchPermissionResponses(
    agentId: string,
    options?: { cursor?: number; limit?: number },
  ): Promise<{ records: AgentPermissionResponseRecord[]; nextCursor?: number }> {
    return this.run(agentId, async () => {
      const permissions = await this.permissions(agentId);
      const state = await permissions.state();
      const end = Math.min(state.maxSeq, (options?.cursor ?? state.maxSeq + 1) - 1);
      const limit = Math.max(1, Math.min(200, options?.limit ?? 40));
      const records = new Map<string, AgentPermissionResponseRecord>();
      let bytes = 2;
      let cursor = end + 1;
      // Physical status positions define continuation. Resolve current records one at a time;
      // a late large error must be charged even if its scanned pending record was tiny.
      for (let seq = end; seq > 0 && end - seq < limit; seq--) {
        const entry = (await permissions.read(seq, seq))[0];
        if (!entry) throw new Error("Permission history index omitted a committed record");
        if (!records.has(entry.value.id)) {
          const latest = await findPermissionEntry(permissions, entry.value.id);
          if (!latest) throw new Error("Permission history latest record is missing");
          const size = Buffer.byteLength(JSON.stringify(latest.value)) + (records.size ? 1 : 0);
          if (bytes + size > SESSION_STORAGE_LIMITS.readPageBytes) break;
          records.set(latest.value.id, latest.value);
          bytes += size;
        }
        cursor = seq;
      }
      if (end > 0 && cursor === end + 1)
        throw new Error("Permission history record exceeds page byte limit");
      return { records: [...records.values()], ...(cursor > 1 ? { nextCursor: cursor } : {}) };
    });
  }

  async replaceCommitted(
    agentId: string,
    rows: readonly AgentTimelineRow[],
    options?: { epoch?: string },
  ): Promise<string> {
    const bytes = Buffer.byteLength(JSON.stringify(rows));
    const snapshot = structuredClone(rows);
    return this.run(
      agentId,
      async () => {
        const timeline = await this.timeline(agentId);
        const entries = await this.replacementEntries(timeline, snapshot);
        const epoch = await timeline.replace(entries, options?.epoch);
        await this.syncAuthorship(agentId);
        return epoch;
      },
      bytes,
    );
  }

  /** Replacement keeps each row's admitting operation, matched by the ids the row carries. */
  private async replacementEntries(
    timeline: TimelineStream,
    rows: readonly AgentTimelineRow[],
  ): Promise<JournalEntry<AgentTimelineRow>[]> {
    const log = timeline.owner;
    const entries: JournalEntry<AgentTimelineRow>[] = [];
    for (const row of rows) {
      let operation: JournalOperation | undefined;
      if (row.item.type === "user_message") {
        const candidates: [string, string][] = [];
        if (row.item.clientMessageId) candidates.push(["client", row.item.clientMessageId]);
        const providerId = row.providerMessageId ?? row.item.messageId;
        if (providerId) candidates.push(["provider", providerId]);
        for (const [namespace, id] of candidates) {
          if (operation) break;
          const seq = await log.lookupId(namespace, id);
          if (seq === undefined || seq === AMBIGUOUS_ID) continue;
          const previous = (await timeline.read(seq, seq))[0];
          if (previous?.value.item.type === "user_message") operation = previous.operation;
        }
      }
      entries.push({ seq: row.seq, value: row, ...(operation ? { operation } : {}) });
    }
    return entries;
  }

  async resetCommitted(agentId: string, options?: { epoch?: string }): Promise<string> {
    return this.run(agentId, async () => {
      const epoch = await (await this.timeline(agentId)).reset(options?.epoch);
      await this.syncAuthorship(agentId);
      return epoch;
    });
  }

  async deleteAgent(agentId: string): Promise<void> {
    const task = this.run(agentId, async () => (await this.open(agentId)).remove());
    this.deleting.add(agentId);
    await task;
  }

  async flush(): Promise<void> {
    await this.recovery.drain();
    while (this.tails.size) await Promise.all(this.tails.values());
    await SessionEventLog.flushAll();
  }
}

/**
 * Pre-canonical sessions kept one segmented journal per record family. Import them once,
 * preserving epoch and sequence, then never look at the old layout again.
 */
async function importSegmentedSession(log: SessionEventLog, directory: string): Promise<void> {
  if ((await log.state("timeline")).maxSeq > 0) return;
  const names = await fs.readdir(directory).catch(() => [] as string[]);
  if (!names.some((name) => /^events-\d{6,}\.jsonl$/.test(name))) return;
  const legacy = new PagedJournal<AgentTimelineRow>(directory);
  const state = await legacy.state();
  if (state.maxSeq === 0) return;
  await log.replace("timeline", await legacy.read(state.minSeq, state.maxSeq), state.epoch);
  for (const [folder, kind] of [
    ["permissions", "permission"],
    ["submissions", "submission"],
  ] as const) {
    const source = new PagedJournal<AgentPermissionResponseRecord & MessageSubmission>(
      path.join(directory, folder),
    );
    const head = await source.state();
    if (head.maxSeq === 0) continue;
    await log.append(kind, await source.read(head.minSeq, head.maxSeq));
  }
}
