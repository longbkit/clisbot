import {
  TimelineDirectionalPrefetch,
  type AdjacentTimelineRequest,
} from "./timeline-directional-prefetch";
import type { TimelinePageRetention } from "./timeline-page-retention";
import { TimelineRetentionOwner } from "./timeline-retention-owner";
import {
  planTimelineCatchUpAfter,
  planTimelineResumeFetch,
  type ProjectedTimelineForwardFetchPlan,
} from "./timeline-sync-plan";
import type { CachedTimeline } from "@/runtime/replica-cache";
import {
  selectAgentTimelineState,
  useSessionStore,
  type AgentTimelineCursorState,
  type AgentTimelineState,
} from "@/stores/session-store";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { getSendingClientMessageIds } from "@/composer/submission/model";
import {
  getInitDeferred,
  getInitKey,
  rejectInitDeferred,
  resolveInitDeferred,
} from "@/utils/agent-initialization";
import {
  createSessionAgentStreamReducerQueue,
  type AgentStreamReducerEvent,
  type ProcessTimelineResponseOutput,
  processTimelineResponse,
} from "./session-stream-reducers";
import { isTimelineResumeSnapshotAuthoritative } from "./timeline-sync-plan";
import { createInstalledTimelineTransform, type TimelineItemTransform } from "@/plugins/timeline";
import { replaceWithCanonicalStream } from "@/types/stream";

const PLUGIN_TIMELINE_REPROJECTION_DELAY_MS = 50;

export interface TimelineReplicaStorage {
  readTimeline(serverId: string, agentId: string): Promise<CachedTimeline | undefined>;
  commitTimeline(serverId: string, agentId: string, timeline: CachedTimeline): void;
}

async function prepareCachedTimeline(input: {
  serverId: string;
  agentId: string;
  storage: TimelineReplicaStorage;
  prepareAgent: (agentId: string) => Promise<void>;
}): Promise<CachedTimeline | undefined> {
  const before = useSessionStore.getState().sessions[input.serverId];
  const beforeTimeline = selectAgentTimelineState(before, input.agentId);
  if (beforeTimeline.status === "synced") return undefined;
  const beforeHead = before?.agentStreamHead.get(input.agentId);
  await input.prepareAgent(input.agentId);
  const stored = await input.storage.readTimeline(input.serverId, input.agentId);
  if (!stored) return undefined;
  const session = useSessionStore.getState().sessions[input.serverId];
  const currentTimeline = selectAgentTimelineState(session, input.agentId);
  const currentHead = session?.agentStreamHead.get(input.agentId);
  if (currentTimeline.status === "synced") return undefined;
  if (!stored.range) {
    if (currentHead !== beforeHead) return undefined;
    if (beforeTimeline.status === "painted") {
      return currentTimeline.status === "painted" && currentTimeline.items === beforeTimeline.items
        ? stored
        : undefined;
    }
    if (currentTimeline.status !== "cold") return undefined;
  }
  const liveItems =
    currentTimeline.status === "painted"
      ? [...currentTimeline.items, ...(currentHead ?? [])]
      : (currentHead ?? []);
  const replacement = stored.range
    ? replaceWithCanonicalStream({
        canonical: stored.items,
        previousTail: [],
        previousHead: liveItems,
        sendingClientMessageIds: getSendingClientMessageIds(
          session?.messageSubmissions.get(input.agentId),
        ),
        preserveContinuity: true,
        canonicalCoverage: stored.range,
      })
    : { tail: stored.items, head: liveItems, acknowledgedClientMessageIds: [] };
  useSessionStore.getState().applyAgentTimelineResponseState(input.serverId, input.agentId, {
    items: replacement.tail,
    head: replacement.head,
    range: stored.range,
    older: stored.hasOlder ? "available" : "none",
    newer: false,
    synchronized: false,
    acknowledgedClientMessageIds: replacement.acknowledgedClientMessageIds,
  });
  return stored;
}

export interface TimelineReplica {
  prepare(agentId: string): Promise<void>;
  readCursor(agentId: string): { epoch: string; endSeq: number } | undefined;
  timelineUpdated(agentId: string): void;
}

class TimelineReplicaOwner implements TimelineReplica {
  private readonly cachedCursors = new Map<string, { epoch: string; endSeq: number }>();
  private readonly preparations = new Map<string, Promise<void>>();

  constructor(
    private readonly serverId: string,
    private readonly storage: TimelineReplicaStorage,
    private readonly prepareAgent: (agentId: string) => Promise<void>,
  ) {}

  async prepare(agentId: string): Promise<void> {
    const existing = this.preparations.get(agentId);
    if (existing) return existing;
    const preparation = this.load(agentId).finally(() => {
      if (this.preparations.get(agentId) === preparation) {
        this.preparations.delete(agentId);
      }
    });
    this.preparations.set(agentId, preparation);
    return preparation;
  }

  private async load(agentId: string): Promise<void> {
    const stored = await prepareCachedTimeline({
      serverId: this.serverId,
      agentId,
      storage: this.storage,
      prepareAgent: this.prepareAgent,
    });
    if (!stored) return;
    if (stored.range) {
      this.cachedCursors.set(agentId, {
        epoch: stored.range.epoch,
        endSeq: stored.range.endSeq,
      });
    }
  }

  readCursor(agentId: string): { epoch: string; endSeq: number } | undefined {
    const cached = this.cachedCursors.get(agentId);
    const retained = useSessionStore
      .getState()
      .sessions[this.serverId]?.agentTimelineCursor.get(agentId);
    if (
      !cached ||
      !retained ||
      cached.epoch !== retained.epoch ||
      cached.endSeq > retained.endSeq
    ) {
      this.cachedCursors.delete(agentId);
      return undefined;
    }
    return cached;
  }

