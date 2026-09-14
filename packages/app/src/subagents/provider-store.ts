import type {
  AgentStreamEventPayload,
  ProviderSubagentDescriptorPayload,
  SessionOutboundMessage,
} from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { create } from "zustand";
import { processAgentStreamEvent, type TimelineCursor } from "@/timeline/session-stream-reducers";
import {
  applyProjectedSubagentPage,
  type ProviderSubagentTimelinePage,
} from "./projected-timeline";
import { ProviderSubagentTimelineRetention, trimSubagentTimeline } from "./timeline-retention";
import { applyStreamEvent } from "@/types/stream";
import type { StreamItem } from "@/types/stream";
import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";

type ProviderSubagentTimelineItem = Extract<
  Extract<SessionOutboundMessage, { type: "agent.provider_subagents.update" }>["payload"],
  { kind: "timeline" }
>["item"];

interface ProviderSubagentTimelineRow {
  provider: ProviderSubagentDescriptorPayload["provider"];
  item: ProviderSubagentTimelineItem;
  timestamp: string;
}

export interface ProviderSubagentTimelineState {
  pagingMode?: "source_ranges";
  cursor?: TimelineCursor | null;
  hasNewer?: boolean;
  latestObserved?: { epoch: string; seq: number };
  error?: string;
  historyReady?: boolean;
  tail: StreamItem[];
  head: StreamItem[];
  epoch: string | null;
  lastSeq: number;
  hasOlder: boolean;
  rows: Map<number, ProviderSubagentTimelineRow>;
}

interface ProviderSubagentState {
  descriptors: Map<string, ProviderSubagentDescriptorPayload>;
  timelines: Map<string, ProviderSubagentTimelineState>;
  hiddenFromTrack: Set<string>;
  hideFromTrack(serverId: string, parentAgentId: string, subagentIds: readonly string[]): void;
  replaceList(
    serverId: string,
    parentAgentId: string,
    subagents: ProviderSubagentDescriptorPayload[],
  ): void;
  applyUpdate(
    serverId: string,
    payload: Extract<
      SessionOutboundMessage,
      { type: "agent.provider_subagents.update" }
    >["payload"],
  ): void;
  replaceTimeline(
    serverId: string,
    payload: Extract<
      SessionOutboundMessage,
      { type: "agent.provider_subagents.timeline.get.response" }
    >["payload"],
  ): void;
}

export function providerSubagentKey(
  serverId: string,
  parentAgentId: string,
  subagentId: string,
): string {
  return `${serverId}\0${parentAgentId}\0${subagentId}`;
}

export function providerSubagentLifecycleStatus(
  status: ProviderSubagentDescriptorPayload["status"],
  runtimeAvailable?: boolean,
): AgentLifecycleStatus {
  if (runtimeAvailable === false) return "closed";
  if (status === "running") return "running";
  if (status === "failed") return "error";
  return "idle";
}

type ProviderSubagentListClient = Pick<DaemonClient, "listProviderSubagents">;

const pendingListRequests = new WeakMap<ProviderSubagentListClient, Map<string, Promise<void>>>();

export function refreshProviderSubagents(
  client: ProviderSubagentListClient,
  serverId: string,
  parentAgentId: string,
): Promise<void> {
  const requestKey = `${serverId}\0${parentAgentId}`;
  let clientRequests = pendingListRequests.get(client);
  if (!clientRequests) {
    clientRequests = new Map();
    pendingListRequests.set(client, clientRequests);
  }
  const pending = clientRequests.get(requestKey);
  if (pending) return pending;

  const request = client
    .listProviderSubagents(parentAgentId)
    .then((payload) => {
      useProviderSubagentStore.getState().replaceList(serverId, parentAgentId, payload.subagents);
      return undefined;
    })
    .finally(() => {
      clientRequests?.delete(requestKey);
    });
  clientRequests.set(requestKey, request);
  return request;
}

function parentPrefix(serverId: string, parentAgentId: string): string {
  return `${serverId}\0${parentAgentId}\0`;
}

const EMPTY_TIMELINE: ProviderSubagentTimelineState = {
  tail: [],
  head: [],
  epoch: null,
  lastSeq: 0,
  hasOlder: false,
  rows: new Map(),
};

function providerSubagentTerminalEvent(
  subagent: ProviderSubagentDescriptorPayload,
): AgentStreamEventPayload | null {
  if (subagent.status === "running" && subagent.runtimeAvailable !== false) {
    return null;
  }
  if (subagent.status === "failed") {
    return { type: "turn_failed", provider: subagent.provider, error: "Subagent failed" };
  }
  if (subagent.status === "canceled") {
    return { type: "turn_canceled", provider: subagent.provider, reason: "canceled" };
  }
  return { type: "turn_completed", provider: subagent.provider };
}

