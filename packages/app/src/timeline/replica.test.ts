import { DatabaseSync } from "node:sqlite";
import { createInitDeferred, getInitKey, resolveInitDeferred } from "@/utils/agent-initialization";
import { ReplicaCache } from "@/runtime/replica-cache";
import {
  createSqliteReplicaRowStore,
  type ReplicaSqliteConnection,
  type SqliteValue,
} from "@/runtime/replica-cache/row-store-sqlite";
import { TimelinePageRetention } from "./timeline-page-retention";
import { TimelineRetentionOwner } from "./timeline-retention-owner";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentTimelineItem } from "@clisbot/protocol/agent-types";
import type { AgentStreamEventPayload } from "@clisbot/protocol/messages";
import type { CachedTimeline } from "@/runtime/replica-cache";
import {
  selectAgentTimelineState,
  selectAgentTimelineTurnPresentation,
  selectAgentTurnPresentation,
  useSessionStore,
  type Agent,
} from "@/stores/session-store";
import { useCreateFlowStore, type PendingCreateAttempt } from "@/stores/create-flow-store";
import type { StreamItem } from "@/types/stream";
import type { AgentStreamReducerEvent } from "./session-stream-reducers";
import type { ProjectedTimelineForwardFetchPlan } from "./timeline-sync-plan";
import { reduceTurnLiveness, type TurnLivenessTransition } from "./turn-liveness";
import {
  createTimelineReplica,
  createViewedTimelineOwner,
  type TimelineReplicaStorage,
  type TimelineReplica,
  type TimelineResponsePayload,
  type ViewedTimelineOwner,
  type ViewedTimelineOwnerPorts,
} from "./viewed-timeline-sync";

const SERVER_ID = "timeline-replica-host";
const AGENT_ID = "agent-1";

function item(id: string, text: string, seq: number): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text,
    timestamp: new Date("2026-08-26T10:00:00.000Z"),
    timelineCursor: { epoch: "epoch-1", seq },
  };
}

function cachedTimeline(): CachedTimeline {
  return {
    agentId: AGENT_ID,
    items: [item("cached", "cached", 4)],
    range: { epoch: "epoch-1", startSeq: 1, endSeq: 4 },
    hasOlder: true,
  };
}

interface OwnerOptions {
  retentionBudget?: TimelinePageRetention;
  ports?: Partial<ViewedTimelineOwnerPorts>;
  replica?: TimelineReplica;
  applyTurnLiveness?: (agentId: string, transitions: readonly TurnLivenessTransition[]) => void;
  checksFreshness?: boolean;
}

function createOwnerWith(
  storage: TimelineReplicaStorage,
  options: OwnerOptions = {},
): ViewedTimelineOwner {
  const checksFreshness = options.checksFreshness ?? false;
  const replica =
    options.replica ??
    createTimelineReplica({
      serverId: SERVER_ID,
      storage,
      prepareAgent: async () => undefined,
    });
  return createViewedTimelineOwner({
    retentionBudget: options.retentionBudget,
    serverId: SERVER_ID,
    replica,
    replaceDemandedAgentIds: () => undefined,
    drainQueuedAgentMessage: () => undefined,
    applyTurnLiveness: options.applyTurnLiveness ?? (() => undefined),
    ports: {
      canCheckFreshness: () => checksFreshness,
      observe: () => ({ ready: Promise.resolve(), release: async () => undefined }),
      readCursor: () => {
        if (!checksFreshness) return undefined;
        const session = useSessionStore.getState().sessions[SERVER_ID];
        const timeline = selectAgentTimelineState(session, AGENT_ID);
        return timeline.status === "synced" && timeline.range
          ? { epoch: timeline.range.epoch, endSeq: timeline.range.endSeq }
          : undefined;
      },
      fetchPage: async () => ({ hasNewer: false, endCursor: null }),
      fetchLatestTail: async () => ({ hasNewer: false, endCursor: null }),
      reportError: () => undefined,
      ...options.ports,
    },
  });
}

/** Clisbot tests: retention budget, port overrides and a shared replica. */
function createOwner(
  storage: TimelineReplicaStorage,
  retentionBudget?: TimelinePageRetention,
  ports?: Partial<ViewedTimelineOwnerPorts>,
  replica?: TimelineReplica,
): ViewedTimelineOwner {
  return createOwnerWith(storage, { retentionBudget, ports, replica });
}

/** Upstream tests: turn liveness, page fetches, observation and freshness checks. */
function createLivenessOwner(
  storage: TimelineReplicaStorage,
  applyTurnLiveness?: (agentId: string, transitions: readonly TurnLivenessTransition[]) => void,
  fetchPage?: ViewedTimelineOwnerPorts["fetchPage"],
  observe?: ViewedTimelineOwnerPorts["observe"],
  checksFreshness = false,
): ViewedTimelineOwner {
  return createOwnerWith(storage, {
    applyTurnLiveness,
    checksFreshness,
    ports: { ...(fetchPage ? { fetchPage } : {}), ...(observe ? { observe } : {}) },
  });
}

function retentionPage(start: number, end: number, hasOlder: boolean) {
  return {
    requestId: `retention-${start}-${end}`,
    agentId: AGENT_ID,
    agent: null,
    direction: "tail" as const,
    projection: "projected" as const,
    reset: false,
    staleCursor: false,
    gap: false,
    epoch: "epoch-1",
    window: { minSeq: 1, maxSeq: end, nextSeq: end + 1 },
    startCursor: { epoch: "epoch-1", seq: start },
    endCursor: { epoch: "epoch-1", seq: end },
    hasOlder,
    hasNewer: false,
    error: null,
    entries: Array.from({ length: end - start + 1 }, (_, index) => {
      const seq = start + index;
      return {
        provider: "mock" as const,
        timestamp: "2026-08-26T10:00:00.000Z",
        seqStart: seq,
        seqEnd: seq,
        sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
        collapsed: [],
        item: { type: "assistant_message" as const, text: `row ${seq}`, messageId: `row-${seq}` },
      };
    }),
  };
}

function applySynced(agentId: string, seq: number): void {
  useSessionStore.getState().applyAgentTimelineResponseState(SERVER_ID, agentId, {
    items: [item(`network-${agentId}`, "network", seq)],
    head: [],
    range: { epoch: "epoch-1", startSeq: 1, endSeq: seq },
    older: "available",
    newer: false,
    synchronized: true,
    acknowledgedClientMessageIds: [],
  });
}

afterEach(() => {
  resolveInitDeferred(getInitKey(SERVER_ID, AGENT_ID));
  useSessionStore.getState().clearSession(SERVER_ID);
});