  timelineUpdated(agentId: string): void {
    const session = useSessionStore.getState().sessions[this.serverId];
    const timeline = selectAgentTimelineState(session, agentId);
    if (timeline.status !== "synced") return;
    this.cachedCursors.delete(agentId);
    this.storage.commitTimeline(this.serverId, agentId, {
      agentId,
      items: [...timeline.items, ...(session?.agentStreamHead.get(agentId) ?? [])],
      range: timeline.range,
      hasOlder: timeline.older === "available",
    });
  }
}

export function createTimelineReplica(input: {
  serverId: string;
  storage: TimelineReplicaStorage;
  prepareAgent: (agentId: string) => Promise<void>;
}): TimelineReplica {
  return new TimelineReplicaOwner(input.serverId, input.storage, input.prepareAgent);
}

export interface TimelinePageResult {
  hasNewer: boolean;
  endCursor: { epoch: string; seq: number } | null;
}

export type TimelineResponsePayload = Extract<
  SessionOutboundMessage,
  { type: "fetch_agent_timeline_response" }
>["payload"];

function clearAgentInitializingFlag(serverId: string, agentId: string): void {
  useSessionStore.getState().setInitializingAgents(serverId, (previous) => {
    if (previous.get(agentId) !== true) return previous;
    const next = new Map(previous);
    next.set(agentId, false);
    return next;
  });
}

function commitProcessedTimeline(input: {
  serverId: string;
  payload: TimelineResponsePayload;
  result: ProcessTimelineResponseOutput;
  timeline: AgentTimelineState;
  currentCursor: AgentTimelineCursorState | undefined;
  synchronized: boolean;
}): void {
  const { serverId, payload, result, timeline, currentCursor, synchronized } = input;
  const agentId = payload.agentId;
  const store = useSessionStore.getState();
  if (result.commit !== "discard") {
    store.applyAgentTimelineResponseState(serverId, agentId, {
      items: result.tail,
      head: result.head,
      range: result.cursorChanged ? (result.cursor ?? null) : (currentCursor ?? null),
      older: result.older,
      newer:
        payload.direction === "before"
          ? timeline.status === "synced" && timeline.newer === "available"
          : payload.hasNewer,
      synchronized,
      acknowledgedClientMessageIds: result.acknowledgedClientMessageIds,
    });
    return;
  }
  if (result.acknowledgedClientMessageIds.length > 0) {
    store.setAgentStreamState(serverId, agentId, {
      acknowledgedClientMessageIds: result.acknowledgedClientMessageIds,
    });
  }
  if (payload.direction !== "before") {
    store.setAgentTimelineHasNewer(serverId, (current) => {
      const next = new Map(current);
      next.set(agentId, payload.hasNewer);
      return next;
    });
  }
  store.markAgentHistorySynchronized(serverId, agentId);
}

function finalizeProcessedTimeline(input: {
  serverId: string;
  agentId: string;
  initKey: string;
  result: ProcessTimelineResponseOutput;
  synchronized: boolean;
  recoverGap: (agentId: string, cursor: { epoch: string; endSeq: number }) => void;
  drainQueuedAgentMessage: (agentId: string) => void;
}): void {
  for (const effect of input.result.sideEffects) {
    if (effect.type === "catch_up") input.recoverGap(input.agentId, effect.cursor);
  }
  if (input.result.clearInitializing) {
    clearAgentInitializingFlag(input.serverId, input.agentId);
  }
  if (input.synchronized) {
    useCreateFlowStore
      .getState()
      .clearByAgent({ serverId: input.serverId, agentId: input.agentId });
    const session = useSessionStore.getState().sessions[input.serverId];
    const agent = session?.agents.get(input.agentId) ?? session?.agentDetails.get(input.agentId);
    if (agent && agent.status !== "running") input.drainQueuedAgentMessage(input.agentId);
  }
  if (input.result.initResolution === "resolve") resolveInitDeferred(input.initKey);
}

function applyAuthoritativeTimelineResponse(input: {
  serverId: string;
  payload: TimelineResponsePayload;
  recoverGap: (agentId: string, cursor: { epoch: string; endSeq: number }) => void;
  drainQueuedAgentMessage: (agentId: string) => void;
  transformTimelineItem?: TimelineItemTransform;
  admit?: (
    payload: TimelineResponsePayload,
    result: ProcessTimelineResponseOutput,
  ) => ProcessTimelineResponseOutput;
}): boolean {
  const { serverId, payload } = input;
  const agentId = payload.agentId;
  const initKey = getInitKey(serverId, agentId);
  const session = useSessionStore.getState().sessions[serverId];
  const timeline = selectAgentTimelineState(session, agentId);
  const activeInitDeferred = getInitDeferred(initKey);
  const currentCursor = timeline.status === "synced" ? (timeline.range ?? undefined) : undefined;
  let result = processTimelineResponse({
    payload,
    currentTail: timeline.status === "cold" ? [] : timeline.items,
    currentHead: session?.agentStreamHead.get(agentId) ?? [],
    currentCursor,
    isInitializing: session?.initializingAgents.get(agentId) === true,
    hasActiveInitDeferred: Boolean(activeInitDeferred),
    initRequestDirection: activeInitDeferred?.requestDirection ?? "tail",
    sendingClientMessageIds: getSendingClientMessageIds(session?.messageSubmissions.get(agentId)),
    transformTimelineItem: input.transformTimelineItem,
  });

  if (input.admit) result = input.admit(payload, result);
  if (result.error) {
    if (result.clearInitializing) clearAgentInitializingFlag(serverId, agentId);
    if (result.initResolution === "reject") rejectInitDeferred(initKey, new Error(result.error));
    return false;
  }

  const synchronized = isTimelineResumeSnapshotAuthoritative({
    direction: payload.direction,
    hasNewer: payload.hasNewer,
    error: payload.error,
  });
  commitProcessedTimeline({ serverId, payload, result, timeline, currentCursor, synchronized });
  finalizeProcessedTimeline({
    serverId,
    agentId,
    initKey,
    result,
    synchronized,
    recoverGap: input.recoverGap,
    drainQueuedAgentMessage: input.drainQueuedAgentMessage,
  });
  return true;
}