function buildTimelineState(
  rows: ProviderSubagentTimelineState["rows"],
  epoch: string | null,
  descriptor?: ProviderSubagentDescriptorPayload,
  hasOlder = false,
): ProviderSubagentTimelineState {
  let timeline = { tail: [] as StreamItem[], head: [] as StreamItem[] };
  for (const [, row] of [...rows].sort(([left], [right]) => left - right)) {
    timeline = applyStreamEvent({
      ...timeline,
      event: { type: "timeline", provider: row.provider, item: row.item },
      timestamp: new Date(row.timestamp),
    });
  }
  const terminalEvent = descriptor ? providerSubagentTerminalEvent(descriptor) : null;
  if (terminalEvent && descriptor) {
    timeline = applyStreamEvent({
      ...timeline,
      event: terminalEvent,
      timestamp: new Date(descriptor.updatedAt),
    });
  }
  return {
    ...timeline,
    epoch,
    lastSeq: rows.size ? Math.max(...rows.keys()) : 0,
    historyReady: true,
    hasOlder,
    rows,
  };
}

function buildTimelineResponseRows(
  existing: ProviderSubagentTimelineState | undefined,
  payload: Extract<
    SessionOutboundMessage,
    { type: "agent.provider_subagents.timeline.get.response" }
  >["payload"],
  provider: ProviderSubagentDescriptorPayload["provider"],
): ProviderSubagentTimelineState["rows"] {
  const rows = new Map<number, ProviderSubagentTimelineRow>();
  for (const row of payload.rows) {
    rows.set(row.seq, { provider, item: row.item, timestamp: row.timestamp });
  }
  if (payload.reset || existing?.epoch !== payload.epoch) {
    return rows;
  }
  if (payload.direction !== "tail") {
    return new Map([...existing.rows, ...rows]);
  }

  let nextSeq = payload.rows.length
    ? Math.max(...payload.rows.map((row) => row.seq)) + 1
    : payload.window.maxSeq + 1;
  for (const [seq, row] of [...existing.rows].sort(([left], [right]) => left - right)) {
    if (seq < nextSeq) continue;
    if (seq !== nextSeq) break;
    rows.set(seq, row);
    nextSeq += 1;
  }
  return rows;
}