describe("viewed timeline persistence", () => {
  it("keeps one complete reply when live chunks arrive before a cached chat catches up", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    const partial = "Paragraph 1. Paragraph 2.";
    const complete = `${partial} Paragraph 3. END`;
    const owner = createOwner({
      readTimeline: async () => ({
        agentId: AGENT_ID,
        items: [{ ...item("reply-1", partial, 4), messageId: "reply-1" }],
        range: { epoch: "epoch-1", startSeq: 1, endSeq: 4 },
        hasOlder: false,
      }),
      commitTimeline: () => undefined,
    });
    try {
      owner.replaceVisibleAgentIds("test", [AGENT_ID]);
      await expect
        .poll(
          () =>
            selectAgentTimelineState(useSessionStore.getState().sessions[SERVER_ID], AGENT_ID)
              .status,
        )
        .toBe("painted");
      owner.applyStreamEvent(AGENT_ID, {
        event: {
          type: "timeline",
          provider: "codex",
          item: { type: "assistant_message", text: " Paragraph 3.", messageId: "reply-1" },
        } as AgentStreamEventPayload,
        seq: 5,
        epoch: "epoch-1",
        timestamp: new Date("2026-08-26T10:00:01.000Z"),
      });
      owner.flushStreamAgent(AGENT_ID);
      owner.applyTimelineResponse({
        requestId: "resume",
        agentId: AGENT_ID,
        agent: null,
        direction: "after",
        projection: "projected",
        reset: false,
        epoch: "epoch-1",
        window: { minSeq: 1, maxSeq: 6, nextSeq: 7 },
        startCursor: { epoch: "epoch-1", seq: 5 },
        endCursor: { epoch: "epoch-1", seq: 6 },
        entries: [
          {
            provider: "codex",
            item: { type: "assistant_message", text: complete, messageId: "reply-1" },
            timestamp: "2026-08-26T10:00:02.000Z",
            seqStart: 2,
            seqEnd: 6,
            sourceSeqRanges: [{ startSeq: 2, endSeq: 6 }],
            collapsed: ["assistant_merge"],
          },
        ],
        error: null,
        hasNewer: false,
        hasOlder: false,
        staleCursor: false,
        gap: false,
      });
      const replyTexts = () => {
        const session = useSessionStore.getState().sessions[SERVER_ID];
        return [
          ...(session?.agentStreamTail.get(AGENT_ID) ?? []),
          ...(session?.agentStreamHead.get(AGENT_ID) ?? []),
        ]
          .filter((entry) => entry.kind === "assistant_message")
          .map((entry) => entry.text);
      };
      expect.soft(replyTexts()).toEqual([complete]);
      owner.applyStreamEvent(AGENT_ID, {
        event: { type: "turn_completed", provider: "codex" } as AgentStreamEventPayload,
        seq: 7,
        epoch: "epoch-1",
        timestamp: new Date("2026-08-26T10:00:03.000Z"),
      });
      owner.flushStreamAgent(AGENT_ID);
      expect.soft(replyTexts()).toEqual([complete]);
    } finally {
      owner.dispose();
    }
  });

  it("shares an in-flight cache preparation with the viewed owner", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    let release!: (value: CachedTimeline) => void;
    let reads = 0;
    const read = new Promise<CachedTimeline>((resolve) => {
      release = resolve;
    });
    const replica = createTimelineReplica({
      serverId: SERVER_ID,
      storage: {
        readTimeline: () => {
          reads += 1;
          return read;
        },
        commitTimeline: () => undefined,
      },
      prepareAgent: async () => undefined,
    });

    const routePreparation = replica.prepare(AGENT_ID);
    const ownerPreparation = replica.prepare(AGENT_ID);
    release(cachedTimeline());
    await Promise.all([routePreparation, ownerPreparation]);

    expect(reads).toBe(1);
    expect(replica.readCursor(AGENT_ID)).toEqual({ epoch: "epoch-1", endSeq: 4 });
  });

  it.each(["complete", "partial", "reset"] as const)(
    "keeps an earlier authoritative %s page when pending cache preparation finishes",
    async (mode) => {
      useSessionStore.getState().initializeSession(SERVER_ID, null);
      let release!: (value: CachedTimeline) => void;
      const held = new Promise<CachedTimeline>((resolve) => {
        release = resolve;
      });
      const requests: string[] = [];
      const never = new Promise<{ hasNewer: boolean; endCursor: null }>(() => {});
      const budget = new TimelinePageRetention();
      const owner = createOwner(
        { readTimeline: () => held, commitTimeline: () => undefined },
        budget,
        {
          fetchPage: async (_id, request) => {
            requests.push(request.direction);
            if (requests.length > 1) return never;
            const page = retentionPage(10, 11, true);
            page.hasNewer = mode === "partial";
            if (mode === "reset") {
              page.reset = true;
              page.epoch = "epoch-2";
              page.startCursor.epoch = page.endCursor.epoch = "epoch-2";
            }
            owner.applyTimelineResponse(page);
            return { hasNewer: page.hasNewer, endCursor: page.endCursor };
          },
        },
      );
      owner.setConnected(true);
      owner.replaceVisibleAgentIds("pane", [AGENT_ID]);
      await expect.poll(() => requests.length, { timeout: 100 }).toBe(mode === "partial" ? 2 : 1);
      const accepted = selectAgentTimelineState(
        useSessionStore.getState().sessions[SERVER_ID],
        AGENT_ID,
      );
      expect(
        (accepted.status === "cold" ? [] : accepted.items).map((row) => row.timelineCursor?.seq),
      ).toEqual([10, 11]);
      const retainedBefore = budget.retainedBytes;
      release(cachedTimeline());
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(
        selectAgentTimelineState(useSessionStore.getState().sessions[SERVER_ID], AGENT_ID),
      ).toEqual(accepted);
      expect(requests).toEqual(mode === "partial" ? ["tail", "after"] : ["tail"]);
      expect(budget.retainedBytes).toBe(retainedBefore);
      owner.dispose();
      expect(budget.retainedBytes).toBe(0);
    },
  );

  it("does not restore an old epoch over a partial authoritative reset while cache is pending", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    let release!: (value: CachedTimeline) => void;
    const held = new Promise<CachedTimeline>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    const replica = createTimelineReplica({
      serverId: SERVER_ID,
      storage: {
        readTimeline: async () => (++reads === 1 ? cachedTimeline() : held),
        commitTimeline: () => undefined,
      },
      prepareAgent: async () => undefined,
    });
    await replica.prepare(AGENT_ID);
    const pending = replica.prepare(AGENT_ID);
    const owner = createViewedTimelineOwner({
      serverId: SERVER_ID,
      replica,
      replaceDemandedAgentIds: () => undefined,
      drainQueuedAgentMessage: () => undefined,
      applyTurnLiveness: () => undefined,
      ports: {
        canCheckFreshness: () => false,
        observe: () => ({ ready: Promise.resolve(), release: async () => undefined }),
        readCursor: () => undefined,
        fetchPage: async () => ({ hasNewer: false, endCursor: null }),
        fetchLatestTail: async () => ({ hasNewer: false, endCursor: null }),
        reportError: () => undefined,
      },
    });
    const page = {
      ...retentionPage(10, 11, true),
      direction: "after" as const,
      epoch: "epoch-2",
      reset: true,
      hasNewer: true,
      startCursor: { epoch: "epoch-2", seq: 10 },
      endCursor: { epoch: "epoch-2", seq: 11 },
    };
    owner.applyTimelineResponse(page);
    const accepted = selectAgentTimelineState(
      useSessionStore.getState().sessions[SERVER_ID],
      AGENT_ID,
    );
    expect(accepted.status).toBe("painted");
    expect(
      (accepted.status === "cold" ? [] : accepted.items).map((row) => row.timelineCursor?.epoch),
    ).toEqual(["epoch-2", "epoch-2"]);
    release(cachedTimeline());
    await pending;
    expect(
      selectAgentTimelineState(useSessionStore.getState().sessions[SERVER_ID], AGENT_ID),
    ).toEqual(accepted);
    expect(
      useSessionStore.getState().sessions[SERVER_ID]?.agentTimelineCursor.get(AGENT_ID)?.epoch,
    ).toBe("epoch-2");
    owner.dispose();
  });

  it("does not repopulate coverage evicted by the retention owner during a cache read", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    let release!: (value: CachedTimeline) => void;
    const held = new Promise<CachedTimeline>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    const replica = createTimelineReplica({
      serverId: SERVER_ID,
      storage: {
        readTimeline: async () => (++reads === 1 ? cachedTimeline() : held),
        commitTimeline: () => undefined,
      },
      prepareAgent: async () => undefined,
    });
    await replica.prepare(AGENT_ID);
    const budget = new TimelinePageRetention({
      sessionBytes: 10000,
      totalBytes: 10000,
      pageMetadataBytes: 256,
    });
    const retention = new TimelineRetentionOwner(SERVER_ID, budget);
    retention.prepare(AGENT_ID);
    const pending = replica.prepare(AGENT_ID);
    const removeOther = budget.register("other-owner", () => undefined);
    const releaseReservation = budget.reserve("other-owner", 9900);
    expect(releaseReservation).not.toBeNull();
    expect(
      useSessionStore.getState().sessions[SERVER_ID]?.agentTimelineCursor.get(AGENT_ID),
    ).toBeUndefined();
    expect(
      selectAgentTimelineState(useSessionStore.getState().sessions[SERVER_ID], AGENT_ID).status,
    ).toBe("cold");
    release(cachedTimeline());
    await pending;
    expect(
      selectAgentTimelineState(useSessionStore.getState().sessions[SERVER_ID], AGENT_ID).status,
    ).toBe("cold");
    expect(
      useSessionStore.getState().sessions[SERVER_ID]?.agentTimelineCursor.get(AGENT_ID),
    ).toBeUndefined();
    releaseReservation?.();
    retention.dispose();
    removeOther();
  });

  it("retains accepted cache coverage when an already-sent initial tail overlaps it", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    let releaseCache!: (value: CachedTimeline) => void;
    let respond!: () => void;
    const held = new Promise<CachedTimeline>((resolve) => {
      releaseCache = resolve;
    });
    const requests: string[] = [];
    const owner = createOwner(
      { readTimeline: () => held, commitTimeline: () => undefined },
      undefined,
      {
        fetchPage: async (_id, request) => {
          requests.push(request.direction);
          createInitDeferred(getInitKey(SERVER_ID, AGENT_ID), request.direction);
          useSessionStore.getState().setInitializingAgents(SERVER_ID, new Map([[AGENT_ID, true]]));
          return new Promise((resolve) => {
            respond = () => {
              const page = retentionPage(3, 6, true);
              owner.applyTimelineResponse(page);
              resolve({ hasNewer: false, endCursor: page.endCursor });
            };
          });
        },
      },
    );
    owner.setConnected(true);
    owner.replaceVisibleAgentIds("pane", [AGENT_ID]);
    await expect.poll(() => requests.length, { timeout: 100 }).toBe(1);
    releaseCache({
      ...cachedTimeline(),
      items: [1, 2, 3, 4].map((seq) => item(`row-${seq}`, `row ${seq}`, seq)),
    });
    await expect
      .poll(
        () =>
          selectAgentTimelineState(useSessionStore.getState().sessions[SERVER_ID], AGENT_ID).status,
      )
      .toBe("painted");
    respond();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const timeline = selectAgentTimelineState(
      useSessionStore.getState().sessions[SERVER_ID],
      AGENT_ID,
    );
    expect(
      (timeline.status === "cold" ? [] : timeline.items).map((row) => row.timelineCursor?.seq),
    ).toEqual([1, 2, 3, 4, 5, 6]);
    expect(timeline).toMatchObject({
      status: "synced",
      range: { startSeq: 1, endSeq: 6 },
      older: "available",
    });
    expect(requests).toEqual(["tail"]);
    owner.dispose();
  });

  it("paints a late durable snapshot after network failure while retaining the error", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    let release!: (value: CachedTimeline) => void;
    const held = new Promise<CachedTimeline>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const owner = createOwner(
      { readTimeline: () => held, commitTimeline: () => undefined },
      undefined,
      {
        fetchPage: async () => {
          calls += 1;
          throw new Error("unreachable");
        },
      },
    );
    owner.setConnected(true);
    owner.replaceVisibleAgentIds("pane", [AGENT_ID]);
    await expect.poll(() => owner.getAgentTimelineStatus(AGENT_ID)).toBe("error");
    release(cachedTimeline());
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(
      selectAgentTimelineState(useSessionStore.getState().sessions[SERVER_ID], AGENT_ID),
    ).toMatchObject({ status: "painted", items: cachedTimeline().items });
    expect(owner.getAgentTimelineError(AGENT_ID)).toBe("unreachable");
    expect(calls).toBe(1);
    owner.dispose();
  });

  it("admits late A history after Back without replacing B or sending either request twice", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    let releaseCache!: () => void;
    const heldCache = new Promise<void>((resolve) => {
      releaseCache = resolve;
    });
    const sends: string[] = [];
    const applies: string[] = [];
    const responses = new Map<string, () => void>();
    const owner = createOwner(
      {
        readTimeline: async (_host, agentId) => {
          await heldCache;
          return { ...cachedTimeline(), agentId };
        },
        commitTimeline: () => undefined,
      },
      undefined,
      {
        fetchPage: async (agentId) => {
          sends.push(agentId);
          return new Promise((resolve) =>
            responses.set(agentId, () => {
              const page = { ...retentionPage(10, 11, true), agentId };
              applies.push(agentId);
              owner.applyTimelineResponse(page);
              resolve({ hasNewer: false, endCursor: page.endCursor });
            }),
          );
        },
      },
    );
    owner.setConnected(true);
    owner.replaceVisibleAgentIds("pane", [AGENT_ID]);
    await expect.poll(() => sends).toEqual([AGENT_ID]);
    owner.replaceVisibleAgentIds("pane", []);
    owner.replaceVisibleAgentIds("pane", ["agent-b"]);
    await expect.poll(() => sends).toEqual([AGENT_ID, "agent-b"]);
    responses.get("agent-b")!();
    await expect.poll(() => owner.getAgentTimelineStatus("agent-b")).toBe("ready");
    const b = selectAgentTimelineState(useSessionStore.getState().sessions[SERVER_ID], "agent-b");
    responses.get(AGENT_ID)!();
    await expect.poll(() => owner.getAgentTimelineStatus(AGENT_ID)).toBe("ready");
    releaseCache();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(
      selectAgentTimelineState(useSessionStore.getState().sessions[SERVER_ID], "agent-b"),
    ).toEqual(b);
    expect(sends).toEqual([AGENT_ID, "agent-b"]);
    expect(applies).toEqual(["agent-b", AGENT_ID]);
    owner.dispose();
  });

  it("does not recreate a removed Host when its held cache read completes", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    let release!: (value: CachedTimeline) => void;
    const held = new Promise<CachedTimeline>((resolve) => {
      release = resolve;
    });
    const owner = createOwner({ readTimeline: () => held, commitTimeline: () => undefined });
    owner.replaceVisibleAgentIds("pane", [AGENT_ID]);
    owner.dispose();
    useSessionStore.getState().clearSession(SERVER_ID);
    release(cachedTimeline());
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(useSessionStore.getState().sessions[SERVER_ID]).toBeUndefined();
  });

  it("paints cached history without claiming authoritative synchronization", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    const owner = createOwner({
      readTimeline: async () => cachedTimeline(),
      commitTimeline: () => undefined,
    });

    owner.replaceVisibleAgentIds("test", [AGENT_ID]);

    await expect
      .poll(() =>
        selectAgentTimelineState(useSessionStore.getState().sessions[SERVER_ID], AGENT_ID),
      )
      .toEqual({ status: "painted", items: cachedTimeline().items });
    owner.dispose();
  });

  it("reconciles an overlapping projected message against its cached cursor", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    const partial = "```mermaid\nflowchart LR\n  Start --> Mid";
    const complete = `${partial}dle\n  Middle --> Done\n\`\`\``;
    const owner = createOwner({
      readTimeline: async () => ({
        agentId: AGENT_ID,
        items: [item("cached", partial, 4)],
        range: { epoch: "epoch-1", startSeq: 1, endSeq: 4 },
        hasOlder: false,
      }),
      commitTimeline: () => undefined,
    });

    owner.replaceVisibleAgentIds("test", [AGENT_ID]);
    await expect
      .poll(() =>
        selectAgentTimelineState(useSessionStore.getState().sessions[SERVER_ID], AGENT_ID),
      )
      .toMatchObject({ status: "painted" });

    owner.applyTimelineResponse({
      requestId: "page-after-cache",
      agentId: AGENT_ID,
      agent: null,
      direction: "after",
      projection: "projected",
      reset: false,
      epoch: "epoch-1",
      window: { minSeq: 1, maxSeq: 5, nextSeq: 6 },
      startCursor: { epoch: "epoch-1", seq: 5 },
      endCursor: { epoch: "epoch-1", seq: 5 },
      entries: [
        {
          provider: "mock",
          item: { type: "assistant_message", text: complete },
          timestamp: "2026-08-26T10:00:00.000Z",
          seqStart: 2,
          seqEnd: 5,
          sourceSeqRanges: [{ startSeq: 2, endSeq: 5 }],
          collapsed: ["assistant_merge"],
        },
      ],
      error: null,
      hasNewer: false,
      hasOlder: false,
      staleCursor: false,
      gap: false,
    });

    const session = useSessionStore.getState().sessions[SERVER_ID];
    expect([
      ...(session?.agentStreamTail.get(AGENT_ID) ?? []),
      ...(session?.agentStreamHead.get(AGENT_ID) ?? []),
    ]).toMatchObject([{ kind: "assistant_message", text: complete }]);
    owner.dispose();
  });

  it("reopens painted live mutations without persisting authoritative coverage", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    let durable: CachedTimeline | undefined = cachedTimeline();
    let pending: CachedTimeline | undefined;
    const storage: TimelineReplicaStorage = {
      readTimeline: async () => durable,
      commitTimeline: (_serverId, _agentId, timeline) => {
        pending = timeline;
      },
    };
    const first = createOwner(storage);
    first.replaceVisibleAgentIds("test", [AGENT_ID]);
    await expect
      .poll(() =>
        selectAgentTimelineState(useSessionStore.getState().sessions[SERVER_ID], AGENT_ID),
      )
      .toMatchObject({ status: "painted" });

    first.applyStreamEvent(AGENT_ID, {
      event: {
        type: "timeline",
        provider: "codex",
        item: { type: "assistant_message", text: "live", messageId: "live" },
      } as AgentStreamEventPayload,
      seq: 5,
      epoch: "epoch-1",
      timestamp: new Date("2026-08-26T10:00:01.000Z"),
    });
    first.flushStreamAgent(AGENT_ID);

    expect(pending).toMatchObject({ range: null, hasOlder: false });
    expect(pending?.items.map((entry) => entry.id)).toEqual(["cached", expect.any(String)]);
    durable = pending;
    first.dispose();
    useSessionStore.getState().clearSession(SERVER_ID);
    useSessionStore.getState().initializeSession(SERVER_ID, null);

    const reopened = createOwner(storage);
    reopened.replaceVisibleAgentIds("test", [AGENT_ID]);
    await expect
      .poll(() =>
        selectAgentTimelineState(useSessionStore.getState().sessions[SERVER_ID], AGENT_ID),
      )
      .toMatchObject({
        status: "painted",
        items: [
          expect.objectContaining({ id: "cached" }),
          expect.objectContaining({ text: "live" }),
        ],
      });
    reopened.dispose();
  });

  it("does not let a late cache read overwrite newer network state", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    let release!: (value: CachedTimeline) => void;
    const read = new Promise<CachedTimeline>((resolve) => {
      release = resolve;
    });
    const owner = createOwner({
      readTimeline: () => read,
      commitTimeline: () => undefined,
    });

    owner.replaceVisibleAgentIds("test", [AGENT_ID]);
    applySynced(AGENT_ID, 8);
    release(cachedTimeline());

    await expect
      .poll(() =>
        selectAgentTimelineState(useSessionStore.getState().sessions[SERVER_ID], AGENT_ID),
      )
      .toMatchObject({ status: "synced", range: { endSeq: 8 } });
    owner.dispose();
  });

  it("paints cached rows without replacing a live head that arrives during preparation", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    let release!: (value: CachedTimeline) => void;
    const read = new Promise<CachedTimeline>((resolve) => {
      release = resolve;
    });
    const replica = createTimelineReplica({
      serverId: SERVER_ID,
      storage: {
        readTimeline: () => read,
        commitTimeline: () => undefined,
      },
      prepareAgent: async () => undefined,
    });

    const preparation = replica.prepare(AGENT_ID);
    useSessionStore.getState().setAgentStreamState(SERVER_ID, AGENT_ID, {
      head: [item("live", "live", 5)],
    });
    release(cachedTimeline());
    await preparation;

    expect(replica.readCursor(AGENT_ID)).toEqual({ epoch: "epoch-1", endSeq: 4 });
    expect(
      selectAgentTimelineState(useSessionStore.getState().sessions[SERVER_ID], AGENT_ID),
    ).toEqual({ status: "painted", items: cachedTimeline().items });
    expect(useSessionStore.getState().sessions[SERVER_ID]?.agentStreamHead.get(AGENT_ID)).toEqual([
      item("live", "live", 5),
    ]);
  });

  it("preparing an already painted cache again keeps history out of the live head", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    const replica = createTimelineReplica({
      serverId: SERVER_ID,
      storage: { readTimeline: async () => cachedTimeline(), commitTimeline: () => undefined },
      prepareAgent: async () => undefined,
    });
    await replica.prepare(AGENT_ID);
    const painted = useSessionStore.getState().sessions[SERVER_ID]!.agentStreamTail.get(AGENT_ID);
    expect(painted).toEqual(cachedTimeline().items);
    await replica.prepare(AGENT_ID);
    const session = useSessionStore.getState().sessions[SERVER_ID]!;
    expect(session.agentStreamHead.get(AGENT_ID) ?? []).toEqual([]);
    expect(session.agentStreamTail.get(AGENT_ID)).toBe(painted);
  });

  it("reconciles a live head that overlaps the cached canonical timeline", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    let release!: (value: CachedTimeline) => void;
    const read = new Promise<CachedTimeline>((resolve) => {
      release = resolve;
    });
    const replica = createTimelineReplica({
      serverId: SERVER_ID,
      storage: {
        readTimeline: () => read,
        commitTimeline: () => undefined,
      },
      prepareAgent: async () => undefined,
    });

    const preparation = replica.prepare(AGENT_ID);
    useSessionStore.getState().setAgentStreamState(SERVER_ID, AGENT_ID, {
      head: [item("cached", "cached", 4), item("live", "live", 5)],
    });
    release(cachedTimeline());
    await preparation;

    const session = useSessionStore.getState().sessions[SERVER_ID];
    expect([
      ...(session?.agentStreamTail.get(AGENT_ID) ?? []),
      ...(session?.agentStreamHead.get(AGENT_ID) ?? []),
    ]).toEqual([item("cached", "cached", 4), item("live", "live", 5)]);
    expect(replica.readCursor(AGENT_ID)).toEqual({ epoch: "epoch-1", endSeq: 4 });
  });

  it("reconciles cached rows with a non-authoritative timeline painted during preparation", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    let release!: (value: CachedTimeline) => void;
    const read = new Promise<CachedTimeline>((resolve) => {
      release = resolve;
    });
    const replica = createTimelineReplica({
      serverId: SERVER_ID,
      storage: {
        readTimeline: () => read,
        commitTimeline: () => undefined,
      },
      prepareAgent: async () => undefined,
    });

    const preparation = replica.prepare(AGENT_ID);
    useSessionStore.getState().applyAgentTimelineResponseState(SERVER_ID, AGENT_ID, {
      items: [item("live", "live", 5)],
      head: [],
      range: null,
      older: "none",
      newer: false,
      synchronized: false,
      acknowledgedClientMessageIds: [],
    });
    release(cachedTimeline());
    await preparation;

    const session = useSessionStore.getState().sessions[SERVER_ID];
    expect([
      ...(session?.agentStreamTail.get(AGENT_ID) ?? []),
      ...(session?.agentStreamHead.get(AGENT_ID) ?? []),
    ]).toEqual([item("cached", "cached", 4), item("live", "live", 5)]);
    expect(replica.readCursor(AGENT_ID)).toEqual({ epoch: "epoch-1", endSeq: 4 });
  });

  it("persists accepted live stream commits through the owner", () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    applySynced(AGENT_ID, 8);
    const commits: CachedTimeline[] = [];
    const owner = createOwner({
      readTimeline: async () => undefined,
      commitTimeline: (_serverId, _agentId, timeline) => commits.push(timeline),
    });
    owner.replaceVisibleAgentIds("test", [AGENT_ID]);
    owner.applyStreamEvent(AGENT_ID, {
      event: {
        type: "timeline",
        provider: "codex",
        item: { type: "assistant_message", text: "live", messageId: "live" },
      } as AgentStreamEventPayload,
      seq: 9,
      epoch: "epoch-1",
      timestamp: new Date("2026-08-26T10:00:01.000Z"),
    });
    owner.flushStreamAgent(AGENT_ID);

    expect(commits.at(-1)?.items.at(-1)).toMatchObject({ text: "live" });
    expect(commits.at(-1)?.range?.endSeq).toBe(9);
    owner.dispose();
  });

  it("keeps a pre-hydration live row after admitting the older baseline page", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    const owner = createOwner({
      readTimeline: async () => ({ ...cachedTimeline(), range: null }),
      commitTimeline: () => undefined,
    });
    owner.replaceVisibleAgentIds("test", [AGENT_ID]);
    await expect
      .poll(
        () =>
          selectAgentTimelineState(useSessionStore.getState().sessions[SERVER_ID], AGENT_ID).status,
      )
      .toBe("painted");
    owner.applyStreamEvent(AGENT_ID, {
      epoch: "epoch-1",
      seq: 5,
      timestamp: new Date(),
      event: {
        type: "timeline",
        provider: "mock",
        item: { type: "user_message", text: "live before hydration", messageId: "live-user" },
      },
    });
    owner.flushStreamAgent(AGENT_ID);
    owner.applyTimelineResponse(retentionPage(1, 4, false));
    const session = useSessionStore.getState().sessions[SERVER_ID];
    expect([
      ...(session.agentStreamTail.get(AGENT_ID) ?? []),
      ...(session.agentStreamHead.get(AGENT_ID) ?? []),
    ]).toContainEqual(expect.objectContaining({ text: "live before hydration" }));
    expect(session.agentTimelineCursor.get(AGENT_ID)?.endSeq).toBe(4);
    owner.dispose();
  });

  it("forgets discarded coverage when resume replaces the retained tail", () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    const owner = createOwner({
      readTimeline: async () => undefined,
      commitTimeline: () => undefined,
    });
    owner.applyTimelineResponse(retentionPage(1, 46, false));
    owner.applyTimelineResponse({ ...retentionPage(15, 54, true), reset: true });
    const session = useSessionStore.getState().sessions[SERVER_ID];
    expect(session.agentTimelineCursor.get(AGENT_ID)).toEqual({
      epoch: "epoch-1",
      startSeq: 15,
      endSeq: 54,
    });
    expect(session.agentTimelineHasOlder.get(AGENT_ID)).toBe(true);
    owner.dispose();
  });

  it("applies and persists authoritative pages inside the owner", () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    const keys: string[] = [];
    const owner = createOwner({
      readTimeline: async () => undefined,
      commitTimeline: (_serverId, agentId) => keys.push(agentId),
    });

    owner.applyTimelineResponse({
      requestId: "page-1",
      agentId: AGENT_ID,
      agent: null,
      direction: "tail",
      projection: "projected",
      reset: false,
      epoch: "epoch-1",
      window: { minSeq: 1, maxSeq: 0, nextSeq: 1 },
      startCursor: null,
      endCursor: null,
      entries: [],
      error: null,
      hasNewer: false,
      hasOlder: false,
      staleCursor: false,
      gap: false,
    });

    expect(
      selectAgentTimelineState(useSessionStore.getState().sessions[SERVER_ID], AGENT_ID),
    ).toMatchObject({ status: "synced" });
    expect(keys).toEqual([AGENT_ID]);
    owner.dispose();
  });

  it.each([false, true])(
    "derives context-only older availability from real owner coverage (cached=%s)",
    async (cached) => {
      useSessionStore.getState().initializeSession(SERVER_ID, null);
      const owner = createOwner({
        readTimeline: async () => (cached ? cachedTimeline() : undefined),
        commitTimeline: () => undefined,
      });
      owner.replaceVisibleAgentIds("test", [AGENT_ID]);
      if (cached)
        await expect
          .poll(
            () =>
              selectAgentTimelineState(useSessionStore.getState().sessions[SERVER_ID], AGENT_ID)
                .status,
          )
          .toBe("painted");
      owner.applyTimelineResponse({
        requestId: "context-only",
        agentId: AGENT_ID,
        agent: null,
        direction: "tail",
        projection: "projected",
        pagingMode: "source_ranges",
        epoch: "epoch-1",
        reset: false,
        staleCursor: false,
        gap: false,
        window: { minSeq: 1, maxSeq: 100, nextSeq: 101 },
        startCursor: { epoch: "epoch-1", seq: 100 },
        endCursor: { epoch: "epoch-1", seq: 100 },
        hasOlder: true,
        hasNewer: false,
        entries: [],
        contextEntries: [
          {
            provider: "codex",
            timestamp: new Date().toISOString(),
            seqStart: 1,
            seqEnd: 100,
            sourceSeqRanges: [
              { startSeq: 1, endSeq: 1 },
              { startSeq: 100, endSeq: 100 },
            ],
            collapsed: ["tool_lifecycle"],
            item: {
              type: "tool_call",
              callId: "ancient",
              name: "shell",
              status: "completed",
              detail: { type: "unknown", input: {}, output: null },
              error: null,
            },
          },
        ],
        error: null,
      });
      const session = useSessionStore.getState().sessions[SERVER_ID];
      expect(session.agentTimelineHasOlder.get(AGENT_ID)).toBe(true);
      expect(session.agentTimelineCursor.get(AGENT_ID)).toMatchObject({
        startSeq: 100,
        endSeq: 100,
      });
      expect(
        session.agentStreamTail.get(AGENT_ID)?.filter((entry) => entry.kind === "tool_call"),
      ).toHaveLength(1);
      owner.dispose();
    },
  );

  it("evicts whole pages before committing later history and preserves the pinned reading page", () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    const budget = new TimelinePageRetention({
      sessionBytes: 3000,
      totalBytes: 4000,
      pageMetadataBytes: 0,
    });
    const owner = createOwner(
      { readTimeline: async () => undefined, commitTimeline: () => undefined },
      budget,
    );
    owner.replaceVisibleAgentIds("test", [AGENT_ID]);
    const page = (seq: number) => ({
      requestId: `${seq}`,
      agentId: AGENT_ID,
      agent: null,
      direction: "tail" as const,
      projection: "projected" as const,
      pagingMode: "source_ranges" as const,
      epoch: "epoch-1",
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: 1, maxSeq: seq, nextSeq: seq + 1 },
      startCursor: { epoch: "epoch-1", seq },
      endCursor: { epoch: "epoch-1", seq },
      hasOlder: seq > 1,
      hasNewer: false,
      entries: [
        {
          provider: "codex" as const,
          timestamp: new Date(1000 + seq).toISOString(),
          seqStart: seq,
          seqEnd: seq,
          sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
          collapsed: [],
          item: { type: "assistant_message" as const, text: "x".repeat(250), messageId: `${seq}` },
        },
      ],
      error: null,
    });
    owner.applyTimelineResponse(page(1));
    owner.reportReadingPosition?.(AGENT_ID, "1");
    owner.applyTimelineResponse({ ...page(2), direction: "after" });
    owner.applyTimelineResponse({ ...page(3), direction: "after" });
    const session = useSessionStore.getState().sessions[SERVER_ID];
    expect(budget.retainedBytes).toBeLessThanOrEqual(3000);
    expect(session.agentStreamTail.get(AGENT_ID)?.some((entry) => entry.id === "1")).toBe(true);
    const range = session.agentTimelineCursor.get(AGENT_ID)!;
    expect(range.endSeq).toBe(3);
    expect(range.startSeq).toBeGreaterThan(1);
    expect(range.retainedRanges).toEqual([{ startSeq: 1, endSeq: 1, hasOlder: false }]);
    owner.dispose();
    expect(budget.retainedBytes).toBe(0);
  });

  it("prefetches one adjacent owner page and rejects its late reply after another host exhausts the budget", () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    const budget = new TimelinePageRetention({
      sessionBytes: 200_000,
      totalBytes: 200_000,
      pageMetadataBytes: 0,
    });
    const requests: Array<
      Parameters<NonNullable<ViewedTimelineOwnerPorts["fetchAdjacentPage"]>>[1]
    > = [];
    const owner = createOwner(
      { readTimeline: async () => undefined, commitTimeline: () => undefined },
      budget,
      {
        fetchAdjacentPage: (_id, request) => {
          requests.push(request);
          return new Promise(() => undefined);
        },
      },
    );
    owner.replaceVisibleAgentIds("test", [AGENT_ID]);
    owner.setConnected(true);
    const page = {
      requestId: "initial",
      agentId: AGENT_ID,
      agent: null,
      direction: "tail" as const,
      projection: "projected" as const,
      pagingMode: "source_ranges" as const,
      epoch: "epoch-1",
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: 1, maxSeq: 80, nextSeq: 81 },
      startCursor: { epoch: "epoch-1", seq: 41 },
      endCursor: { epoch: "epoch-1", seq: 80 },
      hasOlder: true,
      hasNewer: false,
      error: null,
      entries: Array.from({ length: 40 }, (_, index) => ({
        provider: "codex" as const,
        timestamp: new Date(1000 + index).toISOString(),
        seqStart: 41 + index,
        seqEnd: 41 + index,
        sourceSeqRanges: [{ startSeq: 41 + index, endSeq: 41 + index }],
        collapsed: [],
        item: {
          type: "assistant_message" as const,
          text: `row ${41 + index}`,
          messageId: `row-${41 + index}`,
        },
      })),
    };
    owner.applyTimelineResponse(page);
    owner.reportReadingPosition?.(AGENT_ID, "row-70");
    owner.reportReadingPosition?.(AGENT_ID, "row-43");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      direction: "before",
      cursor: { epoch: "epoch-1", seq: 41 },
    });
    const removeOther = budget.register("other-host", () => undefined);
    const release = budget.reserve("other-host", 200_000 - budget.retainedBytes - 1);
    expect(release).not.toBeNull();
    expect(requests[0].signal.aborted).toBe(true);
    const before = useSessionStore.getState().sessions[SERVER_ID].agentTimelineCursor.get(AGENT_ID);
    owner.applyTimelineResponse({
      ...page,
      requestId: requests[0].requestId,
      direction: "before",
      startCursor: { epoch: "epoch-1", seq: 1 },
    });
    expect(
      useSessionStore.getState().sessions[SERVER_ID].agentTimelineCursor.get(AGENT_ID),
    ).toEqual(before);
    release?.();
    removeOther();
    owner.dispose();
    expect(budget.retainedBytes).toBe(0);
  });

  it("refreshes deferred snapshots with one coalesced authoritative catch-up without folding raw chunks", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    const requests: Array<{
      request: Parameters<ViewedTimelineOwnerPorts["fetchPage"]>[1];
      resolve: (page: { hasNewer: boolean; endCursor: { epoch: string; seq: number } }) => void;
    }> = [];
    const owner = createOwner(
      { readTimeline: async () => undefined, commitTimeline: () => undefined },
      undefined,
      {
        // Read the applied range like the app's session port. Upstream v0.17 falls back to the
        // latest tail when a gap catch-up has no applied cursor, so an always-undefined stub
        // would skip the coalesced follow-up this test checks.
        readCursor: (agentId) => {
          const timeline = selectAgentTimelineState(
            useSessionStore.getState().sessions[SERVER_ID],
            agentId,
          );
          return timeline.status === "synced" && timeline.range
            ? { epoch: timeline.range.epoch, endSeq: timeline.range.endSeq }
            : undefined;
        },
        fetchPage: (_id, request) =>
          request.direction === "after"
            ? new Promise((resolve) => requests.push({ request, resolve }))
            : Promise.resolve({ hasNewer: false, endCursor: null }),
      },
    );
    owner.replaceVisibleAgentIds("test", [AGENT_ID]);
    owner.setConnected(true);
    await Promise.resolve();
    await Promise.resolve();
    const page = (seq: number, id: string) => ({
      requestId: id,
      agentId: AGENT_ID,
      agent: null,
      direction: "tail" as const,
      projection: "projected" as const,
      pagingMode: "source_ranges" as const,
      epoch: "epoch-1",
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: 1, maxSeq: seq, nextSeq: seq + 1 },
      startCursor: { epoch: "epoch-1", seq },
      endCursor: { epoch: "epoch-1", seq },
      hasOlder: true,
      hasNewer: false,
      error: null,
      entries: [],
      contextEntries: [
        {
          provider: "codex" as const,
          timestamp: new Date().toISOString(),
          seqStart: 1,
          seqEnd: seq,
          sourceSeqRanges: [],
          sourceSeqRangesRef: { id: `ranges-${id}`, count: 200 },
          deferredPayload: { id, byteLength: 100000, format: "timeline_item_json" as const },
          collapsed: [],
          item: { type: "assistant_message" as const, text: "", messageId: "large" },
        },
      ],
    });
    owner.applyTimelineResponse(page(100, "initial"));
    const incoming = (seq: number) => ({
      seq,
      epoch: "epoch-1",
      timestamp: new Date(),
      event: {
        type: "timeline" as const,
        provider: "codex" as const,
        item: {
          type: "assistant_message" as const,
          text: "raw chunk must not fold",
          messageId: "large",
        },
      },
    });
    owner.applyStreamEvent(AGENT_ID, incoming(101));
    owner.applyStreamEvent(AGENT_ID, incoming(102));
    owner.flushStreamAgent(AGENT_ID);
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].request).toMatchObject({
      direction: "after",
      cursor: { epoch: "epoch-1", seq: 100 },
    });
    expect(
      useSessionStore.getState().sessions[SERVER_ID].agentTimelineCursor.get(AGENT_ID)?.endSeq,
    ).toBe(100);
    expect(
      JSON.stringify(useSessionStore.getState().sessions[SERVER_ID].agentStreamTail.get(AGENT_ID)),
    ).not.toContain("raw chunk");
    owner.applyTimelineResponse({ ...page(101, "refreshed"), direction: "after" });
    requests[0].resolve({ hasNewer: false, endCursor: { epoch: "epoch-1", seq: 101 } });
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1].request).toMatchObject({
      direction: "after",
      cursor: { epoch: "epoch-1", seq: 101 },
    });
    owner.applyTimelineResponse({ ...page(102, "current"), direction: "after" });
    requests[1].resolve({ hasNewer: false, endCursor: { epoch: "epoch-1", seq: 102 } });
    await Promise.resolve();
    await Promise.resolve();
    const items = useSessionStore.getState().sessions[SERVER_ID].agentStreamTail.get(AGENT_ID)!;
    expect(items).toHaveLength(1);
    expect(items[0].timelineCursor).toMatchObject({
      seqStart: 1,
      seq: 102,
      sourceSeqRanges: [],
      deferredPayload: { id: "current" },
      sourceSeqRangesRef: { count: 200 },
    });
    expect(requests).toHaveLength(2);
    owner.dispose();
  });

  it("resumes a hot agent that dropped live events while hidden with one bounded page", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    const requests: { agentId: string; direction: string; seq?: number }[] = [];
    const requestsFor = (agentId: string) => requests.filter((r) => r.agentId === agentId);
    let latestTails = 0;
    const owner = createOwner(
      { readTimeline: async () => undefined, commitTimeline: () => undefined },
      undefined,
      {
        initialDeliveryMode: "selective",
        readCursor: (agentId) => {
          const range = useSessionStore
            .getState()
            .sessions[SERVER_ID]?.agentTimelineCursor.get(agentId);
          return range ? { epoch: range.epoch, endSeq: range.endSeq } : undefined;
        },
        fetchPage: async (agentId, request) => {
          const seq = request.direction === "after" ? request.cursor.seq : undefined;
          requests.push({ agentId, direction: request.direction, ...(seq ? { seq } : {}) });
          // Hundreds of rows arrived while hidden: the first resume page is not the end.
          return seq === 8
            ? { hasNewer: true, endCursor: { epoch: "epoch-1", seq: 48 } }
            : { hasNewer: false, endCursor: null };
        },
        fetchLatestTail: async () => {
          latestTails += 1;
          return { hasNewer: false, endCursor: null };
        },
      },
    );
    owner.setConnected(true);
    owner.replaceVisibleAgentIds("workspace", [AGENT_ID]);
    await expect.poll(() => requestsFor(AGENT_ID)).toHaveLength(1);
    applySynced(AGENT_ID, 8);
    owner.replaceVisibleAgentIds("workspace", ["other-agent"]);
    await expect.poll(() => requestsFor("other-agent")).toHaveLength(1);

    owner.applyStreamEvent(AGENT_ID, {
      event: {
        type: "timeline",
        provider: "codex",
        item: { type: "assistant_message", text: "while hidden", messageId: "9" },
      },
      seq: 9,
      epoch: "epoch-1",
      timestamp: new Date(),
    });
    owner.replaceVisibleAgentIds("workspace", [AGENT_ID]);

    await expect.poll(() => latestTails).toBe(1);
    expect(requestsFor(AGENT_ID).slice(1)).toEqual([
      { agentId: AGENT_ID, direction: "after", seq: 8 },
    ]);
    owner.dispose();
  });

  it("reopens a left session instantly within five minutes and refetches it after release", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    let releaseHidden: (() => void) | null = null;
    const budget = new TimelinePageRetention(
      { sessionBytes: 1_000_000, totalBytes: 2_000_000, pageMetadataBytes: 0 },
      {
        ttlMs: 5 * 60 * 1000,
        schedule: (release) => {
          releaseHidden = release;
          return () => {
            if (releaseHidden === release) releaseHidden = null;
          };
        },
      },
    );
    const requests: string[] = [];
    const owner = createOwner(
      { readTimeline: async () => undefined, commitTimeline: () => undefined },
      budget,
      {
        initialDeliveryMode: "selective",
        readCursor: (agentId) => {
          const range = useSessionStore
            .getState()
            .sessions[SERVER_ID]?.agentTimelineCursor.get(agentId);
          return range ? { epoch: range.epoch, endSeq: range.endSeq } : undefined;
        },
        fetchPage: async (agentId, request) => {
          requests.push(`${agentId}:${request.direction}`);
          return { hasNewer: false, endCursor: null };
        },
      },
    );
    const rowIds = () => {
      const timeline = selectAgentTimelineState(
        useSessionStore.getState().sessions[SERVER_ID],
        AGENT_ID,
      );
      return timeline.status === "cold" ? [] : timeline.items.map((row) => row.id);
    };
    owner.setConnected(true);
    owner.replaceVisibleAgentIds("workspace", [AGENT_ID]);
    await expect.poll(() => requests).toEqual([`${AGENT_ID}:tail`]);
    owner.applyTimelineResponse(retentionPage(1, 3, false));

    owner.replaceVisibleAgentIds("workspace", []);
    owner.replaceVisibleAgentIds("workspace", [AGENT_ID]);
    await Promise.resolve();
    expect(requests).toEqual([`${AGENT_ID}:tail`]);
    expect(rowIds()).toHaveLength(3);

    owner.replaceVisibleAgentIds("workspace", []);
    expect(releaseHidden).not.toBeNull();
    releaseHidden!();
    expect(rowIds()).toEqual([]);
    expect(budget.retainedBytes).toBeLessThan(1_000);

    owner.replaceVisibleAgentIds("workspace", [AGENT_ID]);
    await expect.poll(() => requests).toEqual([`${AGENT_ID}:tail`, `${AGENT_ID}:tail`]);
    owner.dispose();
  });

  it("does not retain hidden legacy broadcasts or certify their cursors", () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    applySynced(AGENT_ID, 8);
    const owner = createOwner({
      readTimeline: async () => undefined,
      commitTimeline: () => undefined,
    });
    owner.replaceVisibleAgentIds("test", ["other-agent"]);
    for (let seq = 9; seq < 109; seq += 1)
      owner.applyStreamEvent(AGENT_ID, {
        event: {
          type: "timeline",
          provider: "codex",
          item: { type: "assistant_message", text: "hidden", messageId: `${seq}` },
        },
        seq,
        epoch: "epoch-1",
        timestamp: new Date(),
      });
    owner.flushStreamAgent(AGENT_ID);
    const session = useSessionStore.getState().sessions[SERVER_ID];
    expect(session.agentTimelineCursor.get(AGENT_ID)?.endSeq).toBe(8);
    expect(session.agentStreamTail.get(AGENT_ID)).toHaveLength(1);
    expect(session.agentStreamHead.get(AGENT_ID)).toBeUndefined();
    owner.dispose();
  });

  it("persists demanded agents independently", () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    const keys: string[] = [];
    const owner = createOwner({
      readTimeline: async () => undefined,
      commitTimeline: (_serverId, agentId) => keys.push(agentId),
    });

    applySynced(AGENT_ID, 8);
    applySynced("agent-2", 3);
    owner.replaceVisibleAgentIds("test", [AGENT_ID, "agent-2"]);
    for (const [agentId, seq] of [
      [AGENT_ID, 9],
      ["agent-2", 4],
    ] as const) {
      owner.applyStreamEvent(agentId, {
        event: {
          type: "timeline",
          provider: "codex",
          item: { type: "assistant_message", text: agentId, messageId: `live-${agentId}` },
        } as AgentStreamEventPayload,
        seq,
        epoch: "epoch-1",
        timestamp: new Date("2026-08-26T10:00:01.000Z"),
      });
      owner.flushStreamAgent(agentId);
    }

    expect(keys).toEqual([AGENT_ID, "agent-2"]);
    owner.dispose();
  });
});

