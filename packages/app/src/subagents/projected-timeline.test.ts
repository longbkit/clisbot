import { afterEach, describe, expect, it } from "vitest";
import {
  applyProjectedSubagentPage,
  type ProviderSubagentTimelinePage,
} from "./projected-timeline";
import { ProviderSubagentTimelineRetention, trimSubagentTimeline } from "./timeline-retention";
import { TimelinePageRetention, timelineRetentionKey } from "@/timeline/timeline-page-retention";
import {
  providerSubagentKey,
  setProviderSubagentTimelineReading,
  useProviderSubagentStore,
  type ProviderSubagentTimelineState,
} from "./provider-store";

function page(start: number, end = start): ProviderSubagentTimelinePage {
  return {
    requestId: "test",
    parentAgentId: "parent",
    subagentId: "child",
    provider: "codex",
    direction: "tail",
    epoch: "epoch",
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 1, maxSeq: 100, nextSeq: 101 },
    pagingMode: "source_ranges",
    startCursor: { epoch: "epoch", seq: start },
    endCursor: { epoch: "epoch", seq: end },
    entries: [
      {
        provider: "codex",
        timestamp: "2026-09-11T00:00:00Z",
        seqStart: start,
        seqEnd: end,
        sourceSeqRanges: [{ startSeq: start, endSeq: end }],
        collapsed: [],
        item: { type: "assistant_message", text: `Message ${start}` },
      },
    ],
    rows: [],
    hasOlder: start > 1,
    hasNewer: false,
    error: null,
  };
}

afterEach(() => {
  useProviderSubagentStore
    .getState()
    .applyUpdate("server", { kind: "remove", parentAgentId: "parent", subagentId: "child" });
});