export const useProviderSubagentStore = create<ProviderSubagentState>((set) => ({
  descriptors: new Map(),
  timelines: new Map(),
  hiddenFromTrack: new Set(),
  hideFromTrack(serverId, parentAgentId, subagentIds) {
    set((state) => {
      const hiddenFromTrack = new Set(state.hiddenFromTrack);
      for (const subagentId of subagentIds) {
        const key = providerSubagentKey(serverId, parentAgentId, subagentId);
        if (state.descriptors.get(key)?.status !== "running") hiddenFromTrack.add(key);
      }
      return { hiddenFromTrack };
    });
  },
  replaceList(serverId, parentAgentId, subagents) {
    set((state) => {
      const prefix = parentPrefix(serverId, parentAgentId);
      const descriptors = new Map(
        [...state.descriptors].filter(([key]) => !key.startsWith(prefix)),
      );
      const hiddenFromTrack = new Set(state.hiddenFromTrack);
      for (const subagent of subagents) {
        const key = providerSubagentKey(serverId, parentAgentId, subagent.id);
        descriptors.set(key, subagent);
        if (subagent.status === "running" && subagent.runtimeAvailable !== false) {
          hiddenFromTrack.delete(key);
        }
      }
      const retainedKeys = new Set(descriptors.keys());
      for (const key of state.timelines.keys())
        if (key.startsWith(prefix) && !retainedKeys.has(key)) subagentTimelineRetention.remove(key);
      const timelines = new Map(
        [...state.timelines].filter(([key]) => !key.startsWith(prefix) || retainedKeys.has(key)),
      );
      for (const subagent of subagents) {
        const key = providerSubagentKey(serverId, parentAgentId, subagent.id);
        const current = timelines.get(key);
        const previous = state.descriptors.get(key);
        if (current && previous?.status !== subagent.status) {
          timelines.set(key, settleSubagentTimeline(current, subagent));
        }
      }
      return { descriptors, timelines, hiddenFromTrack };
    });
  },
  applyUpdate(serverId, payload) {
    set((state) => {
      if (payload.kind === "upsert") {
        const key = providerSubagentKey(
          serverId,
          payload.subagent.parentAgentId,
          payload.subagent.id,
        );
        const descriptors = new Map(state.descriptors);
        const hiddenFromTrack = new Set(state.hiddenFromTrack);
        const previous = descriptors.get(key);
        descriptors.set(key, payload.subagent);
        if (payload.subagent.status === "running" && payload.subagent.runtimeAvailable !== false) {
          hiddenFromTrack.delete(key);
        }
        let timelines = state.timelines;
        const current = state.timelines.get(key);
        if (current && previous?.status !== payload.subagent.status) {
          timelines = new Map(state.timelines);
          timelines.set(key, settleSubagentTimeline(current, payload.subagent));
        }
        return { descriptors, timelines, hiddenFromTrack };
      }
      if (payload.kind === "remove") {
        const key = providerSubagentKey(serverId, payload.parentAgentId, payload.subagentId);
        const descriptors = new Map(state.descriptors);
        descriptors.delete(key);
        subagentTimelineRetention.remove(key);
        const timelines = new Map(state.timelines);
        timelines.delete(key);
        return { descriptors, timelines };
      }
      const key = providerSubagentKey(serverId, payload.parentAgentId, payload.subagentId);
      const existing = state.timelines.get(key);
      if (
        existing?.epoch &&
        existing.epoch !== payload.epoch &&
        existing.pagingMode !== "source_ranges"
      ) {
        return state;
      }
      if (!subagentTimelineRetention.isVisible(key)) return state;
      const current = existing ?? EMPTY_TIMELINE;
      if (current.pagingMode === "source_ranges")
        return applySourceRangeSubagentUpdate(serverId, key, current, payload);
      if (payload.seq <= current.lastSeq) {
        return state;
      }
      const rows = new Map(current.rows);
      rows.set(payload.seq, {
        provider: payload.provider,
        item: payload.item,
        timestamp: payload.timestamp,
      });
      const descriptor = state.descriptors.get(key);
      const next =
        descriptor && descriptor.status !== "running"
          ? buildTimelineState(rows, payload.epoch, descriptor, current.hasOlder)
          : applyStreamEvent({
              tail: current.tail,
              head: current.head,
              event: { type: "timeline", provider: payload.provider, item: payload.item },
              timestamp: new Date(payload.timestamp),
            });
      const updated = admitSubagentTimeline(serverId, payload.parentAgentId, key, {
        ...next,
        epoch: payload.epoch,
        lastSeq: payload.seq,
        hasOlder: current.hasOlder,
        historyReady: current.historyReady ?? false,
        rows,
      });
      const timelines = new Map(useProviderSubagentStore.getState().timelines);
      timelines.set(key, updated);
      return { timelines };
    });
  },
  replaceTimeline(serverId, payload) {
    const provider = payload.provider;
    if (!provider) {
      return;
    }
    set((state) => {
      const key = providerSubagentKey(serverId, payload.parentAgentId, payload.subagentId);
      const existing = state.timelines.get(key);
      if (payload.pagingMode === "source_ranges") {
        const updated = admitSubagentTimeline(
          serverId,
          payload.parentAgentId,
          key,
          applyProjectedSubagentPage(existing, payload),
          payload,
        );
        const timelines = new Map(useProviderSubagentStore.getState().timelines);
        timelines.set(key, updated);
        return { timelines };
      }
      const rows = buildTimelineResponseRows(existing, payload, provider);
      const descriptor = state.descriptors.get(key);
      const updated = admitSubagentTimeline(
        serverId,
        payload.parentAgentId,
        key,
        buildTimelineState(rows, payload.epoch, descriptor, payload.hasOlder),
      );
      const timelines = new Map(useProviderSubagentStore.getState().timelines);
      timelines.set(key, updated);
      return { timelines };
    });
  },
}));

const subagentTimelineRetention = new ProviderSubagentTimelineRetention((key, change) => {
  useProviderSubagentStore.setState((state) => {
    const current = state.timelines.get(key);
    if (!current) return state;
    const timelines = new Map(state.timelines);
    timelines.set(key, trimSubagentTimeline(current, change));
    return { timelines };
  });
});

export function setProviderSubagentTimelineReading(
  serverId: string,
  parentAgentId: string,
  subagentId: string,
  visible: boolean,
  itemId: string | null = null,
): void {
  const key = providerSubagentKey(serverId, parentAgentId, subagentId);
  subagentTimelineRetention.ensure(key, serverId, parentAgentId);
  subagentTimelineRetention.setReading(key, visible, itemId);
}

function admitSubagentTimeline(
  serverId: string,
  parentAgentId: string,
  key: string,
  current: ProviderSubagentTimelineState,
  page?: ProviderSubagentTimelinePage,
): ProviderSubagentTimelineState {
  subagentTimelineRetention.ensure(key, serverId, parentAgentId);
  return subagentTimelineRetention.admit(key, current, page);
}