describe("turn boundaries", () => {
  it("commits a turn's final reply before the turn stops running", () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    applySynced(AGENT_ID, 8);
    const committedKinds = () => {
      const session = useSessionStore.getState().sessions[SERVER_ID];
      return [
        ...(session?.agentStreamTail.get(AGENT_ID) ?? []),
        ...(session?.agentStreamHead.get(AGENT_ID) ?? []),
      ]
        .filter((entry) => entry.id !== `network-${AGENT_ID}`)
        .map((entry) => entry.kind);
    };
    const livenessChanges: { type: string; committed: string[] }[] = [];
    const owner = createLivenessOwner(
      { readTimeline: async () => undefined, commitTimeline: () => undefined },
      (_agentId, transitions) => {
        for (const transition of transitions) {
          livenessChanges.push({ type: transition.type, committed: committedKinds() });
        }
      },
    );
    // Clisbot applies live events only for a chat on screen (hidden agents catch up on return).
    owner.replaceVisibleAgentIds("test", [AGENT_ID]);
    const at = (second: number) => new Date(`2026-08-26T10:00:0${second}.000Z`);

    // One frame's worth of live events: the frame flush that would commit them never runs.
    owner.applyStreamEvent(AGENT_ID, {
      event: { type: "turn_started", provider: "codex", turnId: "turn-1" },
      seq: undefined,
      epoch: undefined,
      timestamp: at(1),
    });
    owner.applyStreamEvent(AGENT_ID, {
      event: {
        type: "timeline",
        provider: "codex",
        turnId: "turn-1",
        item: {
          type: "tool_call",
          callId: "call-1",
          name: "Bash",
          status: "completed",
          error: null,
          detail: { type: "shell", command: "ls" },
        },
      } as AgentStreamEventPayload,
      seq: 9,
      epoch: "epoch-1",
      timestamp: at(2),
    });
    owner.applyStreamEvent(AGENT_ID, {
      event: {
        type: "timeline",
        provider: "codex",
        turnId: "turn-1",
        item: { type: "assistant_message", text: "Done.", messageId: "reply-1" },
      } as AgentStreamEventPayload,
      seq: 10,
      epoch: "epoch-1",
      timestamp: at(3),
    });
    owner.applyStreamEvent(AGENT_ID, {
      event: { type: "turn_completed", provider: "codex", turnId: "turn-1" },
      seq: undefined,
      epoch: undefined,
      timestamp: at(4),
    });

    expect(livenessChanges.at(-1)).toEqual({
      type: "stream_close",
      committed: ["tool_call", "assistant_message"],
    });
    owner.dispose();
  });
});

