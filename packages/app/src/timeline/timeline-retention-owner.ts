import type { StreamItem } from "@/types/stream";
import { getSendingClientMessageIds } from "@/composer/submission/model";
import { selectAgentTimelineState, useSessionStore } from "@/stores/session-store";
import type {
  AgentStreamReducerEvent,
  ProcessAgentStreamEventOutput,
  ProcessTimelineResponseInput,
  ProcessTimelineResponseOutput,
} from "./session-stream-reducers";
import {
  timelinePageRetention,
  timelineRetentionKey,
  type TimelineRetentionChange,
  type TimelinePageRetention,
} from "./timeline-page-retention";

type Page = ProcessTimelineResponseInput["payload"];
function itemBytes(item: StreamItem): number {
  return new TextEncoder().encode(JSON.stringify(item)).byteLength * 2 + 256;
}
function keepUnpositionedOrPending(
  serverId: string,
  agentId: string,
  keep: ReadonlySet<string>,
  items: StreamItem[],
): StreamItem[] {
  const session = useSessionStore.getState().sessions[serverId];
  const pending = new Set(getSendingClientMessageIds(session?.messageSubmissions.get(agentId)));
  return items.filter(
    (item) =>
      !item.timelineCursor ||
      keep.has(item.id) ||
      (item.kind === "user_message" &&
        item.clientMessageId !== undefined &&
        pending.has(item.clientMessageId)),
  );
}

/** Metadata admission for the existing store; this class never retains timeline payloads. */
export class TimelineRetentionOwner {
  private readonly registrations = new Map<string, () => void>();
  private disposed = false;
  private readonly visible = new Set<string>();
  private readonly reading = new Map<string, string>();
  private readonly reservations = new WeakMap<AgentStreamReducerEvent, () => void>();
  constructor(
    private readonly serverId: string,
    private readonly budget: TimelinePageRetention = timelinePageRetention,
  ) {}

