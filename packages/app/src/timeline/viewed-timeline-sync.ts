import { traceTimelinePhase } from "@/performance/timeline-trace";
import {
  TimelineDirectionalPrefetch,
  type AdjacentTimelineRequest,
} from "./timeline-directional-prefetch";
import type { TimelinePageRetention } from "./timeline-page-retention";
import { TimelineRetentionOwner } from "./timeline-retention-owner";
import {
  planTimelineCatchUpAfter,
  planTimelineCatchUpPastApplied,
  planTimelineResumeFetch,
  type ProjectedTimelineForwardFetchPlan,
} from "./timeline-sync-plan";
import type { CachedTimeline } from "@/runtime/replica-cache";
import {
  selectAgentTimelineState,
  selectAgentUnsettledTurn,
  useSessionStore,
  type AgentTimelineCursorState,
  type AgentTimelineState,
  type SessionState,
} from "@/stores/session-store";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import type { AgentSnapshotPayload, SessionOutboundMessage } from "@clisbot/protocol/messages";
import { getSendingClientMessageIds } from "@/composer/submission/model";
import {
  getInitDeferred,
  getInitKey,
  rejectInitDeferred,
  resolveInitDeferred,
} from "@/utils/agent-initialization";
import {
  createSessionAgentStreamReducerQueue,
  deriveAgentStreamTurnLiveness,
  type AgentStreamReducerEvent,
  type ProcessTimelineResponseOutput,
  processTimelineResponse,
} from "./session-stream-reducers";
import { isTimelineResumeSnapshotAuthoritative } from "./timeline-sync-plan";
import { replaceWithCanonicalStream } from "@/types/stream";
import type { TurnLivenessTransition } from "./turn-liveness";

export interface TimelineReplicaStorage {
  readTimeline(serverId: string, agentId: string): Promise<CachedTimeline | undefined>;
  commitTimeline(serverId: string, agentId: string, timeline: CachedTimeline): void;
}

function hasChangedTimelineCoverage(
  before: SessionState | undefined,
  current: SessionState | undefined,
  agentId: string,
): boolean {
  // Reference changes conservatively reject stale hydration, including equivalent
  // replacements and removal by retention. Live overlays without coverage still merge.
  return current?.agentTimelineCursor.get(agentId) !== before?.agentTimelineCursor.get(agentId);
}

/** The rows on screen now: the painted timeline, if any, followed by the live head. */
function liveTimelineItems(
  timeline: ReturnType<typeof selectAgentTimelineState>,
  head: ReturnType<SessionState["agentStreamHead"]["get"]>,
) {
  return timeline.status === "painted" ? [...timeline.items, ...(head ?? [])] : (head ?? []);
}

async function prepareCachedTimeline(input: {
  serverId: string;
  agentId: string;
  storage: TimelineReplicaStorage;
  prepareAgent: (agentId: string) => Promise<void>;
  isTurnSettled: () => boolean;
}): Promise<CachedTimeline | undefined> {
  const before = useSessionStore.getState().sessions[input.serverId];
  const beforeTimeline = selectAgentTimelineState(before, input.agentId);
  if (beforeTimeline.status === "synced") return undefined;
  traceTimelinePhase("prepare.read", input.serverId, input.agentId);
  const [stored] = await Promise.all([
    input.storage.readTimeline(input.serverId, input.agentId),
    input.prepareAgent(input.agentId),
  ]);
  traceTimelinePhase("prepare.readDone", input.serverId, input.agentId);
  if (!stored) return undefined;
  const session = useSessionStore.getState().sessions[input.serverId];
  const currentTimeline = selectAgentTimelineState(session, input.agentId);
  const currentHead = session?.agentStreamHead.get(input.agentId);
  if (currentTimeline.status === "synced") return undefined;
  // An authoritative partial/reset page can advance coverage without being fully synced.
  // Retention can also remove coverage. Neither transition may be undone by an older read.
  if (hasChangedTimelineCoverage(before, session, input.agentId)) return undefined;
  if (!stored.range) {
    if (beforeTimeline.status === "painted") {
      return currentTimeline.status === "painted" && currentTimeline.items === beforeTimeline.items
        ? stored
        : undefined;
    }
    if (currentTimeline.status !== "cold") return undefined;
  }
  const liveItems = liveTimelineItems(currentTimeline, currentHead);
  traceTimelinePhase("prepare.merge", input.serverId, input.agentId);
  const replacement = replaceWithCanonicalStream({
    canonical: stored.items,
    previousTail: [],
    previousHead: liveItems,
    sendingClientMessageIds: getSendingClientMessageIds(
      session?.messageSubmissions.get(input.agentId),
    ),
    preserveContinuity: true,
    // Display-only rows claim no coverage over the live head.
    canonicalCoverage: stored.range ?? {
      epoch: liveItems.find((item) => item.timelineCursor)?.timelineCursor?.epoch ?? "",
      endSeq: null,
    },
  });
  traceTimelinePhase("prepare.publish", input.serverId, input.agentId);
  useSessionStore.getState().applyAgentTimelineResponseState(input.serverId, input.agentId, {
    items: replacement.tail,
    head: replacement.head,
    range: stored.range,
    older: stored.hasOlder ? "available" : "none",
    newer: false,
    synchronized: false,
    acknowledgedClientMessageIds: replacement.acknowledgedClientMessageIds,
    unsettledTurn: input.isTurnSettled() ? undefined : stored.unsettledTurn,
  });
  traceTimelinePhase("prepare.published", input.serverId, input.agentId);
  return stored;
}

export interface TimelineReplica {
  prepare(agentId: string): Promise<void>;
  readCursor(agentId: string): { epoch: string; endSeq: number } | undefined;
  readRange(agentId: string): AgentTimelineCursorState | undefined;
  timelineUpdated(agentId: string): void;
  catchUpOwed(agentId: string): void;
  catchUpSettled(agentId: string): void;
}