describe("the turn footer changes together with its messages", () => {
  const OPEN_TURN = { turnId: "turn-1", startedAt: new Date("2026-08-26T09:59:00.000Z") };

  function setTurn(transition: TurnLivenessTransition): void {
    useSessionStore.getState().setAgents(SERVER_ID, (agents) => {
      const agent =
        agents.get(AGENT_ID) ??
        ({
          id: AGENT_ID,
          turn: { phase: "idle", cancellationRequestId: null },
        } as Agent);
      const next = new Map(agents);
      next.set(AGENT_ID, { ...agent, turn: reduceTurnLiveness(agent.turn, transition) });
      return next;
    });
  }
  const agentIsRunning = () => setTurn({ type: "snapshot", activeTurn: OPEN_TURN });
  const idleSnapshotArrives = () => setTurn({ type: "snapshot", activeTurn: null });

  type Footer = "running" | "settled";
  function footer(): Footer {
    const session = useSessionStore.getState().sessions[SERVER_ID];
    const turn = selectAgentTimelineTurnPresentation(session, AGENT_ID);
    return turn.isActive ? "running" : "settled";
  }
  function timerStart(): Date | null {
    const session = useSessionStore.getState().sessions[SERVER_ID];
    return selectAgentTimelineTurnPresentation(session, AGENT_ID).startedAt;
  }
  function replies(): string[] {
    const session = useSessionStore.getState().sessions[SERVER_ID];
    return [
      ...(session?.agentStreamTail.get(AGENT_ID) ?? []),
      ...(session?.agentStreamHead.get(AGENT_ID) ?? []),
    ]
      .filter((entry) => entry.kind === "assistant_message")
      .map((entry) => entry.text);
  }

  // A chat that was current when the connection dropped, holding `cachedReply` if given.
  function createChat(
    cachedReply: string | null,
    fetchPage?: ViewedTimelineOwnerPorts["fetchPage"],
  ): ViewedTimelineOwner {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    useSessionStore.getState().applyAgentTimelineResponseState(SERVER_ID, AGENT_ID, {
      items: cachedReply ? [item("reply-1", cachedReply, 4)] : [],
      head: [],
      range: { epoch: "epoch-1", startSeq: 1, endSeq: 4 },
      older: "none",
      newer: false,
      synchronized: true,
      acknowledgedClientMessageIds: [],
    });
    return createLivenessOwner(
      { readTimeline: async () => undefined, commitTimeline: () => undefined },
      undefined,
      fetchPage,
    );
  }

  async function connectAndCatchUp(owner: ViewedTimelineOwner): Promise<void> {
    owner.replaceVisibleAgentIds("test", [AGENT_ID]);
    owner.setConnected(true);
    await expect.poll(() => owner.getAgentTimelineStatus(AGENT_ID)).toBe("ready");
  }

  function catchUpPage(input: {
    replyThroughSeq: number | null;
    reply?: string;
  }): TimelineResponsePayload {
    const end = input.replyThroughSeq ?? 4;
    return {
      requestId: "catch-up",
      agentId: AGENT_ID,
      agent: null,
      direction: "after",
      projection: "projected",
      reset: false,
      epoch: "epoch-1",
      window: { minSeq: 1, maxSeq: end, nextSeq: end + 1 },
      startCursor: input.reply ? { epoch: "epoch-1", seq: 5 } : null,
      endCursor: input.reply ? { epoch: "epoch-1", seq: end } : null,
      entries: input.reply
        ? [
            {
              provider: "mock",
              item: { type: "assistant_message", text: input.reply },
              timestamp: "2026-08-26T10:00:02.000Z",
              seqStart: 5,
              seqEnd: end,
              sourceSeqRanges: [{ startSeq: 5, endSeq: end }],
              collapsed: [],
            },
          ]
        : [],
      error: null,
      hasNewer: false,
      hasOlder: false,
      staleCursor: false,
      gap: false,
    };
  }

  function recordCommits(): { commits: { footer: Footer; replies: string[] }[]; stop(): void } {
    const commits: { footer: Footer; replies: string[] }[] = [
      { footer: footer(), replies: replies() },
    ];
    const stop = useSessionStore.subscribe(() => {
      commits.push({ footer: footer(), replies: replies() });
    });
    return { commits, stop };
  }

  it.each([
    ["only the prompt cached", null, ["Done."]],
    ["a partial reply cached", "Half", ["HalfDone."]],
  ])("snapshot before messages, %s: running until messages land", async (_name, cached, final) => {
    const owner = createChat(cached);
    agentIsRunning();
    await connectAndCatchUp(owner);
    expect(footer()).toBe("running");

    owner.setConnected(false);
    expect(footer()).toBe("running");
    owner.setConnected(true);
    const recorder = recordCommits();

    idleSnapshotArrives();
    expect(footer()).toBe("running");

    owner.applyTimelineResponse(catchUpPage({ replyThroughSeq: 8, reply: "Done." }));
    recorder.stop();

    expect(footer()).toBe("settled");
    expect(replies()).toEqual(final);
    // The messages and the settled footer arrive in one commit, with no state between.
    const previous = recorder.commits.at(-2);
    expect(previous?.footer).toBe("running");
    expect(previous?.replies).not.toEqual(final);
    expect(
      recorder.commits.filter(
        (commit) => commit.footer === "settled" && commit.replies.join() !== final.join(),
      ),
    ).toEqual([]);
    owner.dispose();
  });

  it("messages before snapshot: running stays until the idle snapshot, then completes", async () => {
    const owner = createChat("Half");
    agentIsRunning();
    await connectAndCatchUp(owner);
    owner.setConnected(false);
    owner.setConnected(true);

    owner.applyTimelineResponse(catchUpPage({ replyThroughSeq: 8, reply: "Done." }));
    expect(replies()).toEqual(["HalfDone."]);
    expect(footer()).toBe("running");

    idleSnapshotArrives();
    expect(footer()).toBe("settled");
    owner.dispose();
  });

  it("a turn that ended with no new messages settles when the empty catch-up lands", async () => {
    const owner = createChat("Done.");
    agentIsRunning();
    await connectAndCatchUp(owner);
    owner.setConnected(false);
    owner.setConnected(true);
    idleSnapshotArrives();
    expect(footer()).toBe("running");

    owner.applyTimelineResponse(catchUpPage({ replyThroughSeq: null }));

    expect(footer()).toBe("settled");
    expect(replies()).toEqual(["Done."]);
    owner.dispose();
  });

  it("keeps the true idle status for every surface outside the timeline", async () => {
    const owner = createChat("Half");
    agentIsRunning();
    await connectAndCatchUp(owner);
    owner.setConnected(false);
    owner.setConnected(true);
    idleSnapshotArrives();

    expect(footer()).toBe("running");
    const session = useSessionStore.getState().sessions[SERVER_ID];
    expect(selectAgentTurnPresentation(session, AGENT_ID).isActive).toBe(false);
    owner.dispose();
  });

  it("keeps the running turn's identity and timer start when the idle status arrives", async () => {
    const owner = createChat("Half");
    agentIsRunning();
    await connectAndCatchUp(owner);
    owner.setConnected(false);
    owner.setConnected(true);
    idleSnapshotArrives();

    const session = useSessionStore.getState().sessions[SERVER_ID];
    expect(selectAgentTimelineTurnPresentation(session, AGENT_ID)).toEqual({
      isActive: true,
      isCancelling: false,
      startedAt: OPEN_TURN.startedAt,
      turnId: "turn-1",
    });
    owner.dispose();
  });

  it("an agent still running on return keeps its running footer", async () => {
    const owner = createChat("Half");
    agentIsRunning();
    await connectAndCatchUp(owner);
    owner.setConnected(false);
    owner.setConnected(true);
    agentIsRunning();

    expect(footer()).toBe("running");
    owner.applyTimelineResponse(catchUpPage({ replyThroughSeq: 6, reply: " more" }));
    expect(footer()).toBe("running");
    owner.dispose();
  });

  it("applies a snapshot at once when the chat is current", async () => {
    const owner = createChat("Done.");
    agentIsRunning();
    await connectAndCatchUp(owner);

    idleSnapshotArrives();

    expect(footer()).toBe("settled");
    owner.dispose();
  });

  it("a reconnect that finds nothing changed never leaves the settled footer", async () => {
    const owner = createChat("Done.");
    await connectAndCatchUp(owner);
    const recorder = recordCommits();

    owner.setConnected(false);
    owner.setConnected(true);
    idleSnapshotArrives();
    owner.applyTimelineResponse(catchUpPage({ replyThroughSeq: null }));
    recorder.stop();

    expect(recorder.commits.map((commit) => commit.footer)).not.toContain("running");
    owner.dispose();
  });

  type Answer = "current" | "behind";

  // A chat whose subscribes wait for the test to answer them, and whose fetches are recorded.
  function createCheckedChat(cachedReply: string | null) {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    useSessionStore.getState().applyAgentTimelineResponseState(SERVER_ID, AGENT_ID, {
      items: cachedReply ? [item("reply-1", cachedReply, 4)] : [],
      head: [],
      range: { epoch: "epoch-1", startSeq: 1, endSeq: 4 },
      older: "none",
      newer: false,
      synchronized: true,
      acknowledgedClientMessageIds: [],
    });
    const unanswered: ((answer: Answer, beforeAnswer?: () => void) => void)[] = [];
    let fetches = 0;
    let finishFetch = () => {};
    const owner = createLivenessOwner(
      { readTimeline: async () => undefined, commitTimeline: () => undefined },
      undefined,
      () => {
        fetches += 1;
        return new Promise((resolve) => {
          finishFetch = () => resolve({ hasNewer: false, endCursor: null });
        });
      },
      () => ({
        // The host runtime keeps the answer's agent rows in this same continuation.
        ready: new Promise((resolve) => {
          unanswered.push((answer, beforeAnswer) => {
            beforeAnswer?.();
            resolve({ timelines: { [AGENT_ID]: answer } });
          });
        }),
        release: async () => undefined,
      }),
      true,
    );
    const answer = async (value: Answer, beforeAnswer?: () => void) => {
      await expect.poll(() => unanswered.length).toBeGreaterThan(0);
      unanswered.shift()?.(value, beforeAnswer);
    };
    const open = async () => {
      owner.replaceVisibleAgentIds("test", [AGENT_ID]);
      owner.setConnected(true);
      await answer("current");
      await expect.poll(() => owner.getAgentTimelineStatus(AGENT_ID)).toBe("ready");
    };
    return { owner, answer, open, fetchCount: () => fetches, finishFetch: () => finishFetch() };
  }

  function leaveAndReturn(owner: ViewedTimelineOwner, way: "reconnect" | "foreground"): void {
    if (way === "reconnect") {
      owner.setConnected(false);
      owner.setConnected(true);
      return;
    }
    owner.setActive(false);
    owner.setActive(true);
  }

  it.each([
    ["reconnect", "reattaching"],
    ["foreground", "checking"],
  ] as const)(
    "freshness check on %s: the held turn stays through the check and current settles it",
    async (way, status) => {
      const chat = createCheckedChat("Done.");
      agentIsRunning();
      await chat.open();

      leaveAndReturn(chat.owner, way);
      idleSnapshotArrives();
      expect(chat.owner.getAgentTimelineStatus(AGENT_ID)).toBe(status);
      expect(footer()).toBe("running");

      const recorder = recordCommits();
      await chat.answer("current");
      await expect.poll(() => chat.owner.getAgentTimelineStatus(AGENT_ID)).toBe("ready");
      recorder.stop();

      expect(footer()).toBe("settled");
      expect(replies()).toEqual(["Done."]);
      expect(chat.fetchCount()).toBe(0);
      expect(recorder.commits.map((commit) => commit.footer).slice(0, 2)).toEqual([
        "running",
        "settled",
      ]);
      chat.owner.dispose();
    },
  );

  it("freshness check: an idle row carried by the current answer settles the footer in the same step", async () => {
    const chat = createCheckedChat("Done.");
    agentIsRunning();
    await chat.open();
    leaveAndReturn(chat.owner, "reconnect");

    let footerAfterRow: Footer | null = null;
    await chat.answer("current", () => {
      idleSnapshotArrives();
      footerAfterRow = footer();
    });
    await expect.poll(() => chat.owner.getAgentTimelineStatus(AGENT_ID)).toBe("ready");

    expect(footerAfterRow).toBe("running");
    expect(footer()).toBe("settled");
    chat.owner.dispose();
  });

  it("freshness check: an agent still running keeps its footer after current", async () => {
    const chat = createCheckedChat("Half");
    agentIsRunning();
    await chat.open();
    leaveAndReturn(chat.owner, "reconnect");

    await chat.answer("current");
    await expect.poll(() => chat.owner.getAgentTimelineStatus(AGENT_ID)).toBe("ready");

    expect(footer()).toBe("running");
    idleSnapshotArrives();
    expect(footer()).toBe("settled");
    chat.owner.dispose();
  });

  it("captures a turn that started while the initial timeline check was pending", () => {
    const chat = createCheckedChat("Half");
    chat.owner.replaceVisibleAgentIds("test", [AGENT_ID]);
    chat.owner.setConnected(true);
    agentIsRunning();
    leaveAndReturn(chat.owner, "reconnect");
    idleSnapshotArrives();

    expect(footer()).toBe("running");
    chat.owner.dispose();
  });

  it("freshness check: behind holds the turn until the fetched rows land with the completed footer", async () => {
    const chat = createCheckedChat("Half");
    agentIsRunning();
    await chat.open();
    leaveAndReturn(chat.owner, "reconnect");
    idleSnapshotArrives();

    await chat.answer("behind");
    await expect.poll(() => chat.fetchCount()).toBe(1);
    expect(footer()).toBe("running");

    const recorder = recordCommits();
    chat.owner.applyTimelineResponse(catchUpPage({ replyThroughSeq: 8, reply: "Done." }));
    recorder.stop();

    expect(footer()).toBe("settled");
    expect(replies()).toEqual(["HalfDone."]);
    expect(recorder.commits.at(-2)).toMatchObject({ footer: "running", replies: ["Half"] });
    expect(recorder.commits.at(-1)).toMatchObject({ footer: "settled", replies: ["HalfDone."] });
    chat.finishFetch();
    await expect.poll(() => chat.owner.getAgentTimelineStatus(AGENT_ID)).toBe("ready");
    chat.owner.dispose();
  });

  it("catch-up failure gives the footer the true status", async () => {
    let failNext = false;
    const owner = createChat("Half", async () => {
      if (failNext) throw new Error("catch-up failed");
      return { hasNewer: false, endCursor: null };
    });
    agentIsRunning();
    await connectAndCatchUp(owner);
    failNext = true;
    owner.setConnected(false);
    owner.setConnected(true);
    idleSnapshotArrives();

    await expect.poll(() => owner.getAgentTimelineStatus(AGENT_ID)).toBe("error");

    expect(footer()).toBe("settled");
    owner.dispose();
  });

  it("a catch-up that completes without a page still releases the footer", async () => {
    const owner = createChat("Half");
    agentIsRunning();
    await connectAndCatchUp(owner);
    owner.setConnected(false);
    idleSnapshotArrives();
    expect(footer()).toBe("running");

    owner.setConnected(true);

    await expect.poll(() => owner.getAgentTimelineStatus(AGENT_ID)).toBe("ready");
    expect(footer()).toBe("settled");
    owner.dispose();
  });

  it("a chat closed while running and reopened after it finished keeps the running footer", async () => {
    const owner = createChat("Half");
    agentIsRunning();
    await connectAndCatchUp(owner);
    owner.replaceVisibleAgentIds("test", []);
    owner.replaceOpenTabAgentIds([]);
    idleSnapshotArrives();

    owner.replaceVisibleAgentIds("test", [AGENT_ID]);
    expect(footer()).toBe("running");

    owner.applyTimelineResponse(catchUpPage({ replyThroughSeq: 8, reply: "Done." }));
    expect(footer()).toBe("settled");
    owner.dispose();
  });

  it.each([
    { host: "that reports turn ids", olderTurnId: "turn-1", newerTurnId: "turn-2" },
    { host: "without turn ids", olderTurnId: null, newerTurnId: null },
  ])("on a host $host, a newer turn replaces the held one so the timer follows it", async (ids) => {
    const newerTurn = { turnId: ids.newerTurnId, startedAt: new Date("2026-08-26T09:59:30.000Z") };
    const owner = createChat("Half");
    setTurn({
      type: "snapshot",
      activeTurn: { turnId: ids.olderTurnId, startedAt: OPEN_TURN.startedAt },
    });
    await connectAndCatchUp(owner);
    owner.replaceVisibleAgentIds("test", []);
    owner.replaceOpenTabAgentIds([]);
    idleSnapshotArrives();

    setTurn({ type: "snapshot", activeTurn: newerTurn });
    owner.replaceVisibleAgentIds("test", [AGENT_ID]);
    idleSnapshotArrives();

    expect(footer()).toBe("running");
    expect(timerStart()).toEqual(newerTurn.startedAt);
    owner.dispose();
  });

  function paintChat(unsettledTurn: CachedTimeline["unsettledTurn"]): ViewedTimelineOwner {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    idleSnapshotArrives();
    return createOwner({
      readTimeline: async () => ({
        agentId: AGENT_ID,
        items: [item("reply-1", "Half", 4)],
        range: { epoch: "epoch-1", startSeq: 1, endSeq: 4 },
        hasOlder: false,
        ...(unsettledTurn ? { unsettledTurn } : {}),
      }),
      commitTimeline: () => undefined,
    });
  }

  it("first paint from cache: shows the running footer in the first frame when the cached messages were from an open turn", async () => {
    const owner = paintChat({ turnId: "turn-1", startedAt: OPEN_TURN.startedAt });
    const recorder = recordCommits();

    owner.replaceVisibleAgentIds("test", [AGENT_ID]);
    await expect.poll(() => replies()).toEqual(["Half"]);
    recorder.stop();

    expect(recorder.commits.find((commit) => commit.replies.length > 0)?.footer).toBe("running");
    expect(timerStart()).toEqual(OPEN_TURN.startedAt);
    owner.applyTimelineResponse(catchUpPage({ replyThroughSeq: 8, reply: "Done." }));
    expect(footer()).toBe("settled");
    owner.dispose();
  });

  async function subscriptionRefusedDuringCacheRead(): Promise<{
    owner: ViewedTimelineOwner;
    finishCacheRead(): void;
  }> {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    idleSnapshotArrives();
    let resolveRead: (timeline: CachedTimeline) => void = () => undefined;
    const owner = createLivenessOwner(
      {
        readTimeline: () => new Promise((resolve) => (resolveRead = resolve)),
        commitTimeline: () => undefined,
      },
      undefined,
      undefined,
      () => ({
        ready: Promise.reject(new Error("subscription refused")),
        release: async () => undefined,
      }),
    );
    owner.replaceVisibleAgentIds("test", [AGENT_ID]);
    owner.setConnected(true);
    await expect.poll(() => owner.getAgentTimelineStatus(AGENT_ID)).toBe("error");
    return {
      owner,
      finishCacheRead: () =>
        resolveRead({
          agentId: AGENT_ID,
          items: [item("reply-1", "Half", 4)],
          range: { epoch: "epoch-1", startSeq: 1, endSeq: 4 },
          hasOlder: false,
          unsettledTurn: { turnId: "turn-1", startedAt: OPEN_TURN.startedAt },
        }),
    };
  }

  it("first paint from cache: a catch-up that failed during the cache read keeps the true status", async () => {
    const { owner, finishCacheRead } = await subscriptionRefusedDuringCacheRead();

    finishCacheRead();
    await expect.poll(() => replies()).toEqual(["Half"]);

    expect(owner.getAgentTimelineStatus(AGENT_ID)).toBe("error");
    expect(footer()).toBe("settled");
    owner.dispose();
  });

  it("first paint from cache: a catch-up owed again during the cache read keeps the running footer", async () => {
    const { owner, finishCacheRead } = await subscriptionRefusedDuringCacheRead();
    owner.setConnected(false);

    finishCacheRead();
    await expect.poll(() => replies()).toEqual(["Half"]);

    expect(footer()).toBe("running");
    owner.dispose();
  });

  it("first paint from cache: shows the settled footer at once when the cached messages were from a finished turn", async () => {
    const owner = paintChat(undefined);

    owner.replaceVisibleAgentIds("test", [AGENT_ID]);
    await expect.poll(() => replies()).toEqual(["Half"]);

    expect(footer()).toBe("settled");
    owner.dispose();
  });

  it("first paint from cache: records the open turn with the messages and drops it once the turn ends", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    applySynced(AGENT_ID, 8);
    agentIsRunning();
    const commits: CachedTimeline[] = [];
    const owner = createLivenessOwner(
      {
        readTimeline: async () => undefined,
        commitTimeline: (_serverId, _agentId, timeline) => commits.push(timeline),
      },
      (_agentId, transitions) => {
        for (const transition of transitions) setTurn(transition);
      },
    );
    // Clisbot applies live events only for a chat on screen; showing it owes a catch-up, which
    // must settle first so the held turn comes from the live turn alone.
    owner.replaceVisibleAgentIds("test", [AGENT_ID]);
    owner.setConnected(true);
    await expect.poll(() => owner.getAgentTimelineStatus(AGENT_ID)).toBe("ready");
    owner.applyStreamEvent(AGENT_ID, {
      event: {
        type: "timeline",
        provider: "codex",
        item: { type: "assistant_message", text: "Working" },
      } as AgentStreamEventPayload,
      seq: 9,
      epoch: "epoch-1",
      timestamp: new Date("2026-08-26T10:00:01.000Z"),
    });
    owner.flushStreamAgent(AGENT_ID);
    expect(commits.at(-1)?.unsettledTurn).toEqual({
      turnId: "turn-1",
      startedAt: expect.any(Date),
    });

    owner.applyStreamEvent(AGENT_ID, {
      event: { type: "turn_completed", provider: "codex", turnId: "turn-1" },
      seq: undefined,
      epoch: undefined,
      timestamp: new Date("2026-08-26T10:00:02.000Z"),
    });

    expect(commits.at(-1)?.unsettledTurn).toBeUndefined();
    owner.dispose();
  });
});