  private ensure(agentId: string): string {
    const key = timelineRetentionKey(this.serverId, agentId);
    if (!this.budget.readRange(key)) {
      const dispose = this.budget.register(key, (change) => this.evict(agentId, change));
      this.registrations.set(agentId, dispose);
      this.budget.setReading(key, this.visible.has(agentId), this.reading.get(agentId) ?? null);
      this.captureCurrent(agentId, key);
    }
    return key;
  }
  private captureCurrent(agentId: string, key: string): void {
    const session = useSessionStore.getState().sessions[this.serverId];
    const timeline = selectAgentTimelineState(session, agentId);
    const range = session?.agentTimelineCursor.get(agentId);
    if (timeline.status === "cold" || !range) return;
    const items = [...timeline.items, ...(session?.agentStreamHead.get(agentId) ?? [])].filter(
      (item) => item.timelineCursor,
    );
    const payloadBytes = Object.fromEntries(items.map((item) => [item.id, itemBytes(item)]));
    for (const coverage of [range, ...(range.retainedRanges ?? [])]) {
      const accepted = this.budget.retain(key, {
        epoch: range.epoch,
        startSeq: coverage.startSeq,
        endSeq: coverage.endSeq,
        itemIds: items.map((item) => item.id),
        itemBytes: payloadBytes,
        bytes: 0,
        sourceSeqRanges: items.flatMap((item) => item.timelineCursor?.sourceSeqRanges ?? []),
        hasOlder: timeline.status === "synced" ? timeline.older === "available" : true,
      });
      if (!accepted) {
        this.evict(agentId, { keepItemIds: new Set(), range: null, hasOlder: true });
        break;
      }
    }
  }
  prepare(agentId: string): void {
    if (!this.disposed) this.ensure(agentId);
  }
  private evict(agentId: string, change: TimelineRetentionChange): void {
    const store = useSessionStore.getState();
    const session = store.sessions[this.serverId];
    const timeline = selectAgentTimelineState(session, agentId);
    if (timeline.status === "cold") return;
    store.applyAgentTimelineResponseState(this.serverId, agentId, {
      items: keepUnpositionedOrPending(this.serverId, agentId, change.keepItemIds, timeline.items),
      head: keepUnpositionedOrPending(
        this.serverId,
        agentId,
        change.keepItemIds,
        session?.agentStreamHead.get(agentId) ?? [],
      ),
      range: change.range,
      older: change.hasOlder || !change.range ? "available" : "none",
      newer: timeline.status === "synced" && timeline.newer === "available",
      synchronized: false,
      acknowledgedClientMessageIds: [],
    });
    if (!change.range) store.setAgentAuthoritativeHistoryApplied(this.serverId, agentId, false);
  }
  setVisible(agentIds: readonly string[]): void {
    const previous = new Set(this.visible);
    this.visible.clear();
    for (const id of agentIds) this.visible.add(id);
    for (const id of new Set([...previous, ...agentIds])) {
      if (!this.registrations.has(id)) continue;
      this.budget.setReading(
        timelineRetentionKey(this.serverId, id),
        this.visible.has(id),
        this.reading.get(id) ?? null,
      );
    }
  }
  setReading(agentId: string, itemId: string | null): void {
    if (itemId) this.reading.set(agentId, itemId);
    else this.reading.delete(agentId);
    const key = this.ensure(agentId);
    this.budget.setReading(key, this.visible.has(agentId), itemId);
  }
  subscribeBudget(listener: () => void): () => void {
    return this.budget.subscribe(listener);
  }
  canPrefetch(agentId: string): boolean {
    return this.budget.canPrefetch(timelineRetentionKey(this.serverId, agentId));
  }
  reserveEvent(agentId: string, event: AgentStreamReducerEvent): boolean {
    const release = this.budget.reserve(
      this.ensure(agentId),
      new TextEncoder().encode(JSON.stringify(event)).byteLength * 2 + 256,
    );
    if (!release) return false;
    this.reservations.set(event, release);
    return true;
  }
  admitStream(
    agentId: string,
    result: ProcessAgentStreamEventOutput,
    events: AgentStreamReducerEvent[],
  ): ProcessAgentStreamEventOutput {
    for (const event of events) {
      this.reservations.get(event)?.();
      this.reservations.delete(event);
    }
    const key = this.ensure(agentId);
    const localBytes = [...result.tail, ...result.head]
      .filter((item) => !item.timelineCursor)
      .reduce((sum, item) => sum + itemBytes(item), 0);
    if (!this.budget.setPinnedBytes(key, localBytes))
      throw new Error("Live history exceeds the available memory budget");
    const cursor = result.cursor;
    if (!cursor) return result;
    const entries = events.flatMap((event) => {
      if (
        event.event.type !== "timeline" ||
        event.epoch !== cursor.epoch ||
        event.seq === undefined ||
        event.seq < cursor.startSeq ||
        event.seq > cursor.endSeq
      )
        return [];
      const position = [...result.tail, ...result.head].find(
        (item) => item.timelineCursor?.seq === event.seq,
      )?.timelineCursor;
      return [
        {
          provider: event.event.provider,
          item: event.event.item,
          timestamp: event.timestamp.toISOString(),
          seqStart: position?.seqStart ?? event.seq,
          seqEnd: event.seq,
          sourceSeqRanges: position?.sourceSeqRanges ?? [
            { startSeq: event.seq, endSeq: event.seq },
          ],
        },
      ];
    });
    if (!entries.length) return result;
    const page: Page = {
      agentId,
      direction: "after",
      projection: "projected",
      reset: false,
      epoch: cursor.epoch,
      window: { minSeq: 1, maxSeq: cursor.endSeq, nextSeq: cursor.endSeq + 1 },
      startCursor: { seq: Math.min(...entries.map((entry) => entry.seqEnd)) },
      endCursor: { seq: Math.max(...entries.map((entry) => entry.seqEnd)) },
      entries,
      hasOlder: true,
      hasNewer: false,
      error: null,
    };
    const admitted = this.admit(page, {
      ...result,
      sideEffects: [],
      commit: "apply",
      older: "unchanged",
      initResolution: null,
      clearInitializing: false,
      error: null,
    });
    if (admitted.error) throw new Error(admitted.error);
    return {
      ...result,
      tail: admitted.tail,
      head: admitted.head,
      cursor: admitted.cursor ?? null,
      cursorChanged: true,
      changedTail: true,
      changedHead: true,
    };
  }
  admit(payload: Page, result: ProcessTimelineResponseOutput): ProcessTimelineResponseOutput {
    if (result.commit === "discard" || result.error || !payload.startCursor || !payload.endCursor)
      return result;
    const key = this.ensure(payload.agentId);
    const localBytes = [...result.tail, ...result.head]
      .filter((item) => !item.timelineCursor)
      .reduce((sum, item) => sum + itemBytes(item), 0);
    if (!this.budget.setPinnedBytes(key, localBytes))
      return {
        ...result,
        commit: "discard",
        cursorChanged: false,
        initResolution: "reject",
        error: "Pending history exceeds the available memory budget",
      };
    const positions = new Set(
      [...payload.entries, ...(payload.contextEntries ?? [])].map((entry) => entry.seqEnd),
    );
    const items = [...result.tail, ...result.head].filter(
      (item) =>
        item.timelineCursor?.epoch === payload.epoch && positions.has(item.timelineCursor.seq),
    );
    const accepted = this.budget.retain(key, {
      epoch: payload.epoch,
      startSeq: payload.startCursor.seq,
      endSeq: payload.endCursor.seq,
      itemIds: items.map((item) => item.id),
      itemBytes: Object.fromEntries(items.map((item) => [item.id, itemBytes(item)])),
      bytes: 0,
      sourceSeqRanges: [...payload.entries, ...(payload.contextEntries ?? [])].flatMap((entry) =>
        entry.sourceSeqRangesRef
          ? []
          : (entry.sourceSeqRanges ?? [{ startSeq: entry.seqStart, endSeq: entry.seqEnd }]),
      ),
      hasOlder: payload.hasOlder,
    });
    if (!accepted)
      return {
        ...result,
        commit: "discard",
        cursorChanged: false,
        initResolution: "reject",
        error: "Timeline page exceeds the available history memory budget",
      };
    const retained = this.budget.readRange(key)!;
    return {
      ...result,
      tail: keepUnpositionedOrPending(
        this.serverId,
        payload.agentId,
        retained.keepItemIds,
        result.tail,
      ),
      head: keepUnpositionedOrPending(
        this.serverId,
        payload.agentId,
        retained.keepItemIds,
        result.head,
      ),
      cursor: retained.range,
      cursorChanged: true,
      older: retained.hasOlder ? "available" : "none",
    };
  }
  dispose(): void {
    this.disposed = true;
    for (const dispose of this.registrations.values()) dispose();
    this.registrations.clear();
    this.visible.clear();
    this.reading.clear();
  }
}