function settleSubagentTimeline(
  current: ProviderSubagentTimelineState,
  descriptor: ProviderSubagentDescriptorPayload,
): ProviderSubagentTimelineState {
  if (current.pagingMode !== "source_ranges")
    return {
      ...buildTimelineState(current.rows, current.epoch, descriptor, current.hasOlder),
      historyReady: current.historyReady,
    };
  const event = providerSubagentTerminalEvent(descriptor);
  return event
    ? {
        ...current,
        ...applyStreamEvent({
          tail: current.tail,
          head: current.head,
          event,
          timestamp: new Date(descriptor.updatedAt),
        }),
      }
    : current;
}

/**
 * COMPAT(agentSessionStorageRead): source-range lane only. A failed projection degrades to an
 * error on the retained timeline rather than dropping the update.
 */
function applySourceRangeSubagentUpdate(
  serverId: string,
  key: string,
  current: ProviderSubagentTimelineState,
  payload: Extract<
    Extract<SessionOutboundMessage, { type: "agent.provider_subagents.update" }>["payload"],
    { kind: "timeline" }
  >,
): Partial<ProviderSubagentState> {
  let updated: ProviderSubagentTimelineState;
  try {
    updated = applyProjectedSubagentUpdate(serverId, key, current, payload);
  } catch (error) {
    updated = {
      ...(useProviderSubagentStore.getState().timelines.get(key) ?? current),
      error: error instanceof Error ? error.message : "Unable to update subagent history",
    };
  }
  const timelines = new Map(useProviderSubagentStore.getState().timelines);
  timelines.set(key, updated);
  return { timelines };
}

function applyProjectedSubagentUpdate(
  serverId: string,
  key: string,
  current: ProviderSubagentTimelineState,
  payload: Extract<
    Extract<SessionOutboundMessage, { type: "agent.provider_subagents.update" }>["payload"],
    { kind: "timeline" }
  >,
): ProviderSubagentTimelineState {
  if (
    current.epoch !== payload.epoch ||
    [...current.tail, ...current.head].some(
      (item) => item.timelineCursor?.deferredPayload || item.timelineCursor?.sourceSeqRangesRef,
    )
  ) {
    const observed = current.latestObserved;
    return {
      ...current,
      hasNewer: true,
      latestObserved: {
        epoch: payload.epoch,
        seq: observed?.epoch === payload.epoch ? Math.max(observed.seq, payload.seq) : payload.seq,
      },
    };
  }
  const result = processAgentStreamEvent({
    event: { type: "timeline", provider: payload.provider, item: payload.item },
    epoch: payload.epoch,
    seq: payload.seq,
    timestamp: new Date(payload.timestamp),
    currentTail: current.tail,
    currentHead: current.head,
    currentCursor: current.cursor ?? undefined,
    hasAuthoritativeBaseline: Boolean(current.cursor),
    // Only reached in source-range mode, which a host without the read capability never enters.
    trackSourcePositions: true,
  });
  if (result.sideEffects.length) return { ...current, hasNewer: true };
  const next = {
    ...current,
    tail: result.tail,
    head: result.head,
    cursor: result.cursor,
    lastSeq: result.cursor?.endSeq ?? current.lastSeq,
  };
  const touched = [...result.tail, ...result.head].filter(
    (item) => item.timelineCursor?.seq === payload.seq,
  );
  const page: ProviderSubagentTimelinePage = {
    requestId: "live",
    parentAgentId: payload.parentAgentId,
    subagentId: payload.subagentId,
    provider: payload.provider,
    direction: "after",
    epoch: payload.epoch,
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 1, maxSeq: payload.seq, nextSeq: payload.seq + 1 },
    pagingMode: "source_ranges",
    startCursor: { epoch: payload.epoch, seq: payload.seq },
    endCursor: { epoch: payload.epoch, seq: payload.seq },
    entries: touched.map((item) => ({
      provider: payload.provider,
      item: payload.item,
      timestamp: payload.timestamp,
      seqStart: item.timelineCursor?.seqStart ?? payload.seq,
      seqEnd: payload.seq,
      sourceSeqRanges: item.timelineCursor?.sourceSeqRanges ?? [
        { startSeq: payload.seq, endSeq: payload.seq },
      ],
      collapsed: [],
    })),
    rows: [],
    hasOlder: true,
    hasNewer: false,
    error: null,
  };
  return admitSubagentTimeline(serverId, payload.parentAgentId, key, next, page);
}