describe("create handoff lifetime", () => {
  const DRAFT_ID = "draft-1";

  afterEach(() => useCreateFlowStore.getState().clearAll());

  function sentCreateHandoff(): void {
    useCreateFlowStore.getState().setPending({
      draftId: DRAFT_ID,
      serverId: SERVER_ID,
      agentId: AGENT_ID,
      clientMessageId: "client-message-1",
      text: "Create this chat.",
      timestamp: 0,
    });
    useCreateFlowStore.getState().markLifecycle({ draftId: DRAFT_ID, lifecycle: "sent" });
  }

  function createHandoff(): PendingCreateAttempt | undefined {
    return useCreateFlowStore.getState().pendingByDraftId[DRAFT_ID];
  }

  function syncedTailPage(): Parameters<ViewedTimelineOwner["applyTimelineResponse"]>[0] {
    return {
      requestId: "tail-1",
      agentId: AGENT_ID,
      agent: null,
      direction: "tail",
      projection: "projected",
      reset: false,
      epoch: "epoch-1",
      window: { minSeq: 1, maxSeq: 0, nextSeq: 1 },
      startCursor: null,
      endCursor: null,
      entries: [],
      error: null,
      hasNewer: false,
      hasOlder: false,
      staleCursor: false,
      gap: false,
    };
  }

  interface HeldCatchUpOwner {
    owner: ViewedTimelineOwner;
    release: () => void;
  }

  async function ownerWithHeldCatchUp(): Promise<HeldCatchUpOwner> {
    let releaseTailFetch!: () => void;
    let tailFetchStarted = false;
    const tailFetched = new Promise<void>((resolve) => {
      releaseTailFetch = resolve;
    });
    const replica = createTimelineReplica({
      serverId: SERVER_ID,
      storage: { readTimeline: async () => undefined, commitTimeline: () => undefined },
      prepareAgent: async () => undefined,
    });
    const owner = createViewedTimelineOwner({
      serverId: SERVER_ID,
      replica,
      replaceDemandedAgentIds: () => undefined,
      drainQueuedAgentMessage: () => undefined,
      applyTurnLiveness: () => undefined,
      ports: {
        canCheckFreshness: () => false,
        observe: () => ({ ready: Promise.resolve(), release: async () => undefined }),
        readCursor: () => undefined,
        fetchPage: async () => {
          tailFetchStarted = true;
          await tailFetched;
          return { hasNewer: false, endCursor: null };
        },
        fetchLatestTail: async () => ({ hasNewer: false, endCursor: null }),
        reportError: () => undefined,
      },
    });

    owner.setConnected(true);
    owner.replaceVisibleAgentIds("test", [AGENT_ID]);
    await expect.poll(() => tailFetchStarted).toBe(true);
    return { owner, release: releaseTailFetch };
  }

  it("keeps the handoff through the first synchronized page and releases it when the chat is current", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    sentCreateHandoff();
    const { owner, release } = await ownerWithHeldCatchUp();

    owner.applyTimelineResponse(syncedTailPage());
    expect(
      selectAgentTimelineState(useSessionStore.getState().sessions[SERVER_ID], AGENT_ID),
    ).toMatchObject({ status: "synced" });
    expect(createHandoff()).toMatchObject({ agentId: AGENT_ID, lifecycle: "sent" });

    release();
    await expect.poll(() => createHandoff()).toBeUndefined();
    owner.dispose();
  });

  it("releases the handoff when the chat's tab closes before catch-up completes", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    sentCreateHandoff();
    const { owner, release } = await ownerWithHeldCatchUp();

    owner.replaceVisibleAgentIds("test", []);
    owner.replaceOpenTabAgentIds([]);

    expect(createHandoff()).toBeUndefined();
    release();
    owner.dispose();
  });
});

