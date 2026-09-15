import { DatabaseSync } from "node:sqlite";
import { ReplicaCache } from "@/runtime/replica-cache";
import {
  createSqliteReplicaRowStore,
  type ReplicaSqliteConnection,
  type SqliteValue,
} from "@/runtime/replica-cache/row-store-sqlite";
import { TimelinePageRetention } from "./timeline-page-retention";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentStreamEventPayload } from "@getpaseo/protocol/messages";
import type { CachedTimeline } from "@/runtime/replica-cache";
import { selectAgentTimelineState, useSessionStore } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import {
  createTimelineReplica,
  createViewedTimelineOwner,
  type TimelineReplicaStorage,
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

function createOwner(
  storage: TimelineReplicaStorage,
  retentionBudget?: TimelinePageRetention,
  ports?: Partial<ViewedTimelineOwnerPorts>,
): ViewedTimelineOwner {
  const replica = createTimelineReplica({
    serverId: SERVER_ID,
    storage,
    prepareAgent: async () => undefined,
  });
  return createViewedTimelineOwner({
    retentionBudget,
    serverId: SERVER_ID,
    replica,
    replaceDemandedAgentIds: () => undefined,
    drainQueuedAgentMessage: () => undefined,
    ports: {
      initialDeliveryMode: "legacy",
      setSubscription: async () => undefined,
      readCursor: () => undefined,
      fetchPage: async () => ({ hasNewer: false, endCursor: null }),
      fetchLatestTail: async () => ({ hasNewer: false, endCursor: null }),
      reportError: () => undefined,
      schedule: () => () => undefined,
      ...ports,
    },
  });
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

afterEach(() => useSessionStore.getState().clearSession(SERVER_ID));

describe("viewed timeline persistence", () => {
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

    first.enqueueStreamEvent(AGENT_ID, {
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
    owner.enqueueStreamEvent(AGENT_ID, {
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
    owner.enqueueStreamEvent(AGENT_ID, incoming(101));
    owner.enqueueStreamEvent(AGENT_ID, incoming(102));
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

  it("catches up a hot agent whose live events were dropped while it was hidden", async () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null);
    const requests: { agentId: string; direction: string; seq?: number }[] = [];
    const requestsFor = (agentId: string) => requests.filter((r) => r.agentId === agentId);
    const owner = createOwner(
      { readTimeline: async () => undefined, commitTimeline: () => undefined },
      undefined,
      {
        initialDeliveryMode: "selective",
        fetchPage: async (agentId, request) => {
          requests.push({
            agentId,
            direction: request.direction,
            ...(request.direction === "after" ? { seq: request.cursor.seq } : {}),
          });
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

    owner.enqueueStreamEvent(AGENT_ID, {
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

    await expect
      .poll(() => requestsFor(AGENT_ID).at(-1))
      .toEqual({ agentId: AGENT_ID, direction: "after", seq: 8 });
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
      owner.enqueueStreamEvent(AGENT_ID, {
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
      owner.enqueueStreamEvent(agentId, {
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
