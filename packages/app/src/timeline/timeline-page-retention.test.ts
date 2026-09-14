import { describe, expect, it, vi } from "vitest";
import { TimelinePageRetention, type RetainedTimelinePage } from "./timeline-page-retention";
function page(startSeq: number, endSeq: number, itemId = `${startSeq}`): RetainedTimelinePage {
  return {
    epoch: "epoch",
    startSeq,
    endSeq,
    itemIds: [itemId],
    sourceSeqRanges: [{ startSeq, endSeq }],
    hasOlder: startSeq > 1,
    bytes: 100,
  };
}
const limits = { sessionBytes: 400, totalBytes: 800, pageMetadataBytes: 0 };
describe("timeline page retention metadata", () => {
  it("keeps registrations across another owner's admission and hidden eviction/reopen", () => {
    const retention = new TimelinePageRetention({ ...limits, totalBytes: 300 });
    retention.register("empty", vi.fn());
    retention.register("other", vi.fn());
    expect(retention.retain("other", page(1, 40))).toBe(true);
    expect(retention.retain("empty", page(1, 40))).toBe(true);
    expect(retention.readRange("other")?.range).toBeNull();
    expect(retention.retain("other", page(41, 80))).toBe(true);
  });
  it("counts a shared late tool payload once across pages and includes pending admission", () => {
    const retention = new TimelinePageRetention({
      sessionBytes: 2000,
      totalBytes: 3000,
      pageMetadataBytes: 0,
    });
    retention.register("a", vi.fn());
    for (let seq = 1; seq <= 3; seq += 1)
      retention.retain("a", { ...page(seq, seq, "tool"), itemBytes: { tool: 1000 }, bytes: 0 });
    expect(retention.retainedBytes).toBeLessThan(1300);
    const release = retention.reserve("a", 200);
    expect(release).not.toBeNull();
    const reserved = retention.retainedBytes;
    release?.();
    release?.();
    expect(retention.retainedBytes).toBe(reserved - 200);
  });
  it("protects the reading page and stops certifying a removed middle range", () => {
    const retention = new TimelinePageRetention(limits);
    const changed = vi.fn();
    retention.register("host/agent", changed);
    retention.retain("host/agent", page(1, 40, "reading"));
    retention.setReading("host/agent", true, "reading");
    retention.retain("host/agent", page(41, 80));
    retention.retain("host/agent", page(81, 120));
    expect(retention.retainedBytes).toBeLessThanOrEqual(limits.sessionBytes);
    expect(retention.readRange("host/agent")?.range).toEqual({
      epoch: "epoch",
      startSeq: 81,
      endSeq: 120,
      retainedRanges: [{ startSeq: 1, endSeq: 40, hasOlder: false }],
    });
    expect(changed).toHaveBeenCalled();
  });
  it("retains shared tool IDs but never acknowledges a future discontiguous source range", () => {
    const retention = new TimelinePageRetention(limits);
    retention.register("host/agent", vi.fn());
    retention.retain("host/agent", {
      ...page(1, 1, "tool"),
      sourceSeqRanges: [
        { startSeq: 1, endSeq: 1 },
        { startSeq: 100, endSeq: 100 },
      ],
    });
    expect(retention.readRange("host/agent")?.range?.endSeq).toBe(1);
    retention.retain("host/agent", page(2, 40, "middle"));
    retention.retain("host/agent", page(41, 100, "tool"));
    expect(retention.readRange("host/agent")?.keepItemIds.has("tool")).toBe(true);
    expect(retention.readRange("host/agent")?.range?.startSeq).toBe(2);
  });
  it("counts hidden timelines across hosts and refuses admission when every retained page is pinned", () => {
    const retention = new TimelinePageRetention({ ...limits, totalBytes: 300 });
    retention.register("host-a/same-id", vi.fn());
    retention.setReading("host-a/same-id", true, null);
    expect(retention.retain("host-a/same-id", page(1, 40))).toBe(true);
    retention.register("host-b/same-id", vi.fn());
    retention.setReading("host-b/same-id", true, null);
    expect(retention.retain("host-b/same-id", page(1, 40))).toBe(false);
    retention.setReading("host-a/same-id", false, null);
    expect(retention.retain("host-b/same-id", page(1, 40))).toBe(true);
    expect(retention.readRange("host-a/same-id")?.range).toBeNull();
    expect(retention.retainedBytes).toBeLessThanOrEqual(300);
  });
  it("drops stale epoch coverage and stops speculative fetch admission at its byte budget", () => {
    const retention = new TimelinePageRetention(limits);
    retention.register("agent", vi.fn());
    retention.setReading("agent", true, null);
    retention.retain("agent", page(1, 40));
    expect(retention.canPrefetch("agent", 300)).toBe(false);
    retention.retain("agent", { ...page(1, 2, "replacement"), epoch: "new" });
    expect(retention.readRange("agent")?.range).toEqual({ epoch: "new", startSeq: 1, endSeq: 2 });
    expect([...retention.readRange("agent")!.keepItemIds]).toEqual(["replacement"]);
  });
});