describe("a chat that was empty when it went offline", () => {
  const EPOCH = "epoch-1";
  const PROMPT = "stream through a reconnect";
  const THOUGHT = "Thinking before the reply.";
  const TURN_ID = "turn-1";
  const TIMESTAMP = "2026-10-31T10:00:00.000Z";

  /** The daemon's timeline: one row per flushed chunk, read back as projected pages. */
  class DaemonTimeline {
    private readonly rows: Array<{ seq: number; item: AgentTimelineItem }> = [];

    record(timelineItem: AgentTimelineItem): AgentStreamReducerEvent {
      const seq = this.rows.length + 1;
      this.rows.push({ seq, item: timelineItem });
      return {
        event: { type: "timeline", provider: "mock", turnId: TURN_ID, item: timelineItem },
        seq,
        epoch: EPOCH,
        timestamp: new Date(TIMESTAMP),
      };
    }

    page(request: ProjectedTimelineForwardFetchPlan): TimelineResponsePayload {
      const maxSeq = this.rows.at(-1)?.seq ?? 0;
      const after = request.direction === "after" ? request.cursor.seq : 0;
      const entries = this.projected().filter((entry) => entry.seqEnd > after);
      const first = entries[0];
      const startSeq = request.direction === "after" ? after + 1 : first?.seqStart;
      return {
        requestId: `${request.direction}-${after}`,
        agentId: AGENT_ID,
        agent: null,
        direction: request.direction,
        projection: "projected",
        reset: false,
        epoch: EPOCH,
        window: { minSeq: this.rows[0]?.seq ?? 0, maxSeq, nextSeq: maxSeq + 1 },
        startCursor: first && startSeq !== undefined ? { epoch: EPOCH, seq: startSeq } : null,
        endCursor: first ? { epoch: EPOCH, seq: maxSeq } : null,
        entries,
        error: null,
        hasNewer: false,
        hasOlder: after > 0,
        staleCursor: false,
        gap: false,
      };
    }

    /** Contiguous reply and thought chunks read back as one row, like the daemon's projection. */
    private projected(): TimelineResponsePayload["entries"] {
      const entries: TimelineResponsePayload["entries"] = [];
      for (const { seq, item: row } of this.rows) {
        const previous = entries.at(-1);
        const continues =
          previous !== undefined &&
          ((row.type === "assistant_message" &&
            previous.item.type === "assistant_message" &&
            previous.item.messageId === row.messageId) ||
            (row.type === "reasoning" && previous.item.type === "reasoning"));
        if (
          continues &&
          (previous.item.type === "assistant_message" || previous.item.type === "reasoning") &&
          (row.type === "assistant_message" || row.type === "reasoning")
        ) {
          previous.item = { ...previous.item, text: `${previous.item.text}${row.text}` };
          previous.seqEnd = seq;
          previous.sourceSeqRanges = [{ startSeq: previous.seqStart, endSeq: seq }];
          previous.collapsed = [
            row.type === "assistant_message" ? "assistant_merge" : "reasoning_merge",
          ];
          continue;
        }
        entries.push({
          provider: "mock",
          item: row,
          timestamp: TIMESTAMP,
          seqStart: seq,
          seqEnd: seq,
          sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
          collapsed: [],
          turnId: TURN_ID,
        });
      }
      return entries;
    }
  }

  interface PendingFetch {
    request: ProjectedTimelineForwardFetchPlan;
    /** Delivers a page the way the host runtime does: queued live chunks first, then the page. */
    deliver(page: TimelineResponsePayload): void;
  }

  function openChat(storage: TimelineReplicaStorage) {
    const fetches: PendingFetch[] = [];
    const errors: unknown[] = [];
    const fetch = (request: ProjectedTimelineForwardFetchPlan) =>
      new Promise<{ hasNewer: boolean; endCursor: { epoch: string; seq: number } | null }>(
        (resolve) => {
          fetches.push({
            request,
            deliver: (page) => {
              owner.flushStreamAgent(AGENT_ID);
              owner.applyTimelineResponse(page);
              resolve({ hasNewer: page.hasNewer, endCursor: page.endCursor });
            },
          });
        },
      );
    const replica = createTimelineReplica({
      serverId: SERVER_ID,
      storage,
      prepareAgent: async () => undefined,
    });
    const owner = createViewedTimelineOwner({
      serverId: SERVER_ID,
      replica,
      replaceDemandedAgentIds: () => undefined,
      drainQueuedAgentMessage: () => undefined,
      applyTurnLiveness: () => undefined,
      ports: {
        canCheckFreshness: () => true,
        observe: () => ({ ready: Promise.resolve(), release: async () => undefined }),
        readCursor: (agentId) => {
          const timeline = selectAgentTimelineState(
            useSessionStore.getState().sessions[SERVER_ID],
            agentId,
          );
          return timeline.status === "synced" && timeline.range
            ? { epoch: timeline.range.epoch, endSeq: timeline.range.endSeq }
            : undefined;
        },
        fetchPage: (_agentId, request) => fetch(request),
        fetchLatestTail: () =>
          fetch({ direction: "tail", limit: 40, projection: "projected", wholeTurns: true }),
        reportError: (error) => errors.push(error),
      },
    });
    owner.setConnected(true);
    owner.replaceVisibleAgentIds("test", [AGENT_ID]);
    return {
      owner,
      async nextFetch(): Promise<PendingFetch> {
        await expect.poll(() => fetches.length).toBeGreaterThan(0);
        return fetches.shift()!;
      },
      live(event: AgentStreamReducerEvent): void {
        owner.applyStreamEvent(AGENT_ID, event);
        owner.flushStreamAgent(AGENT_ID);
      },
      /** Answers every catch-up the chat still asks for until it reports itself current. */
      async settle(daemon: DaemonTimeline): Promise<void> {
        for (let turn = 0; turn < 20; turn += 1) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          expect(errors).toEqual([]);
          const next = fetches.shift();
          if (next) next.deliver(daemon.page(next.request));
          else if (owner.getAgentTimelineStatus(AGENT_ID) === "ready") return;
        }
        throw new Error("The chat never caught up");
      },
    };
  }

  function rows(): Array<{ kind: StreamItem["kind"]; text: string }> {
    const session = useSessionStore.getState().sessions[SERVER_ID];
    return [
      ...(session?.agentStreamTail.get(AGENT_ID) ?? []),
      ...(session?.agentStreamHead.get(AGENT_ID) ?? []),
    ].map((entry) => ({
      kind: entry.kind,
      text: "text" in entry && typeof entry.text === "string" ? entry.text : "",
    }));
  }

  const reply = (words: number) =>
    Array.from({ length: words }, (_unused, index) => `word${index}`).join(" ");
  const chunk = (index: number) => `${index === 0 ? "" : " "}word${index}`;
  const replyChunk = (index: number): AgentTimelineItem => ({
    type: "assistant_message",
    text: chunk(index),
    messageId: "reply-1",
  });

  /**
   * Opens the chat while its timeline is empty, then drops the connection while the prompt,
   * an optional thought and the first three reply chunks are recorded.
   */
  async function goOfflineWhileTheReplyStarts(input: {
    reasoning: boolean;
    storage: TimelineReplicaStorage;
  }) {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    const daemon = new DaemonTimeline();
    const chat = openChat(input.storage);
    const opened = await chat.nextFetch();
    opened.deliver(daemon.page(opened.request));
    expect(
      selectAgentTimelineState(useSessionStore.getState().sessions[SERVER_ID], AGENT_ID),
    ).toEqual({ status: "synced", items: [], range: null, older: "none", newer: "none" });

    chat.owner.setConnected(false);
    daemon.record({ type: "user_message", text: PROMPT, messageId: "prompt-1" });
    if (input.reasoning) daemon.record({ type: "reasoning", text: THOUGHT });
    for (const index of [0, 1, 2]) daemon.record(replyChunk(index));
    chat.owner.setConnected(true);
    const catchUp = await chat.nextFetch();
    return { daemon, chat, catchUp };
  }

  function expectedRows(reasoning: boolean, words: number) {
    return [
      { kind: "user_message", text: PROMPT },
      ...(reasoning ? [{ kind: "thought", text: THOUGHT }] : []),
      { kind: "assistant_message", text: reply(words) },
    ];
  }

  /** A saved range that starts after the prompt claims history the chat never received. */
  function expectCoverageFromTheFirstRow(commits: CachedTimeline[]): void {
    expect(commits.map((commit) => commit.range?.startSeq ?? 1)).toEqual(commits.map(() => 1));
  }

  it.each([true, false])(
    "keeps the prompt and the whole reply when live chunks arrive before a page that holds them (reasoning=%s)",
    async (reasoning) => {
      const commits: CachedTimeline[] = [];
      const { daemon, chat, catchUp } = await goOfflineWhileTheReplyStarts({
        reasoning,
        storage: {
          readTimeline: async () => undefined,
          commitTimeline: (_serverId, _agentId, timeline) => commits.push(timeline),
        },
      });
      try {
        chat.live(daemon.record(replyChunk(3)));
        chat.live(daemon.record(replyChunk(4)));
        catchUp.deliver(daemon.page(catchUp.request));
        chat.live(daemon.record(replyChunk(5)));
        await chat.settle(daemon);

        expect(rows()).toEqual(expectedRows(reasoning, 6));
        expectCoverageFromTheFirstRow(commits);
      } finally {
        chat.owner.dispose();
      }

      // The saved chat paints the same rows after a reload.
      const saved = commits.at(-1);
      useSessionStore.getState().clearSession(SERVER_ID);
      useSessionStore.getState().initializeSession(SERVER_ID, null);
      const reopened = createOwner({
        readTimeline: async () => saved,
        commitTimeline: () => undefined,
      });
      try {
        reopened.replaceVisibleAgentIds("test", [AGENT_ID]);
        await expect.poll(rows).toEqual(expectedRows(reasoning, 6));
      } finally {
        reopened.dispose();
      }
    },
  );

  it("keeps the prompt when the page already holds a chunk the chat has not seen live", async () => {
    const commits: CachedTimeline[] = [];
    const { daemon, chat, catchUp } = await goOfflineWhileTheReplyStarts({
      reasoning: true,
      storage: {
        readTimeline: async () => undefined,
        commitTimeline: (_serverId, _agentId, timeline) => commits.push(timeline),
      },
    });
    try {
      chat.live(daemon.record(replyChunk(3)));
      const notYetLive = daemon.record(replyChunk(4));
      catchUp.deliver(daemon.page(catchUp.request));
      chat.live(notYetLive);
      chat.live(daemon.record(replyChunk(5)));
      await chat.settle(daemon);

      expect(rows()).toEqual(expectedRows(true, 6));
      expectCoverageFromTheFirstRow(commits);
    } finally {
      chat.owner.dispose();
    }
  });

  it("finishes the reply when its last chunks arrive while an older page is in flight", async () => {
    const commits: CachedTimeline[] = [];
    const { daemon, chat, catchUp } = await goOfflineWhileTheReplyStarts({
      reasoning: true,
      storage: {
        readTimeline: async () => undefined,
        commitTimeline: (_serverId, _agentId, timeline) => commits.push(timeline),
      },
    });
    try {
      const olderPage = daemon.page(catchUp.request);
      chat.live(daemon.record(replyChunk(3)));
      chat.live(daemon.record(replyChunk(4)));
      catchUp.deliver(olderPage);
      await chat.settle(daemon);

      expect(rows()).toEqual(expectedRows(true, 5));
      expectCoverageFromTheFirstRow(commits);
    } finally {
      chat.owner.dispose();
    }
  });
});