class TimelineReplicaOwner implements TimelineReplica {
  private readonly cachedRanges = new Map<string, AgentTimelineCursorState>();
  private readonly preparations = new Map<string, Promise<void>>();
  // A cache read in flight still carries the turn as it was saved. Once the catch-up has
  // settled, that turn must not come back with the cached messages.
  private readonly settledDuringPreparation = new Set<string>();

  constructor(
    private readonly serverId: string,
    private readonly storage: TimelineReplicaStorage,
    private readonly prepareAgent: (agentId: string) => Promise<void>,
  ) {}

  async prepare(agentId: string): Promise<void> {
    const existing = this.preparations.get(agentId);
    if (existing) return existing;
    const timeline = selectAgentTimelineState(
      useSessionStore.getState().sessions[this.serverId],
      agentId,
    );
    // A route and the visible-chat owner can both prepare before catch-up finishes.
    // Repainting that same cache would treat its history as a live head.
    if (timeline.status !== "cold" && this.cachedRanges.has(agentId)) {
      return;
    }
    traceTimelinePhase("prepare.begin", this.serverId, agentId);
    const preparation = this.load(agentId).finally(() => {
      traceTimelinePhase("prepare.end", this.serverId, agentId);
      if (this.preparations.get(agentId) === preparation) {
        this.preparations.delete(agentId);
        this.settledDuringPreparation.delete(agentId);
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
      isTurnSettled: () => this.settledDuringPreparation.has(agentId),
    });
    if (!stored) return;
    if (stored.range) {
      this.cachedRanges.set(agentId, stored.range);
    }
  }

  readCursor(agentId: string): { epoch: string; endSeq: number } | undefined {
    const range = this.validRange(agentId);
    return range ? { epoch: range.epoch, endSeq: range.endSeq } : undefined;
  }

  readRange(agentId: string): AgentTimelineCursorState | undefined {
    return this.validRange(agentId);
  }

  /**
   * A cached range outlives the rows it describes once retention evicts a page, so it is only
   * usable while it still agrees with the cursor the session store retains.
   */
  private validRange(agentId: string): AgentTimelineCursorState | undefined {
    const cached = this.cachedRanges.get(agentId);
    const retained = useSessionStore
      .getState()
      .sessions[this.serverId]?.agentTimelineCursor.get(agentId);
    if (
      !cached ||
      !retained ||
      cached.epoch !== retained.epoch ||
      cached.endSeq > retained.endSeq
    ) {
      this.cachedRanges.delete(agentId);
      return undefined;
    }
    return cached;
  }

  timelineUpdated(agentId: string): void {
    const session = useSessionStore.getState().sessions[this.serverId];
    const timeline = selectAgentTimelineState(session, agentId);
    if (timeline.status === "cold") return;
    if (timeline.status === "synced") this.cachedRanges.delete(agentId);
    this.storage.commitTimeline(this.serverId, agentId, {
      agentId,
      items: [...timeline.items, ...(session?.agentStreamHead.get(agentId) ?? [])],
      range: timeline.status === "synced" ? timeline.range : null,
      hasOlder: timeline.status === "synced" && timeline.older === "available",
      unsettledTurn: selectAgentUnsettledTurn(session, agentId),
    });
  }

  catchUpOwed(agentId: string): void {
    this.settledDuringPreparation.delete(agentId);
    const store = useSessionStore.getState();
    const openTurn = selectAgentUnsettledTurn(store.sessions[this.serverId], agentId);
    if (openTurn) store.setAgentTimelineUnsettledTurn(this.serverId, agentId, openTurn);
  }

  catchUpSettled(agentId: string): void {
    if (this.preparations.has(agentId)) this.settledDuringPreparation.add(agentId);
    useSessionStore.getState().setAgentTimelineUnsettledTurn(this.serverId, agentId, null);
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

export function consumeForcedTimelineTailReplacement(
  payload: TimelineResponsePayload,
  replacements: Set<string>,
): TimelineResponsePayload {
  if (payload.direction !== "tail") return payload;
  if (!replacements.delete(payload.agentId)) return payload;
  return { ...payload, reset: true };
}

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
  if (synchronized) store.setAgentTimelineUnsettledTurn(serverId, agentId, null);
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
    const session = useSessionStore.getState().sessions[input.serverId];
    const agent = session?.agents.get(input.agentId) ?? session?.agentDetails.get(input.agentId);
    if (agent && agent.turn.phase === "idle") input.drainQueuedAgentMessage(input.agentId);
  }
  if (input.result.initResolution === "resolve") resolveInitDeferred(input.initKey);
}

function applyAuthoritativeTimelineResponse(input: {
  serverId: string;
  payload: TimelineResponsePayload;
  cachedCursor?: AgentTimelineCursorState;
  recoverGap: (agentId: string, cursor: { epoch: string; endSeq: number }) => void;
  drainQueuedAgentMessage: (agentId: string) => void;
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
  const currentCursor =
    timeline.status === "synced" ? (timeline.range ?? undefined) : input.cachedCursor;
  let result = processTimelineResponse({
    payload,
    currentTail: timeline.status === "cold" ? [] : timeline.items,
    currentHead: session?.agentStreamHead.get(agentId) ?? [],
    currentCursor,
    isInitializing: session?.initializingAgents.get(agentId) === true,
    hasActiveInitDeferred: Boolean(activeInitDeferred),
    initRequestDirection: activeInitDeferred?.requestDirection ?? "tail",
    sendingClientMessageIds: getSendingClientMessageIds(session?.messageSubmissions.get(agentId)),
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

/**
 * Measured on a dev daemon: set_subscription answers in a mean of 1.4 ms, p99 per-window max
 * 107 ms, max 227 ms. A check slower than this is slow enough to say so on screen.
 */
export const FRESHNESS_CHECK_QUIET_MS = 500;

export type TimelineFreshness = "current" | "behind";

/** The empty after page the daemon would have returned for a cursor already at the head. */
function buildCurrentTimelinePage(
  agentId: string,
  cursor: { epoch: string; endSeq: number },
): TimelineResponsePayload {
  return {
    requestId: "",
    agentId,
    agent: null,
    direction: "after",
    projection: "projected",
    epoch: cursor.epoch,
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 0, maxSeq: cursor.endSeq, nextSeq: cursor.endSeq + 1 },
    startCursor: null,
    endCursor: null,
    hasOlder: false,
    hasNewer: false,
    entries: [],
    error: null,
  };
}

export interface ViewedTimelineSyncPorts {
  prepare(agentId: string): Promise<void>;
  replaceDemandedAgentIds(agentIds: string[]): void;
  /** Whether the daemon answers with each cursor's freshness in the subscribe response. */
  canCheckFreshness(): boolean;
  observe(
    agentIds: string[],
    cursors?: Record<string, { epoch: string; seq: number }>,
  ): {
    ready: Promise<{
      timelines?: Record<string, TimelineFreshness>;
      agents?: Record<string, AgentSnapshotPayload>;
    } | void>;
    release(): Promise<void>;
  };
  /** The daemon confirmed the cached timeline is at its head, as a zero-row after page would. */
  applyCurrentTimeline(agentId: string): void;
  readCursor(agentId: string): { epoch: string; endSeq: number } | undefined;
  readLatestObserved?(agentId: string): { epoch: string; seq: number } | undefined;
  fetchPage(
    agentId: string,
    request: ProjectedTimelineForwardFetchPlan,
  ): Promise<TimelinePageResult>;
  fetchLatestTail(agentId: string): Promise<TimelinePageResult>;
  /**
   * The sync no longer owes this chat a catch-up: it reached current, or it left the
   * demanded set. Disconnect and backgrounding keep the obligation and do not report here.
   */
  onCatchUpEnded(agentId: string): void;
  /** The chat stopped receiving every row, so a catch-up is owed before it is current again. */
  onCatchUpOwed(agentId: string): void;
  /** The owed catch-up reached current or failed. The chat can take the true turn status. */
  onCatchUpSettled(agentId: string): void;
  reportError(error: unknown): void;
}

/**
 * Why a freshness check was asked: opening a chat, the socket coming back, or the app
 * returning to the foreground on a socket that stayed connected.
 */
type FreshnessCheckReason = "open" | "reconnect" | "resume";

/**
 * "checking": the daemon has not said whether this chat is current; nothing to report yet.
 * "reattaching": the same question right after a reconnect, so the chat is still not back.
 */
export type ViewedTimelineStatus =
  | "ready"
  | "checking"
  | "reattaching"
  | "pending"
  | "error"
  | "retrying";

export interface ViewedTimelineUiBridge {
  reportReadingPosition?(agentId: string, itemId: string | null): void;
  restoreReadingAnchor?(agentId: string, cursor: { epoch: string; seq: number }): Promise<void>;
  replaceVisibleAgentIds(sourceId: string, agentIds: string[]): void;
  subscribe(listener: () => void): () => void;
  getAgentTimelineStatus(agentId: string): ViewedTimelineStatus;
  getAgentTimelineError(agentId: string): string | null;
  retryVisibleAgentTimeline(agentId: string): void;
}

export interface ViewedTimelineSync extends ViewedTimelineUiBridge {
  /**
   * The agent tabs that currently exist in workspace layout. This only ever *releases*
   * subscriptions: closing a tab drops its chat. It never adds one, because layout is
   * restored from disk at launch and those tabs are chats the user opened days ago.
   */
  replaceOpenTabAgentIds(agentIds: string[]): void;
  setActive(active: boolean): void;
  setConnected(connected: boolean): void;
  recoverGap(agentId: string, cursor: { epoch: string; endSeq: number }): void;
  /** Resume a desired agent whose live events were not applied, unless a catch-up is running. */
  catchUpOnReturn(agentId: string): void;
  dispose(): void;
}

export type ViewedTimelineOwnerPorts = Omit<
  ViewedTimelineSyncPorts,
  | "prepare"
  | "replaceDemandedAgentIds"
  | "onCatchUpEnded"
  | "onCatchUpOwed"
  | "onCatchUpSettled"
  | "applyCurrentTimeline"
> & {
  fetchAdjacentPage?(
    agentId: string,
    request: AdjacentTimelineRequest & { requestId: string; mergeWindow?: boolean },
  ): Promise<void>;
  initialDeliveryMode?: "legacy" | "selective";
};

export interface ViewedTimelineOwner extends ViewedTimelineSync {
  applyTimelineResponse(payload: TimelineResponsePayload): void;
  /**
   * Accepts one live stream event. Content is coalesced to the next frame; a turn boundary
   * commits the turn's queued content before its liveness changes, so the view never shows
   * a finished turn without its final reply.
   */
  applyStreamEvent(agentId: string, event: AgentStreamReducerEvent): void;
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
const PREFETCH_REQUEST_PREFIX = "clisbot-prefetch:";
const ANCHOR_REQUEST_PREFIX = "clisbot-anchor:";

export function createViewedTimelineOwner(input: {
  retentionBudget?: TimelinePageRetention;
  serverId: string;
  replica: TimelineReplica;
  replaceDemandedAgentIds: (agentIds: string[]) => void;
  drainQueuedAgentMessage: (agentId: string) => void;
  applyTurnLiveness: (agentId: string, transitions: readonly TurnLivenessTransition[]) => void;
  ports: ViewedTimelineOwnerPorts;
}): ViewedTimelineOwner {
  const forcedTailReplacements = new Set<string>();
  // Agents whose live events were dropped, or whose retained pages were released, while
  // hidden. Selective delivery keeps a hidden agent hot and skips catch-up on return, so
  // these must catch up when shown again.
  const droppedWhileHidden = new Set<string>();
  const retention = new TimelineRetentionOwner(input.serverId, input.retentionBudget, (agentId) =>
    droppedWhileHidden.add(agentId),
  );
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
  const catchUpDroppedVisibleAgents = () => {
    for (const agentId of droppedWhileHidden) {
      if (!visible(agentId)) continue;
      droppedWhileHidden.delete(agentId);
      sync.catchUpOnReturn(agentId);
    }
  };
  const sync = createViewedTimelineSync({
    ...input.ports,
    fetchLatestTail: async (agentId) => {
      forcedTailReplacements.add(agentId);
      try {
        return await input.ports.fetchLatestTail(agentId);
      } finally {
        forcedTailReplacements.delete(agentId);
      }
    },
    prepare: async (agentId) => {
      await input.replica.prepare(agentId);
      traceTimelinePhase("retention.begin", input.serverId, agentId);
      retention.prepare(agentId);
      traceTimelinePhase("retention.end", input.serverId, agentId);
    },
    readCursor: (agentId) => input.replica.readCursor(agentId) ?? input.ports.readCursor(agentId),
    readLatestObserved: (agentId) => deferredLatest.get(agentId),
    replaceDemandedAgentIds: input.replaceDemandedAgentIds,
    applyCurrentTimeline: (agentId) => {
      const cursor = input.replica.readCursor(agentId) ?? input.ports.readCursor(agentId);
      if (!cursor) return;
      const accepted = applyAuthoritativeTimelineResponse({
        serverId: input.serverId,
        payload: buildCurrentTimelinePage(agentId, cursor),
        cachedCursor: input.replica.readRange(agentId),
        recoverGap: (id, gapCursor) => sync.recoverGap(id, gapCursor),
        drainQueuedAgentMessage: input.drainQueuedAgentMessage,
      });
      if (accepted) input.replica.timelineUpdated(agentId);
    },
    onCatchUpEnded: (agentId) =>
      useCreateFlowStore.getState().clearByAgent({ serverId: input.serverId, agentId }),
    onCatchUpOwed: (agentId) => input.replica.catchUpOwed(agentId),
    onCatchUpSettled: (agentId) => input.replica.catchUpSettled(agentId),
  });
  const streamQueue = createSessionAgentStreamReducerQueue({
    serverId: input.serverId,
    setAgentStreamState: (...args) => useSessionStore.getState().setAgentStreamState(...args),
    setAgentTimelineCursor: (...args) => useSessionStore.getState().setAgentTimelineCursor(...args),
    recoverTimelineGap: (agentId, cursor) => sync.recoverGap(agentId, cursor),
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
    applyTimelineResponse(receivedPayload) {
      if (receivedPayload.requestId.startsWith(ANCHOR_REQUEST_PREFIX)) {
        const request = anchorRequests.get(receivedPayload.agentId);
        if (
          receivedPayload.requestId !== request?.requestId ||
          request.controller.signal.aborted ||
          !visible(receivedPayload.agentId)
        )
          return;
      }
      const speculative = receivedPayload.requestId.startsWith(PREFETCH_REQUEST_PREFIX);
      if (
        speculative &&
        (receivedPayload.requestId !== prefetchRequest?.requestId ||
          prefetchRequest.signal.aborted ||
          !visible(receivedPayload.agentId))
      )
        return;
      if (!speculative) prefetch.cursorChanged(receivedPayload.agentId);
      const payload = consumeForcedTimelineTailReplacement(receivedPayload, forcedTailReplacements);
      traceTimelinePhase("response.apply", input.serverId, payload.agentId);
      const accepted = applyAuthoritativeTimelineResponse({
        serverId: input.serverId,
        payload,
        cachedCursor: input.replica.readRange(payload.agentId),
        recoverGap: (agentId, cursor) => sync.recoverGap(agentId, cursor),
        drainQueuedAgentMessage: input.drainQueuedAgentMessage,
        admit: (page, result) => retention.admit(page, result),
      });
      traceTimelinePhase("response.applied", input.serverId, payload.agentId);
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
        droppedWhileHidden.clear();
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
      catchUpDroppedVisibleAgents();
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
      catchUpDroppedVisibleAgents();
    },
    applyStreamEvent(agentId, event) {
      prefetch.cursorChanged(agentId);
      // Legacy hosts may broadcast every agent. Hidden durable rows are read on demand;
      // dropping these payloads must not advance the retained authoritative cursor.
      if (!visible(agentId)) {
        acknowledgeHiddenSubmission(input.serverId, agentId, event);
        droppedWhileHidden.add(agentId);
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
      const turnLiveness = deriveAgentStreamTurnLiveness([event]);
      if (turnLiveness.length === 0) return;
      streamQueue.flushAgent(agentId);
      input.applyTurnLiveness(agentId, turnLiveness);
      input.replica.timelineUpdated(agentId);
    },
    flushStreamAgent(agentId) {
      streamQueue.flushAgent(agentId);
    },
    dispose() {
      unsubscribeBudget();
      cancelAnchors();
      prefetch.reset();
      visibleSources.clear();
      deferredLatest.clear();
      droppedWhileHidden.clear();
      streamQueue.dispose({ flush: true });
      retention.dispose();
      sync.dispose();
    },
  };
}

const MAX_HIDDEN_CATCH_UPS = 2;

type CatchUpStatus = "running" | "complete" | "error";

interface CatchUpRequest {
  page: ProjectedTimelineForwardFetchPlan;
  kind: "resume" | "gap";
}

interface CatchUpState {
  generation: number;
  status: CatchUpStatus;
  request?: CatchUpRequest;
}

function planCatchUpRequest(
  request: CatchUpRequest | undefined,
  applied: { epoch: string; endSeq: number } | undefined,
): CatchUpRequest {
  if (!request) return { page: planTimelineResumeFetch(applied), kind: "resume" };
  return { ...request, page: planTimelineCatchUpPastApplied(request.page, applied) };
}

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
      isSameCatchUpRequest(input.current.request?.page, input.request)
    ) {
      return "keep";
    }
    if (input.current.status === "running" && input.current.request?.page.direction === "tail") {
      return "keep-and-park";
    }
    return "replace";
  }
  return "keep";
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
  // Fetches can outlive their catch-up generation when superseded or when a tab closes.
  const inFlightCatchUps = new Set<{ agentId: string }>();
  // Authoritative fetch owed but not runnable yet: disconnected, unacknowledged, or queued.
  // Membership acknowledgement and catch-up completion drain parked requests.
  const pendingCatchUps = new Map<string, CatchUpRequest>();
  const visibilityCatchUpPending = new Set<string>();
  const visibilityCatchUpErrors = new Map<string, string>();
  // A user-initiated retry owes a pending state until it settles.
  const manualRetries = new Set<string>();
  const loadedCache = new Set<string>();
  const cacheLoads = new Map<string, Promise<void>>();
  // Chats whose freshness answer is outstanding. No catch-up starts for them until it arrives.
  // An "open" check stays `quiet`, short of "pending", until FRESHNESS_CHECK_QUIET_MS elapses.
  const freshnessChecks = new Map<
    string,
    {
      reason: FreshnessCheckReason;
      quiet: boolean;
      timer: ReturnType<typeof setTimeout> | null;
    }
  >();
  const listeners = new Set<() => void>();
  let active = true;
  let connected = false;
  let observation: {
    handle: ReturnType<ViewedTimelineSyncPorts["observe"]>;
    agentIds: string[];
  } | null = null;
  let disposed = false;
  let desired: string[] = [];
  let acknowledged: string[] = [];
  let membershipGeneration = 0;
  let membershipNeedsRetry = false;
  let freshnessCheckOwed = false;
  // Chats this session has opened. Visibility is the only way in, so an agent is never
  // subscribed — and never resumed on the daemon — until the user actually opens it.
  // Membership then survives hiding, workspace switches, backgrounding and reconnect;
  // only closing the tab or ending the session takes it out.
  let openedAgentIds: string[] = [];

  const visibleAgentIds = () => normalizeAgentIds([...sources.values()].flat());

  const rememberOpenedAgentIds = (agentIds: string[]) => {
    if (agentIds.length === 0) return;
    const next = normalizeAgentIds([...openedAgentIds, ...agentIds]);
    if (sameAgentIds(next, openedAgentIds)) return;
    openedAgentIds = next;
  };

  const isAcknowledged = (agentId: string) => acknowledged.includes(agentId);
  const isDesired = (agentId: string) => desired.includes(agentId);
  const canCatchUp = (agentId: string) =>
    !disposed && connected && isDesired(agentId) && isAcknowledged(agentId);
  const ownsCatchUp = (agentId: string, generation: number) =>
    canCatchUp(agentId) && catchUps.get(agentId)?.generation === generation;

  const notifyListeners = () => {
    for (const listener of listeners) listener();
  };

  const setVisibilityCatchUpReady = (agentId: string) => {
    const wasPending = visibilityCatchUpPending.delete(agentId);
    const hadError = visibilityCatchUpErrors.delete(agentId);
    const wasRetrying = manualRetries.delete(agentId);
    ports.onCatchUpSettled(agentId);
    ports.onCatchUpEnded(agentId);
    if (wasPending || hadError || wasRetrying) notifyListeners();
  };

  const setVisibilityCatchUpError = (agentIds: string[], error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    let changed = false;
    for (const agentId of agentIds) {
      ports.onCatchUpSettled(agentId);
      if (manualRetries.delete(agentId)) changed = true;
      if (visibilityCatchUpPending.delete(agentId)) changed = true;
      if (visibilityCatchUpErrors.get(agentId) !== message) {
        visibilityCatchUpErrors.set(agentId, message);
        changed = true;
      }
    }
    if (changed) notifyListeners();
  };

  const markCatchUpOwed = (agentId: string) => {
    visibilityCatchUpPending.add(agentId);
    ports.onCatchUpOwed(agentId);
  };

  const startFreshnessCheck = (agentId: string, reason: FreshnessCheckReason = "open") => {
    if (freshnessChecks.has(agentId)) return;
    freshnessChecks.set(agentId, { reason, quiet: true, timer: null });
  };

  // The delay measures the daemon's answer, so it starts when the question is sent. On a cold
  // start the cache read that precedes the question can outlast it on its own. Only opening a
  // chat escalates. A reconnect already shows Reconnecting until the answer. A resume
  // kept its socket subscribed, so a slow answer is no reason to doubt the chat; a socket that
  // died quietly is caught by the foreground liveness probe and becomes a reconnect.
  const startFreshnessCheckDelay = (agentId: string) => {
    const check = freshnessChecks.get(agentId);
    if (!check || check.timer || check.reason !== "open") return;
    check.timer = setTimeout(() => {
      check.quiet = false;
      notifyListeners();
    }, FRESHNESS_CHECK_QUIET_MS);
  };

  const endFreshnessCheck = (agentId: string) => {
    const check = freshnessChecks.get(agentId);
    if (!check) return;
    if (check.timer) clearTimeout(check.timer);
    freshnessChecks.delete(agentId);
  };

  const endAllFreshnessChecks = () => {
    for (const agentId of freshnessChecks.keys()) endFreshnessCheck(agentId);
  };

  const cancelCatchUp = (agentId: string) => {
    catchUpGenerations.set(agentId, (catchUpGenerations.get(agentId) ?? 0) + 1);
    catchUps.delete(agentId);
    pendingCatchUps.delete(agentId);
  };

  const fetchUntilCurrent = async (
    agentId: string,
    generation: number,
    request: CatchUpRequest,
    fallbackToLatestTailOnOverflow: boolean,
  ): Promise<void> => {
    if (!ownsCatchUp(agentId, generation)) return;

    try {
      const page = await ports.fetchPage(agentId, request.page);
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
        if (request.page.direction === "after" && fallbackToLatestTailOnOverflow) {
          await ports.fetchLatestTail(agentId);
          if (!ownsCatchUp(agentId, generation)) return;
          catchUps.set(agentId, { generation, status: "complete" });
          setVisibilityCatchUpReady(agentId);
          return;
        }
        await fetchUntilCurrent(
          agentId,
          generation,
          {
            ...request,
            page: planTimelineCatchUpPastApplied(
              planTimelineCatchUpAfter(page.endCursor),
              ports.readCursor(agentId),
            ),
          },
          false,
        );
        return;
      }
      if (hasNewer) {
        throw new Error(`Timeline page for ${agentId} hasNewer without an end cursor`);
      }
      catchUps.set(agentId, { generation, status: "complete" });
      if (!pendingCatchUps.has(agentId)) setVisibilityCatchUpReady(agentId);
    } catch (error) {
      if (catchUps.get(agentId)?.generation === generation) {
        // The parked follow-up belongs to the failed attempt. A retry owns the next request.
        pendingCatchUps.delete(agentId);
        catchUps.set(agentId, { generation, status: "error", request });
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
        if (disposed) return;
        cacheLoads.delete(agentId);
        loadedCache.add(agentId);
        // Visible catch-up may already be running, complete, or waiting for its own retry.
        // Finishing optional cache preparation must not restart that network lifecycle.
        const current = catchUps.get(agentId);
        const pending = pendingCatchUps.get(agentId);
        if (!current || (current.status === "complete" && pending)) {
          startCatchUp(agentId, { request: pending, supersede: Boolean(pending) });
        }
      });
    cacheLoads.set(agentId, load);
  };

  // Existing streams and retries continue; only initial hidden catch-ups wait.
  const shouldWaitForVisibleCatchUp = (agentId: string) => {
    if (!active || catchUps.has(agentId)) return false;
    const visible = visibleAgentIds();
    return (
      !visible.includes(agentId) &&
      visible.some((id) => {
        const status = catchUps.get(id)?.status;
        return isDesired(id) && (status === undefined || status === "running");
      })
    );
  };

  const hiddenCatchUpSlotsAreFull = (agentId: string) => {
    const visible = new Set(visibleAgentIds());
    if (visible.has(agentId)) return false;
    let hidden = 0;
    for (const attempt of inFlightCatchUps) {
      if (!visible.has(attempt.agentId)) hidden += 1;
    }
    return hidden >= MAX_HIDDEN_CATCH_UPS;
  };

  const startCatchUp = (
    agentId: string,
    options: {
      request?: CatchUpRequest;
      supersede?: boolean;
    } = {},
  ) => {
    const { request, supersede = false } = options;
    if (
      freshnessChecks.has(agentId) ||
      !canCatchUp(agentId) ||
      shouldWaitForVisibleCatchUp(agentId)
    ) {
      if (request) pendingCatchUps.set(agentId, request);
      return;
    }
    if (!loadedCache.has(agentId) && !visibleAgentIds().includes(agentId)) {
      if (request) pendingCatchUps.set(agentId, request);
      ensureCacheLoaded(agentId);
      return;
    }
    // An acknowledged visible session can use its current cursor, or the ordinary bounded
    // tail when no cursor is ready. Durable preparation continues independently; hidden
    // opened sessions retain cache-first scheduling and the existing visible priority.
    const applied = ports.readCursor(agentId);
    const nextRequest = planCatchUpRequest(request, applied);
    const current = catchUps.get(agentId);
    const decision = decideCatchUp({ current, request: nextRequest.page, supersede });
    if (decision === "keep-and-park") {
      pendingCatchUps.set(agentId, nextRequest);
      return;
    }
    if (decision === "keep") {
      return;
    }
    if (hiddenCatchUpSlotsAreFull(agentId)) {
      if (request) pendingCatchUps.set(agentId, request);
      return;
    }
    const generation = (catchUpGenerations.get(agentId) ?? 0) + 1;
    catchUpGenerations.set(agentId, generation);
    catchUps.set(agentId, { generation, status: "running", request: nextRequest });
    pendingCatchUps.delete(agentId);
    const attempt = { agentId };
    inFlightCatchUps.add(attempt);
    if (current?.status === "error" && !manualRetries.has(agentId)) {
      visibilityCatchUpErrors.delete(agentId);
      markCatchUpOwed(agentId);
      notifyListeners();
    }
    // A queued gap uses the coverage available when its fetch starts.
    void fetchUntilCurrent(
      agentId,
      generation,
      nextRequest,
      nextRequest.kind === "resume" || !applied,
    ).finally(() => {
      inFlightCatchUps.delete(attempt);
      startAcknowledgedCatchUps();
    });
  };

  const startAcknowledgedCatchUps = () => {
    const visible = visibleAgentIds();
    const ordered = [
      ...visible.filter(isAcknowledged),
      ...acknowledged.filter((id) => !visible.includes(id)),
    ];
    for (const agentId of ordered) {
      const pendingCatchUp = pendingCatchUps.get(agentId);
      const current = catchUps.get(agentId);
      // A running tail owns its parked gap. A failed catch-up can only have a queued retry.
      if (current?.status === "running" || (current && !pendingCatchUp)) continue;
      startCatchUp(agentId, {
        request: pendingCatchUp,
        supersede: Boolean(pendingCatchUp),
      });
    }
  };

  const retryFailedCatchUp = (agentId: string) => {
    const catchUp = catchUps.get(agentId);
    if (catchUp?.status === "error") {
      startCatchUp(agentId, { request: catchUp.request, supersede: true });
    }
  };

  const membershipIsSettled = (requested: string[]) =>
    !membershipNeedsRetry &&
    !freshnessCheckOwed &&
    sameAgentIds(requested, observation?.agentIds ?? acknowledged);

  // A chat with no fetch running and a cursor to compare; the daemon can answer without a fetch.
  const collectFreshnessCursors = (requested: string[]) => {
    const cursors: Record<string, { epoch: string; seq: number }> = {};
    for (const agentId of requested) {
      if (catchUps.has(agentId) || pendingCatchUps.has(agentId)) continue;
      const cursor = ports.readCursor(agentId);
      if (cursor) cursors[agentId] = { epoch: cursor.epoch, seq: cursor.endSeq };
    }
    return cursors;
  };

  const completeCurrentCatchUp = (agentId: string) => {
    const generation = (catchUpGenerations.get(agentId) ?? 0) + 1;
    catchUpGenerations.set(agentId, generation);
    catchUps.set(agentId, { generation, status: "complete" });
    ports.applyCurrentTimeline(agentId);
    setVisibilityCatchUpReady(agentId);
  };

  const applyFreshnessAnswer = (
    checked: string[],
    timelines: Record<string, TimelineFreshness> | undefined,
  ) => {
    for (const agentId of checked) {
      endFreshnessCheck(agentId);
      // A gap found during the check still needs its fetch; "current" only speaks for the cursor.
      if (timelines?.[agentId] === "current" && !pendingCatchUps.has(agentId)) {
        completeCurrentCatchUp(agentId);
      }
    }
    if (checked.length > 0) notifyListeners();
  };

  const isReconcileSuperseded = (generation: number) =>
    disposed || !connected || generation !== membershipGeneration;

  const askDaemonAboutFreshness = (checked: string[]) => {
    for (const agentId of checked) {
      startFreshnessCheck(agentId);
      startFreshnessCheckDelay(agentId);
    }
    for (const agentId of freshnessChecks.keys()) {
      if (!checked.includes(agentId)) endFreshnessCheck(agentId);
    }
  };

  const reconcileMembership = async (): Promise<void> => {
    if (disposed || !connected) return;
    const generation = membershipGeneration;
    const requested = desired;
    if (membershipIsSettled(requested)) return;
    const canCheck = ports.canCheckFreshness();
    if (canCheck) {
      // The cursor sent to the daemon must include whatever the cache restores.
      await Promise.all(requested.map((agentId) => cacheLoads.get(agentId)));
      if (isReconcileSuperseded(generation)) return;
      if (membershipIsSettled(requested)) return;
    }
    membershipNeedsRetry = false;
    freshnessCheckOwed = false;
    const cursors = canCheck ? collectFreshnessCursors(requested) : undefined;
    const checked = Object.keys(cursors ?? {});
    askDaemonAboutFreshness(checked);
    notifyListeners();
    let timelines: Record<string, TimelineFreshness> | undefined;
    try {
      const previous = observation;
      const handle = ports.observe(requested, cursors);
      observation = { handle, agentIds: requested };
      // A subscription routes events only once the daemon accepts it, so the old one delivers until then.
      const answer = await handle.ready.finally(() => {
        void previous?.handle.release().catch(ports.reportError);
      });
      timelines = answer ? answer.timelines : undefined;
    } catch (error) {
      if (isReconcileSuperseded(generation)) return;
      membershipNeedsRetry = true;
      acknowledged = [];
      for (const agentId of checked) endFreshnessCheck(agentId);
      for (const agentId of requested) cancelCatchUp(agentId);
      setVisibilityCatchUpError(requested, error);
      ports.reportError(error);
      return;
    }
    if (isReconcileSuperseded(generation)) return;
    acknowledged = requested;
    applyFreshnessAnswer(checked, timelines);
    startAcknowledgedCatchUps();
  };

  const retryVisibleAgentTimeline = (agentId: string) => {
    if (!connected || !isDesired(agentId) || manualRetries.has(agentId)) return;
    const catchUp = catchUps.get(agentId);
    const membershipRetryable = membershipNeedsRetry && connected;
    if (catchUp?.status !== "error" && !membershipRetryable) return;
    manualRetries.add(agentId);
    notifyListeners();
    if (membershipRetryable) {
      void reconcileMembership();
      return;
    }
    retryFailedCatchUp(agentId);
  };

  const commitDesiredMembership = (
    nextDesired: string[],
    options: { resetCatchUpStatus?: boolean } = {},
  ) => {
    let statusChanged = false;
    if (options.resetCatchUpStatus) {
      for (const agentId of nextDesired) {
        if (!visibilityCatchUpPending.has(agentId)) statusChanged = true;
        // Even a pending check can outlive the start of a turn. Capture the turn on
        // disconnect so an idle snapshot cannot settle its footer ahead of its messages.
        markCatchUpOwed(agentId);
        if (visibilityCatchUpErrors.delete(agentId)) statusChanged = true;
        if (manualRetries.delete(agentId)) statusChanged = true;
      }
    }
    if (sameAgentIds(nextDesired, desired)) {
      if (statusChanged) notifyListeners();
      return;
    }

    const released: string[] = [];
    for (const agentId of desired) {
      if (!nextDesired.includes(agentId)) {
        cancelCatchUp(agentId);
        endFreshnessCheck(agentId);
        visibilityCatchUpPending.delete(agentId);
        visibilityCatchUpErrors.delete(agentId);
        manualRetries.delete(agentId);
        ports.onCatchUpOwed(agentId);
        released.push(agentId);
      }
    }
    for (const agentId of nextDesired) {
      if (!desired.includes(agentId)) {
        markCatchUpOwed(agentId);
        visibilityCatchUpErrors.delete(agentId);
        manualRetries.delete(agentId);
        if (connected && ports.canCheckFreshness()) startFreshnessCheck(agentId);
        ensureCacheLoaded(agentId);
      }
    }
    desired = nextDesired;
    ports.replaceDemandedAgentIds(desired);
    membershipGeneration += 1;
    for (const agentId of released) ports.onCatchUpEnded(agentId);
    notifyListeners();
    void reconcileMembership();
  };

  // A render can see the connection return, or a chat become visible, before this owner hears
  // about it, so those two states answer as if the check had already started.
  const getUnconfirmedStatus = (agentId: string): ViewedTimelineStatus => {
    const check = freshnessChecks.get(agentId);
    if (check) {
      if (check.reason === "reconnect") return "reattaching";
      return check.quiet ? "checking" : "pending";
    }
    if (!ports.canCheckFreshness()) return "pending";
    if (!connected) return "reattaching";
    return isDesired(agentId) ? "pending" : "checking";
  };

  const publishVisibleMembership = () => {
    commitDesiredMembership(normalizeAgentIds([...openedAgentIds, ...visibleAgentIds()]));
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getAgentTimelineStatus(agentId) {
      if (manualRetries.has(agentId)) return "retrying";
      if (visibilityCatchUpErrors.has(agentId)) return "error";
      if (isDesired(agentId) && !visibilityCatchUpPending.has(agentId)) return "ready";
      return getUnconfirmedStatus(agentId);
    },
    getAgentTimelineError(agentId) {
      return visibilityCatchUpErrors.get(agentId) ?? null;
    },
    replaceOpenTabAgentIds(agentIds) {
      const openTabs = new Set(agentIds);
      const next = openedAgentIds.filter((agentId) => openTabs.has(agentId));
      if (sameAgentIds(next, openedAgentIds)) return;
      openedAgentIds = next;
      publishVisibleMembership();
    },
    replaceVisibleAgentIds(sourceId, agentIds) {
      const previouslyVisible = new Set(visibleAgentIds());
      const normalized = normalizeAgentIds(agentIds);
      if (normalized.length === 0) sources.delete(sourceId);
      else sources.set(sourceId, normalized);
      rememberOpenedAgentIds(normalized);
      publishVisibleMembership();
      if (active) {
        for (const agentId of normalized) {
          if (!previouslyVisible.has(agentId)) retryFailedCatchUp(agentId);
        }
      }
      startAcknowledgedCatchUps();
    },
    setActive(nextActive) {
      if (active === nextActive) return;
      active = nextActive;
      publishVisibleMembership();
      if (!active) {
        startAcknowledgedCatchUps();
        return;
      }
      const canCheck = connected && ports.canCheckFreshness();
      for (const agentId of visibleAgentIds()) {
        if (visibilityCatchUpErrors.has(agentId)) {
          retryFailedCatchUp(agentId);
          continue;
        }
        markCatchUpOwed(agentId);
        if (
          canCheck &&
          catchUps.get(agentId)?.status === "complete" &&
          !pendingCatchUps.has(agentId) &&
          ports.readCursor(agentId)
        ) {
          catchUps.delete(agentId);
          startFreshnessCheck(agentId, "resume");
          freshnessCheckOwed = true;
          continue;
        }
        startCatchUp(agentId, { supersede: true });
      }
      if (freshnessCheckOwed) {
        membershipGeneration += 1;
        void reconcileMembership();
      }
      notifyListeners();
    },
    setConnected(nextConnected) {
      if (connected === nextConnected) return;
      connected = nextConnected;
      if (!connected) {
        commitDesiredMembership(desired, { resetCatchUpStatus: true });
        void observation?.handle.release().catch(ports.reportError);
        observation = null;
        acknowledged = [];
        membershipGeneration += 1;
        freshnessCheckOwed = false;
        endAllFreshnessChecks();
        for (const agentId of desired) cancelCatchUp(agentId);
        return;
      }
      if (ports.canCheckFreshness()) {
        for (const agentId of desired) {
          if (visibilityCatchUpPending.has(agentId)) startFreshnessCheck(agentId, "reconnect");
        }
      }
      membershipGeneration += 1;
      notifyListeners();
      void reconcileMembership();
    },
    catchUpOnReturn(agentId) {
      if (!isDesired(agentId) || catchUps.get(agentId)?.status === "running") return;
      // The ordinary resume plan: one bounded page, then the latest tail if more is newer.
      startCatchUp(agentId, { supersede: true });
    },
    recoverGap(agentId, cursor) {
      if (!isDesired(agentId) || catchUps.get(agentId)?.status === "error") return;
      startCatchUp(agentId, {
        request: {
          page: planTimelineCatchUpAfter({ epoch: cursor.epoch, seq: cursor.endSeq }),
          kind: "gap",
        },
        supersede: true,
      });
    },
    dispose() {
      disposed = true;
      void observation?.handle.release().catch(ports.reportError);
      observation = null;
      membershipNeedsRetry = false;
      sources.clear();
      membershipGeneration += 1;
      for (const agentId of desired) cancelCatchUp(agentId);
      desired = [];
      ports.replaceDemandedAgentIds([]);
      acknowledged = [];
      openedAgentIds = [];
      loadedCache.clear();
      cacheLoads.clear();
      visibilityCatchUpPending.clear();
      visibilityCatchUpErrors.clear();
      manualRetries.clear();
      endAllFreshnessChecks();
      notifyListeners();
      listeners.clear();
    },
    retryVisibleAgentTimeline,
  };
}