export interface ViewedTimelineSyncPorts {
  initialDeliveryMode: TimelineDeliveryMode;
  prepare(agentId: string): Promise<void>;
  replaceDemandedAgentIds(agentIds: string[]): void;
  setSubscription(agentIds: string[]): Promise<void>;
  readCursor(agentId: string): { epoch: string; endSeq: number } | undefined;
  readLatestObserved?(agentId: string): { epoch: string; seq: number } | undefined;
  fetchPage(
    agentId: string,
    request: ProjectedTimelineForwardFetchPlan,
  ): Promise<TimelinePageResult>;
  fetchLatestTail(agentId: string): Promise<TimelinePageResult>;
  fetchAdjacentPage?(
    agentId: string,
    request: AdjacentTimelineRequest & { requestId: string; mergeWindow?: boolean },
  ): Promise<void>;
  reportError(error: unknown): void;
  schedule(task: () => void, delayMs: number): () => void;
}

export type TimelineDeliveryMode = "legacy" | "selective";
export type ViewedTimelineStatus = "ready" | "pending" | "error" | "retrying";

export interface ViewedTimelineUiBridge {
  reportReadingPosition?(agentId: string, itemId: string | null): void;
  restoreReadingAnchor?(agentId: string, cursor: { epoch: string; seq: number }): Promise<void>;
  replaceVisibleAgentIds(sourceId: string, agentIds: string[]): void;
  subscribe(listener: () => void): () => void;
  getAgentTimelineStatus(agentId: string): ViewedTimelineStatus;
  getAgentTimelineError(agentId: string): string | null;
  retryVisibleAgentTimeline(agentId: string): void;
  reprojectVisibleTimelines(): void;
}

export interface ViewedTimelineSync extends ViewedTimelineUiBridge {
  setActive(active: boolean): void;
  setConnected(connected: boolean): void;
  setDeliveryMode(mode: TimelineDeliveryMode): void;
  recoverGap(agentId: string, cursor: { epoch: string; endSeq: number }): void;
  dispose(): void;
}

export type ViewedTimelineOwnerPorts = Omit<
  ViewedTimelineSyncPorts,
  "prepare" | "replaceDemandedAgentIds"
>;

export interface ViewedTimelineOwner extends ViewedTimelineSync {
  applyTimelineResponse(payload: TimelineResponsePayload): void;
  enqueueStreamEvent(agentId: string, event: AgentStreamReducerEvent): void;
  flushStreamAgent(agentId: string): void;
}

function acknowledgeHiddenSubmission(
  serverId: string,
  agentId: string,
  incoming: AgentStreamReducerEvent,
): void {
  if (
    incoming.seq === undefined ||
    !incoming.epoch ||
    incoming.event.type !== "timeline" ||
    incoming.event.item.type !== "user_message"
  )
    return;
  const clientMessageId = incoming.event.item.clientMessageId;
  if (!clientMessageId) return;
  const submissions = useSessionStore
    .getState()
    .sessions[serverId]?.messageSubmissions.get(agentId);
  if (!getSendingClientMessageIds(submissions).includes(clientMessageId)) return;
  useSessionStore
    .getState()
    .setAgentStreamState(serverId, agentId, { acknowledgedClientMessageIds: [clientMessageId] });
}

let prefetchOwnerCounter = 0;
const PREFETCH_REQUEST_PREFIX = "paseo-prefetch:";
const ANCHOR_REQUEST_PREFIX = "paseo-anchor:";

