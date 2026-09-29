import type {
  AgentStreamEventPayload,
  ProviderSubagentDescriptorPayload,
  SessionOutboundMessage,
} from "@clisbot/protocol/messages";
import { DaemonConnectionError, type DaemonClient } from "@clisbot/client/internal/daemon-client";
import { create } from "zustand";
import {
  processTimelineResponse,
  processAgentStreamEvent,
  type TimelineCursor,
} from "@/timeline/session-stream-reducers";
import {
  applyProjectedSubagentPage,
  type ProviderSubagentTimelinePage,
} from "./projected-timeline";
import { ProviderSubagentTimelineRetention, trimSubagentTimeline } from "./timeline-retention";
import { applyStreamEvent } from "@/types/stream";
import type { StreamItem } from "@/types/stream";
import type { AgentLifecycleStatus } from "@clisbot/protocol/agent-lifecycle";

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
  needsRefresh: boolean;
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
  needsRefresh: false,
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
      const current = existing ?? EMPTY_TIMELINE;
      if (current.pagingMode === "source_ranges") {
        if (!subagentTimelineRetention.isVisible(key)) return state;
        return applySourceRangeSubagentUpdate(serverId, key, current, payload);
      }
      if (payload.seq <= current.lastSeq) {
        return state;
      }
      const next = processAgentStreamEvent({
        currentTail: current.tail,
        currentHead: current.head,
        currentCursor: current.cursor ?? undefined,
        hasAuthoritativeBaseline: current.cursor != null,
        event: { type: "timeline", provider: payload.provider, item: payload.item },
        timestamp: new Date(payload.timestamp),
        seq: payload.seq,
        epoch: payload.epoch,
      });
      const updated = admitSubagentTimeline(
        serverId,
        payload.parentAgentId,
        key,
        settleSubagentTimeline(
          {
            ...current,
            tail: next.tail,
            head: next.head,
            epoch: payload.epoch,
            lastSeq: payload.seq,
            cursor: next.cursor ?? current.cursor,
            needsRefresh:
              current.needsRefresh || next.sideEffects.some((effect) => effect.type === "catch_up"),
          },
          state.descriptors.get(key)!,
        ),
      );
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
      const current = existing ?? EMPTY_TIMELINE;
      const entries = payload.rows.map((row) => ({
        ...row,
        provider,
        seqStart: row.seqStart ?? row.seq,
        seqEnd: row.seqEnd ?? row.seq,
      }));
      const result = processTimelineResponse({
        payload: {
          ...payload,
          agentId: payload.subagentId,
          projection: "projected",
          startCursor:
            payload.startCursor ??
            (entries.length ? { seq: Math.min(...entries.map((entry) => entry.seqStart)) } : null),
          endCursor:
            payload.endCursor ??
            (entries.length ? { seq: Math.max(...entries.map((entry) => entry.seqEnd)) } : null),
          entries,
        },
        currentTail: current.tail,
        currentHead: current.head,
        currentCursor: current.cursor ?? undefined,
        isInitializing: current.cursor == null,
        hasActiveInitDeferred: current.cursor == null,
        initRequestDirection: "tail",
        sendingClientMessageIds: [],
      });
      const updated = admitSubagentTimeline(
        serverId,
        payload.parentAgentId,
        key,
        settleSubagentTimeline(
          {
            ...current,
            tail: result.tail,
            head: result.head,
            epoch: payload.epoch,
            lastSeq:
              payload.reset || current.epoch !== payload.epoch
                ? (result.cursor?.endSeq ?? 0)
                : Math.max(current.lastSeq, result.cursor?.endSeq ?? 0),
            cursor: result.cursor ?? undefined,
            hasOlder:
              result.older === "unchanged" ? current.hasOlder : result.older === "available",
            needsRefresh:
              result.sideEffects.some((effect) => effect.type === "catch_up") &&
              (payload.hasNewer || current.lastSeq > (result.cursor?.endSeq ?? 0)),
          },
          state.descriptors.get(key)!,
        ),
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
  descriptor?: ProviderSubagentDescriptorPayload,
): ProviderSubagentTimelineState {
  const event = descriptor ? providerSubagentTerminalEvent(descriptor) : null;
  return event
    ? {
        ...current,
        ...applyStreamEvent({
          tail: current.tail,
          head: current.head,
          event,
          timestamp: new Date(descriptor!.updatedAt),
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

/** Owns child history bootstrap and recovery while a pane observes the child. */
export function observeProviderSubagentTimeline({
  client,
  serverId,
  parentAgentId,
  subagentId,
  limit,
  reportError,
}: {
  client: Pick<DaemonClient, "fetchProviderSubagentTimeline">;
  serverId: string;
  parentAgentId: string;
  subagentId: string;
  limit: number;
  reportError: (error: unknown) => void;
}): () => void {
  const key = providerSubagentKey(serverId, parentAgentId, subagentId);
  let active = true;
  let fetching = false;
  const refresh = async () => {
    if (!active || fetching) return;
    fetching = true;
    let succeeded = false;
    try {
      const payload = await client.fetchProviderSubagentTimeline(parentAgentId, subagentId, {
        direction: "tail",
        limit,
      });
      if (active) useProviderSubagentStore.getState().replaceTimeline(serverId, payload);
      succeeded = true;
    } catch (error) {
      // A later stream update or reopening the pane retries a disconnected read.
      if (!(error instanceof DaemonConnectionError)) throw error;
    } finally {
      fetching = false;
      if (
        succeeded &&
        active &&
        useProviderSubagentStore.getState().timelines.get(key)?.needsRefresh
      )
        requestRefresh();
    }
  };
  const requestRefresh = () => {
    void refresh().catch(reportError);
  };
  const unsubscribe = useProviderSubagentStore.subscribe((state) => {
    if (state.timelines.get(key)?.needsRefresh) requestRefresh();
  });
  requestRefresh();
  return () => {
    active = false;
    unsubscribe();
  };
}