function createSqliteCache() {
  const database = new DatabaseSync(":memory:");
  let beforeRead = async () => {};
  const connection: ReplicaSqliteConnection = {
    async exec(sql) {
      database.exec(sql);
    },
    async run(sql, params = []) {
      database.prepare(sql).run(...params);
    },
    async all<Row>(sql: string, params: readonly SqliteValue[] = []) {
      const rows = database.prepare(sql).all(...params) as Row[];
      if (sql.includes("FROM rows") && sql.includes("WHERE")) await beforeRead();
      return rows;
    },
    async transaction(operation) {
      database.exec("BEGIN IMMEDIATE");
      try {
        await operation(connection);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const storage = createSqliteReplicaRowStore({ open: async () => connection }, 1);
  const cache = new ReplicaCache(storage, { clearLegacyCache: async () => {} });
  return {
    cache,
    database,
    holdRead: (operation: () => Promise<void>) => {
      beforeRead = operation;
    },
  };
}

describe("SQLite baseline restoration", () => {
  it("retries the durable read once when an earlier response commits during that read", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    const { cache, database, holdRead } = createSqliteCache();
    cache.setHosts([SERVER_ID]);
    cache.commitTimeline(SERVER_ID, AGENT_ID, cachedTimeline());
    await cache.flush();
    const replica = createTimelineReplica({
      serverId: SERVER_ID,
      storage: cache,
      prepareAgent: async () => {},
    });
    const owner = createOwner(cache, undefined, undefined, replica);
    let reads = 0;
    holdRead(async () => {
      reads += 1;
      if (reads === 1) owner.applyTimelineResponse(retentionPage(10, 11, true));
    });
    await replica.prepare(AGENT_ID);
    expect(reads).toBe(2);
    expect(
      selectAgentTimelineState(useSessionStore.getState().sessions[SERVER_ID], AGENT_ID),
    ).toMatchObject({ status: "synced", range: { startSeq: 10, endSeq: 11 } });
    await cache.flush();
    owner.dispose();
    database.close();
  });

  it.each([false, true])(
    "keeps display-only cached history under a live event (synced=%s)",
    async (synced) => {
      useSessionStore.getState().initializeSession(SERVER_ID, null);
      const { cache, database, holdRead } = createSqliteCache();
      cache.setHosts([SERVER_ID]);
      cache.commitTimeline(SERVER_ID, AGENT_ID, {
        ...cachedTimeline(),
        items: [item("earlier", "earlier", 1), ...cachedTimeline().items],
        range: null,
      });
      await cache.flush();
      holdRead(async () => {
        if (synced) applySynced(AGENT_ID, 8);
        else
          useSessionStore.getState().setAgentStreamState(SERVER_ID, AGENT_ID, {
            head: [item("cached", "cached", 4), item("live", "live", 5)],
          });
      });
      const replica = createTimelineReplica({
        serverId: SERVER_ID,
        storage: cache,
        prepareAgent: async () => {},
      });
      await replica.prepare(AGENT_ID);
      const session = useSessionStore.getState().sessions[SERVER_ID];
      const timeline = selectAgentTimelineState(session, AGENT_ID);
      expect(timeline.status).toBe(synced ? "synced" : "painted");
      expect([
        ...(timeline.status === "cold" ? [] : timeline.items),
        ...(session?.agentStreamHead.get(AGENT_ID) ?? []),
      ]).toEqual(
        synced
          ? [item(`network-${AGENT_ID}`, "network", 8)]
          : [item("earlier", "earlier", 1), item("cached", "cached", 4), item("live", "live", 5)],
      );
      expect(replica.readCursor(AGENT_ID)).toBeUndefined();
      database.close();
    },
  );

  it("starts the timeline disk read while agent preparation is pending", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    const { cache, database, holdRead } = createSqliteCache();
    cache.setHosts([SERVER_ID]);
    cache.commitTimeline(SERVER_ID, AGENT_ID, cachedTimeline());
    await cache.flush();
    let readStarted = false;
    let release!: () => void;
    const agentReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    holdRead(async () => {
      readStarted = true;
    });
    const replica = createTimelineReplica({
      serverId: SERVER_ID,
      storage: cache,
      prepareAgent: () => agentReady,
    });
    const preparation = replica.prepare(AGENT_ID);
    try {
      await expect.poll(() => readStarted, { timeout: 500 }).toBe(true);
    } finally {
      release();
      await preparation;
      database.close();
    }
  });
});