export function createViewedTimelineOwner(input: {
  retentionBudget?: TimelinePageRetention;
  serverId: string;
  replica: TimelineReplica;
  replaceDemandedAgentIds: (agentIds: string[]) => void;
  drainQueuedAgentMessage: (agentId: string) => void;
  ports: ViewedTimelineOwnerPorts;
}): ViewedTimelineOwner {
  const retention = new TimelineRetentionOwner(input.serverId, input.retentionBudget);
  const visibleSources = new Map<string, readonly string[]>();
  const deferredLatest = new Map<string, { epoch: string; seq: number }>();
  let active = true;
  const visible = (agentId: string) => {
    if (!active) return false;
    for (const ids of visibleSources.values()) if (ids.includes(agentId)) return true;
    return false;
  };
  let connected = false;
  const prefetchPrefix = `${PREFETCH_REQUEST_PREFIX}${++prefetchOwnerCounter}:`;
  let prefetchCounter = 0;
  const anchorRequests = new Map<string, { requestId: string; controller: AbortController }>();
  const cancelAnchors = () => {
    for (const request of anchorRequests.values()) request.controller.abort();
    anchorRequests.clear();
  };
  let prefetchRequest: { agentId: string; requestId: string; signal: AbortSignal } | null = null;
  const prefetch = new TimelineDirectionalPrefetch({
    canPrefetch: (agentId) =>
      connected &&
      visible(agentId) &&
      Boolean(input.ports.fetchAdjacentPage) &&
      retention.canPrefetch(agentId),
    fetch: async (agentId, request) => {
      const current = {
        agentId,
        requestId: `${prefetchPrefix}${++prefetchCounter}`,
        signal: request.signal,
      };
      prefetchRequest = current;
      try {
        await input.ports.fetchAdjacentPage?.(agentId, {
          ...request,
          requestId: current.requestId,
        });
      } finally {
        if (prefetchRequest === current) prefetchRequest = null;
      }
    },
    reportError: input.ports.reportError,
  });
  const unsubscribeBudget = retention.subscribeBudget(() => {
    if (prefetchRequest && !retention.canPrefetch(prefetchRequest.agentId)) prefetch.cancel();
  });
  const reportReadingPosition = (agentId: string, itemId: string | null) => {
    if (!visible(agentId)) return;
    retention.setReading(agentId, itemId);
    if (!itemId) {
      prefetch.reset();
      return;
    }
    const session = useSessionStore.getState().sessions[input.serverId];
    const timeline = selectAgentTimelineState(session, agentId);
    const range = session?.agentTimelineCursor.get(agentId);
    if (timeline.status !== "synced" || !range) return;
    const items = [...timeline.items, ...(session?.agentStreamHead.get(agentId) ?? [])];
    const item = items.find((candidate) => candidate.id === itemId);
    const seq = item?.timelineCursor?.seqStart ?? item?.timelineCursor?.seq;
    if (seq === undefined || seq < range.startSeq || seq > range.endSeq) return;
    prefetch.reading({
      agentId,
      itemId,
      epoch: range.epoch,
      seq,
      startSeq: range.startSeq,
      endSeq: range.endSeq,
      nearStart: seq - range.startSeq <= 20,
      nearEnd: range.endSeq - seq <= 20,
      hasOlder: timeline.older === "available",
      hasNewer: timeline.newer === "available",
    });
  };
  const transformTimelineItem = createInstalledTimelineTransform(input.serverId);
  const reprojections = new Set<string>();
  const pendingReprojections = new Set<string>();
  const scheduledReprojections = new Map<string, () => void>();
  const startTimelineReprojection = (agentId: string) => {
    scheduledReprojections.delete(agentId);
    if (reprojections.has(agentId)) {
      pendingReprojections.add(agentId);
      return;
    }
    reprojections.add(agentId);
    void input.ports
      .fetchLatestTail(agentId)
      .catch(input.ports.reportError)
      .finally(() => {
        reprojections.delete(agentId);
        if (pendingReprojections.delete(agentId)) reprojectTimeline(agentId);
      });
  };
  const reprojectTimeline = (agentId: string) => {
    scheduledReprojections.get(agentId)?.();
    const cancel = input.ports.schedule(
      () => startTimelineReprojection(agentId),
      PLUGIN_TIMELINE_REPROJECTION_DELAY_MS,
    );
    scheduledReprojections.set(agentId, cancel);
  };
  const sync = createViewedTimelineSync({
    ...input.ports,
    prepare: async (agentId) => {
      await input.replica.prepare(agentId);
      retention.prepare(agentId);
    },
    readCursor: (agentId) => input.replica.readCursor(agentId) ?? input.ports.readCursor(agentId),
    readLatestObserved: (agentId) => deferredLatest.get(agentId),
    replaceDemandedAgentIds: input.replaceDemandedAgentIds,
  });
  const streamQueue = createSessionAgentStreamReducerQueue({
    serverId: input.serverId,
    setAgentStreamState: (...args) => useSessionStore.getState().setAgentStreamState(...args),
    setAgentTimelineCursor: (...args) => useSessionStore.getState().setAgentTimelineCursor(...args),
    recoverTimelineGap: (agentId, cursor) => sync.recoverGap(agentId, cursor),
    reprojectTimeline,
    onCommitted: (agentId) => input.replica.timelineUpdated(agentId),
    admitCommit: (agentId, result, events) => {
      try {
        return retention.admitStream(agentId, result, events);
      } catch (error) {
        input.ports.reportError(error);
        const timeline = selectAgentTimelineState(
          useSessionStore.getState().sessions[input.serverId],
          agentId,
        );
        const cursor = timeline.status === "synced" ? timeline.range : null;
        if (cursor) sync.recoverGap(agentId, cursor);
        return {
          ...result,
          tail: timeline.status === "cold" ? [] : timeline.items,
          head:
            useSessionStore.getState().sessions[input.serverId]?.agentStreamHead.get(agentId) ?? [],
          cursor,
          changedTail: false,
          changedHead: false,
          cursorChanged: false,
        };
      }
    },
    transformTimelineItem,
  });
  return {
    ...sync,
    reportReadingPosition,
    async restoreReadingAnchor(agentId, cursor) {
      if (!connected || !visible(agentId) || !input.ports.fetchAdjacentPage)
        throw new Error("History connection is unavailable");
      anchorRequests.get(agentId)?.controller.abort();
      const current = {
        requestId: `${ANCHOR_REQUEST_PREFIX}${prefetchPrefix}${++prefetchCounter}`,
        controller: new AbortController(),
      };
      anchorRequests.set(agentId, current);
      try {
        await input.ports.fetchAdjacentPage(agentId, {
          direction: "before",
          cursor: { epoch: cursor.epoch, seq: cursor.seq + 1 },
          mergeWindow: true,
          requestId: current.requestId,
          signal: current.controller.signal,
        });
      } finally {
        if (anchorRequests.get(agentId) === current) anchorRequests.delete(agentId);
      }
    },
    applyTimelineResponse(payload) {
      if (payload.requestId.startsWith(ANCHOR_REQUEST_PREFIX)) {
        const request = anchorRequests.get(payload.agentId);
        if (
          payload.requestId !== request?.requestId ||
          request.controller.signal.aborted ||
          !visible(payload.agentId)
        )
          return;
      }
      const speculative = payload.requestId.startsWith(PREFETCH_REQUEST_PREFIX);
      if (
        speculative &&
        (payload.requestId !== prefetchRequest?.requestId ||
          prefetchRequest.signal.aborted ||
          !visible(payload.agentId))
      )
        return;
      if (!speculative) prefetch.cursorChanged(payload.agentId);
      const accepted = applyAuthoritativeTimelineResponse({
        serverId: input.serverId,
        payload,
        recoverGap: (agentId, cursor) => sync.recoverGap(agentId, cursor),
        drainQueuedAgentMessage: input.drainQueuedAgentMessage,
        transformTimelineItem,
        admit: (page, result) => retention.admit(page, result),
      });
      if (accepted) {
        input.replica.timelineUpdated(payload.agentId);
        const target = deferredLatest.get(payload.agentId);
        const cursor = useSessionStore
          .getState()
          .sessions[input.serverId]?.agentTimelineCursor.get(payload.agentId);
        if (target && cursor?.epoch === target.epoch && cursor.endSeq >= target.seq)
          deferredLatest.delete(payload.agentId);
      }
    },
    setConnected(value) {
      connected = value;
      if (!value) {
        prefetch.reset();
        cancelAnchors();
        deferredLatest.clear();
      }
      sync.setConnected(value);
    },
    setActive(value) {
      active = value;
      if (!value) {
        prefetch.reset();
        cancelAnchors();
        deferredLatest.clear();
      }
      retention.setVisible(value ? [...visibleSources.values()].flat() : []);
      sync.setActive(value);
    },
    replaceVisibleAgentIds(sourceId, agentIds) {
      prefetch.reset();
      if (agentIds.length) visibleSources.set(sourceId, agentIds);
      else visibleSources.delete(sourceId);
      for (const id of deferredLatest.keys()) if (!visible(id)) deferredLatest.delete(id);
      for (const [id, request] of anchorRequests)
        if (!visible(id)) {
          request.controller.abort();
          anchorRequests.delete(id);
        }
      retention.setVisible(active ? [...visibleSources.values()].flat() : []);
      sync.replaceVisibleAgentIds(sourceId, agentIds);
    },
    enqueueStreamEvent(agentId, event) {
      prefetch.cursorChanged(agentId);
      // Legacy hosts may broadcast every agent. Hidden durable rows are read on demand;
      // dropping these payloads must not advance the retained authoritative cursor.
      if (!visible(agentId)) {
        acknowledgeHiddenSubmission(input.serverId, agentId, event);
        return;
      }
      const session = useSessionStore.getState().sessions[input.serverId];
      const retained = [
        ...(session?.agentStreamTail.get(agentId) ?? []),
        ...(session?.agentStreamHead.get(agentId) ?? []),
      ];
      if (
        event.event.type === "timeline" &&
        event.epoch &&
        event.seq !== undefined &&
        retained.some(
          (item) => item.timelineCursor?.deferredPayload || item.timelineCursor?.sourceSeqRangesRef,
        )
      ) {
        acknowledgeHiddenSubmission(input.serverId, agentId, event);
        const previous = deferredLatest.get(agentId);
        deferredLatest.set(agentId, {
          epoch: event.epoch,
          seq: previous?.epoch === event.epoch ? Math.max(previous.seq, event.seq) : event.seq,
        });
        if (!previous) {
          const cursor = session?.agentTimelineCursor.get(agentId);
          if (cursor) sync.recoverGap(agentId, cursor);
        }
        return;
      }
      if (!retention.reserveEvent(agentId, event)) {
        streamQueue.flushAgent(agentId);
        if (!retention.reserveEvent(agentId, event)) {
          acknowledgeHiddenSubmission(input.serverId, agentId, event);
          const cursor = input.ports.readCursor(agentId);
          if (cursor) sync.recoverGap(agentId, cursor);
          input.ports.reportError(
            new Error("Live history event exceeds the available memory budget"),
          );
          return;
        }
      }
      streamQueue.enqueue(agentId, event);
    },
    flushStreamAgent(agentId) {
      streamQueue.flushAgent(agentId);
    },
    dispose() {
      unsubscribeBudget();
      cancelAnchors();
      prefetch.reset();
      for (const cancel of scheduledReprojections.values()) cancel();
      scheduledReprojections.clear();
      visibleSources.clear();
      deferredLatest.clear();
      streamQueue.dispose({ flush: true });
      retention.dispose();
      sync.dispose();
    },
  };
}

const RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
const VIEWED_TIMELINE_HOT_AGENT_LIMIT = 5;

type CatchUpStatus = "running" | "complete" | "error";

interface CatchUpState {
  generation: number;
  status: CatchUpStatus;
  request?: ProjectedTimelineForwardFetchPlan;
  cancelRetry?: () => void;
  retryDelayMs?: number;
}

const getNextRetryDelayMs = (previousDelayMs: number | undefined): number => {
  if (previousDelayMs == null) {
    return RETRY_DELAY_MS;
  }
  return Math.min(previousDelayMs * 2, MAX_RETRY_DELAY_MS);
};

function isSameCatchUpRequest(
  left: ProjectedTimelineForwardFetchPlan | undefined,
  right: ProjectedTimelineForwardFetchPlan | undefined,
): boolean {
  if (!left || !right || left.direction !== right.direction) return false;
  if (left.direction !== "after" || right.direction !== "after") return true;
  return left.cursor.epoch === right.cursor.epoch && left.cursor.seq === right.cursor.seq;
}

type CatchUpDecision = "keep" | "keep-and-park" | "replace";

function decideCatchUp(input: {
  current: CatchUpState | undefined;
  request: ProjectedTimelineForwardFetchPlan;
  supersede: boolean;
}): CatchUpDecision {
  if (!input.current) return "replace";
  if (input.supersede) {
    if (
      input.current.status === "running" &&
      isSameCatchUpRequest(input.current.request, input.request)
    ) {
      return "keep";
    }
    if (input.current.status === "running" && input.current.request?.direction === "tail") {
      return "keep-and-park";
    }
    return "replace";
  }
  return input.current.status === "running" || input.current.status === "complete"
    ? "keep"
    : "replace";
}