describe("projected subagent history", () => {
  it("preserves an ancient tool's exact source ranges through a live update", () => {
    setProviderSubagentTimelineReading("server", "parent", "child", true);
    const tail = page(99);
    tail.startCursor = { epoch: "epoch", seq: 98 };
    const tool = {
      type: "tool_call" as const,
      callId: "old-tool",
      name: "shell",
      status: "running" as const,
      detail: { type: "unknown" as const, input: {}, output: null },
      error: null,
    };
    tail.contextEntries = [
      {
        ...tail.entries![0],
        item: tool,
        seqStart: 1,
        seqEnd: 98,
        sourceSeqRanges: [
          { startSeq: 1, endSeq: 1 },
          { startSeq: 98, endSeq: 98 },
        ],
      },
    ];
    const store = useProviderSubagentStore.getState();
    store.replaceTimeline("server", tail);
    store.applyUpdate("server", {
      kind: "timeline",
      parentAgentId: "parent",
      subagentId: "child",
      provider: "codex",
      epoch: "epoch",
      seq: 100,
      timestamp: "2026-09-11T00:00:01Z",
      item: { ...tool, status: "completed" },
    });
    const state = useProviderSubagentStore
      .getState()
      .timelines.get(providerSubagentKey("server", "parent", "child"))!;
    expect(state.cursor).toEqual({ epoch: "epoch", startSeq: 98, endSeq: 100 });
    const rendered = [...state.tail, ...state.head].find((item) => item.kind === "tool_call")!;
    expect(rendered.timelineCursor?.seqStart).toBe(1);
    expect(rendered.timelineCursor?.sourceSeqRanges).toEqual([
      { startSeq: 1, endSeq: 1 },
      { startSeq: 98, endSeq: 98 },
      { startSeq: 100, endSeq: 100 },
    ]);
    expect(state.rows.size).toBe(0);
  });

  it("keeps raw deferred updates outside retained coverage until an authoritative snapshot catches up", () => {
    setProviderSubagentTimelineReading("server", "parent", "child", true);
    const initial = page(100);
    initial.entries![0] = {
      ...initial.entries![0],
      seqStart: 1,
      sourceSeqRanges: [],
      sourceSeqRangesRef: { id: "ranges", count: 200 },
      deferredPayload: { id: "large", byteLength: 100000, format: "timeline_item_json" },
      item: { type: "assistant_message", text: "", messageId: "large" },
    };
    initial.contextEntries = initial.entries;
    initial.entries = [];
    const store = useProviderSubagentStore.getState();
    store.replaceTimeline("server", initial);
    for (const seq of [101, 102])
      store.applyUpdate("server", {
        kind: "timeline",
        parentAgentId: "parent",
        subagentId: "child",
        provider: "codex",
        epoch: "epoch",
        seq,
        timestamp: "2026-09-12T00:00:00Z",
        item: { type: "assistant_message", text: "raw bytes must not fold", messageId: "large" },
      });
    const key = providerSubagentKey("server", "parent", "child");
    const pending = useProviderSubagentStore.getState().timelines.get(key)!;
    expect(pending.cursor?.endSeq).toBe(100);
    expect(pending.latestObserved).toEqual({ epoch: "epoch", seq: 102 });
    expect(JSON.stringify(pending.tail)).not.toContain("raw bytes");
    const intermediate = {
      ...initial,
      direction: "after" as const,
      startCursor: { epoch: "epoch", seq: 101 },
      endCursor: { epoch: "epoch", seq: 101 },
      contextEntries: [
        {
          ...initial.contextEntries![0],
          seqEnd: 101,
          deferredPayload: { ...initial.contextEntries![0].deferredPayload!, id: "intermediate" },
        },
      ],
    };
    store.replaceTimeline("server", intermediate);
    expect(useProviderSubagentStore.getState().timelines.get(key)?.hasNewer).toBe(true);
    store.replaceTimeline("server", {
      ...intermediate,
      startCursor: { epoch: "epoch", seq: 102 },
      endCursor: { epoch: "epoch", seq: 102 },
      contextEntries: [{ ...intermediate.contextEntries[0], seqEnd: 102 }],
    });
    expect(useProviderSubagentStore.getState().timelines.get(key)).toMatchObject({
      lastSeq: 102,
      hasNewer: false,
    });
    expect(useProviderSubagentStore.getState().timelines.get(key)?.rows.size).toBe(0);
  });

  it("does not retain legacy broadcasts for hidden subagent panels", () => {
    setProviderSubagentTimelineReading("server", "parent", "child", false);
    for (let seq = 1; seq <= 100; seq += 1)
      useProviderSubagentStore.getState().applyUpdate("server", {
        kind: "timeline",
        parentAgentId: "parent",
        subagentId: "child",
        provider: "codex",
        epoch: "epoch",
        seq,
        timestamp: "2026-09-11T00:00:00Z",
        item: { type: "assistant_message", text: "hidden" },
      });
    expect(
      useProviderSubagentStore
        .getState()
        .timelines.has(providerSubagentKey("server", "parent", "child")),
    ).toBe(false);
  });
  it("keeps context source ownership separate from contiguous page coverage", () => {
    const tail = page(100);
    tail.contextEntries = [
      {
        ...tail.entries![0],
        seqStart: 1,
        sourceSeqRanges: [
          { startSeq: 1, endSeq: 1 },
          { startSeq: 100, endSeq: 100 },
        ],
      },
    ];
    tail.entries = [];
    const current = applyProjectedSubagentPage(undefined, tail);
    expect(current.cursor).toEqual({ epoch: "epoch", startSeq: 100, endSeq: 100 });
    expect(current.hasOlder).toBe(true);
    expect(current.rows.size).toBe(0);
    expect([...current.tail, ...current.head][0].timelineCursor?.sourceSeqRanges).toEqual(
      tail.contextEntries[0].sourceSeqRanges,
    );
    const before = page(99);
    before.direction = "before";
    const next = applyProjectedSubagentPage(current, before);
    expect([...next.tail, ...next.head]).toHaveLength(2);
    expect(next.cursor?.startSeq).toBe(99);
  });

  it("shares the parent budget and evicts payloads without retaining raw rows", () => {
    const budget = new TimelinePageRetention({
      sessionBytes: 3100,
      totalBytes: 10000,
      pageMetadataBytes: 100,
    });
    const main = timelineRetentionKey("server", "parent");
    budget.register(main, () => undefined);
    budget.retain(main, {
      epoch: "epoch",
      startSeq: 1,
      endSeq: 1,
      itemIds: ["main"],
      sourceSeqRanges: [],
      bytes: 1000,
      hasOlder: false,
    });
    budget.setReading(main, true, "main");
    let current: ProviderSubagentTimelineState | undefined;
    const retention = new ProviderSubagentTimelineRetention((_key, change) => {
      if (current) current = trimSubagentTimeline(current, change);
    }, budget);
    retention.ensure("child", "server", "parent");
    retention.setReading("child", true, null);
    const first = page(10);
    current = retention.admit("child", applyProjectedSubagentPage(undefined, first), first);
    const second = page(11);
    second.direction = "after";
    current = retention.admit("child", applyProjectedSubagentPage(current, second), second);
    expect(current.rows.size).toBe(0);
    expect(budget.retainedBytes).toBeLessThanOrEqual(3100);
    retention.setReading("child", false, null);
    retention.remove("child");
    expect(budget.readRange("child")).toBeUndefined();
  });

  it("fails explicitly without converting an error page into ready empty history", () => {
    const failed = page(1);
    failed.error = "History is rebuilding";
    expect(() => applyProjectedSubagentPage(undefined, failed)).toThrow("History is rebuilding");
  });
});