function normalizeAgentIds(agentIds: string[]): string[] {
  return [...new Set(agentIds)].filter(Boolean).sort();
}

function sameAgentIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((agentId, index) => agentId === right[index]);
}

export function createViewedTimelineSync(ports: ViewedTimelineSyncPorts): ViewedTimelineSync {
  const sources = new Map<string, string[]>();
  const catchUps = new Map<string, CatchUpState>();
  const catchUpGenerations = new Map<string, number>();
  // Authoritative fetch owed but not runnable yet: disconnected, unacknowledged, or parked.
  // Acknowledgement and tail completion are the only drain points.
  const pendingCatchUps = new Map<string, ProjectedTimelineForwardFetchPlan>();
  const visibilityCatchUpPending = new Set<string>();
  const visibilityCatchUpErrors = new Map<string, string>();
  // User-initiated retries only. Background retries stay silent; a retry the user asked for
  // owes them a pending state until it settles.
  const manualRetries = new Set<string>();
  const loadedCache = new Set<string>();
  const cacheLoads = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  let active = true;
  let connected = false;
  let deliveryMode = ports.initialDeliveryMode;
  let disposed = false;
  let desired: string[] = [];
  let acknowledged: string[] = [];
  let membershipGeneration = 0;
  let reconciling = false;
  let reconcileRequested = false;
  let membershipNeedsRetry = false;
  let membershipRetryDelayMs: number | undefined;
  let cancelMembershipRetry: (() => void) | null = null;
  let recentlyViewedAgentIds: string[] = [];

  const visibleAgentIds = () => normalizeAgentIds([...sources.values()].flat());

  const selectHotAgentIds = (visible: string[]) => {
    const visibleSet = new Set(visible);
    recentlyViewedAgentIds = [
      ...visible,
      ...recentlyViewedAgentIds.filter((agentId) => !visibleSet.has(agentId)),
    ];
    const hiddenBudget = Math.max(0, VIEWED_TIMELINE_HOT_AGENT_LIMIT - visible.length);
    const desiredAgentIds = normalizeAgentIds([
      ...visible,
      ...recentlyViewedAgentIds
        .filter((agentId) => !visibleSet.has(agentId))
        .slice(0, hiddenBudget),
    ]);
    const desiredSet = new Set(desiredAgentIds);
    recentlyViewedAgentIds = recentlyViewedAgentIds.filter((agentId) => desiredSet.has(agentId));
    return desiredAgentIds;
  };

  const isAcknowledged = (agentId: string) => acknowledged.includes(agentId);
  const isDesired = (agentId: string) => desired.includes(agentId);
  const ownsCatchUp = (agentId: string, generation: number) =>
    !disposed &&
    connected &&
    isDesired(agentId) &&
    isAcknowledged(agentId) &&
    catchUps.get(agentId)?.generation === generation;

  const notifyListeners = () => {
    for (const listener of listeners) listener();
  };

  const setVisibilityCatchUpReady = (agentId: string) => {
    const wasPending = visibilityCatchUpPending.delete(agentId);
    const hadError = visibilityCatchUpErrors.delete(agentId);
    const wasRetrying = manualRetries.delete(agentId);
    if (wasPending || hadError || wasRetrying) notifyListeners();
  };

  const setVisibilityCatchUpError = (agentIds: string[], error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    let changed = false;
    for (const agentId of agentIds) {
      if (manualRetries.delete(agentId)) changed = true;
      if (visibilityCatchUpPending.delete(agentId)) changed = true;
      if (visibilityCatchUpErrors.get(agentId) !== message) {
        visibilityCatchUpErrors.set(agentId, message);
        changed = true;
      }
    }
    if (changed) notifyListeners();
  };

  const cancelCatchUp = (agentId: string) => {
    catchUpGenerations.set(agentId, (catchUpGenerations.get(agentId) ?? 0) + 1);
    catchUps.get(agentId)?.cancelRetry?.();
    catchUps.delete(agentId);
    pendingCatchUps.delete(agentId);
  };

  const fetchUntilCurrent = async (
    agentId: string,
    generation: number,
    request: ProjectedTimelineForwardFetchPlan,
    fallbackToLatestTailOnOverflow: boolean,
  ): Promise<void> => {
    if (!ownsCatchUp(agentId, generation)) return;

    try {
      const page = await ports.fetchPage(agentId, request);
      if (!ownsCatchUp(agentId, generation)) return;
      const observed = ports.readLatestObserved?.(agentId);
      const hasNewer =
        page.hasNewer ||
        Boolean(
          observed &&
          page.endCursor &&
          (observed.epoch !== page.endCursor.epoch || observed.seq > page.endCursor.seq),
        );
      if (hasNewer && page.endCursor) {
        if (fallbackToLatestTailOnOverflow) {
          await ports.fetchLatestTail(agentId);
          catchUps.set(agentId, { generation, status: "complete" });
          setVisibilityCatchUpReady(agentId);
          return;
        }
        await fetchUntilCurrent(
          agentId,
          generation,
          planTimelineCatchUpAfter(page.endCursor),
          false,
        );
        return;
      }
      if (hasNewer) {
        throw new Error(`Timeline page for ${agentId} hasNewer without an end cursor`);
      }
      catchUps.set(agentId, { generation, status: "complete" });
      const pendingCatchUp = pendingCatchUps.get(agentId);
      if (pendingCatchUp) {
        startCatchUp(agentId, { request: pendingCatchUp, supersede: true });
        return;
      }
      setVisibilityCatchUpReady(agentId);
    } catch (error) {
      if (catchUps.get(agentId)?.generation === generation) {
        const nextRetryDelayMs = getNextRetryDelayMs(catchUps.get(agentId)?.retryDelayMs);
        const cancelRetry = ports.schedule(() => {
          const current = catchUps.get(agentId);
          if (current?.generation !== generation || current.status !== "error") return;
          startCatchUp(agentId);
        }, nextRetryDelayMs);
        catchUps.set(agentId, {
          generation,
          status: "error",
          request,
          cancelRetry,
          retryDelayMs: nextRetryDelayMs,
        });
        setVisibilityCatchUpError([agentId], error);
        ports.reportError(error);
      }
    }
  };

  const ensureCacheLoaded = (agentId: string): void => {
    if (loadedCache.has(agentId) || cacheLoads.has(agentId)) return;
    const load = ports
      .prepare(agentId)
      .catch((error) => ports.reportError(error))
      .finally(() => {
        cacheLoads.delete(agentId);
        loadedCache.add(agentId);
        const pending = pendingCatchUps.get(agentId);
        startCatchUp(agentId, { request: pending, supersede: Boolean(pending) });
      });
    cacheLoads.set(agentId, load);
  };

  const startCatchUp = (
    agentId: string,
    options: {
      request?: ProjectedTimelineForwardFetchPlan;
      supersede?: boolean;
    } = {},
  ) => {
    const { request, supersede = false } = options;
    if (!connected || !isDesired(agentId) || !isAcknowledged(agentId)) {
      if (request) pendingCatchUps.set(agentId, request);
      return;
    }
    if (!loadedCache.has(agentId)) {
      if (request) pendingCatchUps.set(agentId, request);
      ensureCacheLoaded(agentId);
      return;
    }
    const nextRequest = request ?? planTimelineResumeFetch(ports.readCursor(agentId));
    const current = catchUps.get(agentId);
    const decision = decideCatchUp({ current, request: nextRequest, supersede });
    if (decision === "keep-and-park") {
      pendingCatchUps.set(agentId, nextRequest);
      return;
    }
    if (decision === "keep") {
      return;
    }
    current?.cancelRetry?.();
    const generation = (catchUpGenerations.get(agentId) ?? 0) + 1;
    catchUpGenerations.set(agentId, generation);
    const retryDelayMs =
      supersede || current?.status !== "error" ? undefined : current.retryDelayMs;
    catchUps.set(agentId, {
      generation,
      status: "running",
      request: nextRequest,
      retryDelayMs,
    });
    pendingCatchUps.delete(agentId);
    void fetchUntilCurrent(
      agentId,
      generation,
      nextRequest,
      request === undefined && nextRequest.direction === "after",
    );
  };

  const startAcknowledgedCatchUps = () => {
    for (const agentId of acknowledged) {
      const pendingCatchUp = pendingCatchUps.get(agentId);
      startCatchUp(agentId, {
        request: pendingCatchUp,
        supersede: Boolean(pendingCatchUp),
      });
    }
  };

  const reconcileLatestMembership = async (): Promise<void> => {
    if (disposed || !connected || deliveryMode !== "selective") return;
    const generation = membershipGeneration;
    const requested = desired;
    if (!membershipNeedsRetry && sameAgentIds(requested, acknowledged)) return;
    membershipNeedsRetry = false;
    try {
      await ports.setSubscription(requested);
    } catch (error) {
      membershipNeedsRetry = true;
      setVisibilityCatchUpError(requested, error);
      cancelMembershipRetry?.();
      const nextRetryDelayMs = getNextRetryDelayMs(membershipRetryDelayMs);
      cancelMembershipRetry = ports.schedule(() => {
        cancelMembershipRetry = null;
        if (
          disposed ||
          !connected ||
          membershipGeneration !== generation ||
          !sameAgentIds(desired, requested)
        ) {
          return;
        }
        void reconcileMembership();
      }, nextRetryDelayMs);
      membershipRetryDelayMs = nextRetryDelayMs;
      ports.reportError(error);
      return;
    }
    cancelMembershipRetry?.();
    cancelMembershipRetry = null;
    membershipRetryDelayMs = undefined;
    if (disposed || !connected || deliveryMode !== "selective") return;
    acknowledged = requested;
    if (generation !== membershipGeneration) {
      await reconcileLatestMembership();
      return;
    }
    startAcknowledgedCatchUps();
    if (!sameAgentIds(desired, acknowledged)) await reconcileLatestMembership();
  };

  const reconcileMembership = async () => {
    if (reconciling) {
      reconcileRequested = true;
      return;
    }
    if (disposed || !connected) return;
    reconciling = true;
    try {
      await reconcileLatestMembership();
    } finally {
      reconciling = false;
      if (reconcileRequested && !disposed && connected && deliveryMode === "selective") {
        reconcileRequested = false;
        void reconcileMembership();
      } else if (
        !disposed &&
        connected &&
        deliveryMode === "selective" &&
        !membershipNeedsRetry &&
        !sameAgentIds(desired, acknowledged)
      ) {
        void reconcileMembership();
      }
    }
  };

  const retryVisibleAgentTimeline = (agentId: string) => {
    if (!isDesired(agentId) || manualRetries.has(agentId)) return;
    const catchUp = catchUps.get(agentId);
    const membershipRetryable = deliveryMode === "selective" && membershipNeedsRetry && connected;
    if (catchUp?.status !== "error" && !membershipRetryable) return;
    manualRetries.add(agentId);
    notifyListeners();
    if (catchUp?.status === "error") {
      catchUp.cancelRetry?.();
      startCatchUp(agentId, { request: catchUp.request, supersede: true });
      return;
    }
    cancelMembershipRetry?.();
    cancelMembershipRetry = null;
    membershipRetryDelayMs = undefined;
    membershipNeedsRetry = false;
    void reconcileMembership();
  };

  const commitDesiredMembership = (
    nextDesired: string[],
    options: { resetCatchUpStatus?: boolean } = {},
  ) => {
    let statusChanged = false;
    if (options.resetCatchUpStatus) {
      for (const agentId of nextDesired) {
        if (!visibilityCatchUpPending.has(agentId)) {
          visibilityCatchUpPending.add(agentId);
          statusChanged = true;
        }
        if (visibilityCatchUpErrors.delete(agentId)) statusChanged = true;
        if (manualRetries.delete(agentId)) statusChanged = true;
      }
    }
    if (sameAgentIds(nextDesired, desired)) {
      if (statusChanged) notifyListeners();
      return;
    }

    for (const agentId of desired) {
      if (!nextDesired.includes(agentId)) {
        cancelCatchUp(agentId);
        visibilityCatchUpPending.delete(agentId);
        visibilityCatchUpErrors.delete(agentId);
        manualRetries.delete(agentId);
      }
    }
    for (const agentId of nextDesired) {
      if (!desired.includes(agentId)) {
        visibilityCatchUpPending.add(agentId);
        visibilityCatchUpErrors.delete(agentId);
        manualRetries.delete(agentId);
        ensureCacheLoaded(agentId);
      }
    }
    cancelMembershipRetry?.();
    cancelMembershipRetry = null;
    desired = nextDesired;
    ports.replaceDemandedAgentIds(desired);
    membershipGeneration += 1;
    notifyListeners();
    if (deliveryMode === "legacy") {
      acknowledged = connected ? desired : [];
      if (connected) startAcknowledgedCatchUps();
      return;
    }
    void reconcileMembership();
  };

  const publishVisibleMembership = () => {
    const visible = visibleAgentIds();
    if (!connected || deliveryMode !== "selective") {
      const activeVisible = active ? visible : [];
      recentlyViewedAgentIds = activeVisible;
      commitDesiredMembership(activeVisible);
      return;
    }
    if (!active) return;
    commitDesiredMembership(selectHotAgentIds(visible));
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getAgentTimelineStatus(agentId) {
      if (manualRetries.has(agentId)) return "retrying";
      if (visibilityCatchUpErrors.has(agentId)) return "error";
      if (!isDesired(agentId) || visibilityCatchUpPending.has(agentId)) return "pending";
      return "ready";
    },
    getAgentTimelineError(agentId) {
      return visibilityCatchUpErrors.get(agentId) ?? null;
    },
    replaceVisibleAgentIds(sourceId, agentIds) {
      const normalized = normalizeAgentIds(agentIds);
      if (normalized.length === 0) sources.delete(sourceId);
      else sources.set(sourceId, normalized);
      publishVisibleMembership();
    },
    setActive(nextActive) {
      if (active === nextActive) return;
      active = nextActive;
      publishVisibleMembership();
    },
    setConnected(nextConnected) {
      if (connected === nextConnected) return;
      connected = nextConnected;
      if (!connected) {
        const visible = active ? visibleAgentIds() : [];
        recentlyViewedAgentIds = visible;
        commitDesiredMembership(visible, { resetCatchUpStatus: true });
        cancelMembershipRetry?.();
        cancelMembershipRetry = null;
        membershipRetryDelayMs = undefined;
        acknowledged = [];
        membershipGeneration += 1;
        for (const agentId of desired) cancelCatchUp(agentId);
        return;
      }
      membershipGeneration += 1;
      if (deliveryMode === "legacy") {
        acknowledged = desired;
        startAcknowledgedCatchUps();
      } else {
        void reconcileMembership();
      }
    },
    setDeliveryMode(nextMode) {
      if (deliveryMode === nextMode) return;
      deliveryMode = nextMode;
      cancelMembershipRetry?.();
      cancelMembershipRetry = null;
      membershipRetryDelayMs = undefined;
      membershipNeedsRetry = false;
      membershipGeneration += 1;
      for (const agentId of desired) cancelCatchUp(agentId);
      const visible = active ? visibleAgentIds() : [];
      recentlyViewedAgentIds = visible;
      desired = visible;
      ports.replaceDemandedAgentIds(desired);
      visibilityCatchUpPending.clear();
      visibilityCatchUpErrors.clear();
      manualRetries.clear();
      for (const agentId of desired) visibilityCatchUpPending.add(agentId);
      acknowledged = deliveryMode === "legacy" && connected ? desired : [];
      notifyListeners();
      if (deliveryMode === "selective" && connected) void reconcileMembership();
      else if (connected) startAcknowledgedCatchUps();
    },
    recoverGap(agentId, cursor) {
      if (!isDesired(agentId)) return;
      startCatchUp(agentId, {
        request: planTimelineCatchUpAfter({ epoch: cursor.epoch, seq: cursor.endSeq }),
        supersede: true,
      });
    },
    dispose() {
      disposed = true;
      cancelMembershipRetry?.();
      cancelMembershipRetry = null;
      membershipNeedsRetry = false;
      membershipRetryDelayMs = undefined;
      sources.clear();
      membershipGeneration += 1;
      for (const agentId of desired) cancelCatchUp(agentId);
      desired = [];
      ports.replaceDemandedAgentIds([]);
      acknowledged = [];
      recentlyViewedAgentIds = [];
      loadedCache.clear();
      cacheLoads.clear();
      visibilityCatchUpPending.clear();
      visibilityCatchUpErrors.clear();
      manualRetries.clear();
      notifyListeners();
      listeners.clear();
    },
    retryVisibleAgentTimeline,
    reprojectVisibleTimelines() {
      if (!active || !connected) return;
      for (const agentId of visibleAgentIds()) {
        void ports.fetchLatestTail(agentId).catch(ports.reportError);
      }
    },
  };
}
