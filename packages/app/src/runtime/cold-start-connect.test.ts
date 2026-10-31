import { describe, expect, it } from "vitest";
import { ColdStartConnectTimeline, type ColdStartConnectSummary } from "./cold-start-connect";

function timeline() {
  let now = 1_000;
  const reports: ColdStartConnectSummary[] = [];
  const scheduled = new Map<number, () => void>();
  let stall: ((lagMs: number) => void) | null = null;
  let watching = false;
  const subject = new ColdStartConnectTimeline({
    now: () => now,
    report: (summary) => reports.push(summary),
    schedule: (callback, delayMs) => {
      scheduled.set(delayMs, callback);
      return () => scheduled.delete(delayMs);
    },
    watchEventLoop: (onStall) => {
      stall = onStall;
      watching = true;
      return () => {
        watching = false;
      };
    },
  });
  return {
    subject,
    reports,
    stall: (lagMs: number) => stall?.(lagMs),
    watching: () => watching,
    advanceTo: (ms: number) => {
      now = 1_000 + ms;
    },
    fireDeadline: () => scheduled.get(60_000)?.(),
    fireSettleDeadline: () => scheduled.get(10_000)?.(),
  };
}

const NO_RESTORE = {
  firstCachedFrameMs: null,
  cacheRestoreChunks: 0,
  cacheRestoreLongestChunkMs: 0,
};

describe("the cold-start connect summary", () => {
  it("reports each phase once, when every restored Hub Host is online", () => {
    const { subject, reports, advanceTo, stall, watching } = timeline();
    advanceTo(80);
    subject.registryRestored(["a", "b"]);
    advanceTo(90);
    subject.mark("hubBinding");
    stall(300);
    stall(1_200);
    advanceTo(400);
    subject.restoreChunk(12);
    subject.mark("firstCachedFrame");
    subject.restoreChunk(31);
    subject.restoreChunk(8);
    advanceTo(700);
    subject.mark("cachedDirectories");
    advanceTo(1_300);
    subject.mark("hubToken");
    subject.mark("hostTransportOpen");
    advanceTo(1_500);
    subject.mark("hubTicket");
    advanceTo(1_600);
    subject.mark("hubAccount");
    subject.mark("hubAccount");
    subject.attemptFailed("b");
    advanceTo(2_000);
    subject.hostOnline("a");
    subject.mark("hubList");
    advanceTo(2_400);
    subject.hostOnline("b");
    subject.hostOnline("b");

    expect(reports).toEqual([
      {
        hosts: 2,
        online: 2,
        failedAttempts: 1,
        registryRestoredMs: 80,
        hubBindingMs: 90,
        hubAccountMs: 1_600,
        hubListMs: 2_000,
        hubTokenMs: 1_300,
        hubTicketMs: 1_500,
        hostTransportOpenMs: 1_300,
        cachedDirectoriesMs: 700,
        firstCachedFrameMs: 400,
        cacheRestoreChunks: 3,
        cacheRestoreLongestChunkMs: 31,
        jsStallMaxMs: 1_200,
        jsStallTotalMs: 1_500,
        firstHostOnlineMs: 2_000,
        allHostsOnlineMs: 2_400,
      },
    ]);
    // The event-loop watch runs only while the summary is pending.
    expect(watching()).toBe(false);
  });

  it("reports what it has at the deadline when a Host never connects", () => {
    const { subject, reports, advanceTo, fireDeadline } = timeline();
    subject.registryRestored(["a", "b"]);
    advanceTo(3_000);
    subject.hostOnline("a");
    advanceTo(60_000);
    fireDeadline();
    subject.hostOnline("b");

    expect(reports).toEqual([
      {
        hosts: 2,
        online: 1,
        failedAttempts: 0,
        registryRestoredMs: 0,
        hubBindingMs: null,
        hubAccountMs: null,
        hubListMs: null,
        hubTokenMs: null,
        hubTicketMs: null,
        hostTransportOpenMs: null,
        cachedDirectoriesMs: null,
        ...NO_RESTORE,
        jsStallMaxMs: 0,
        jsStallTotalMs: 0,
        firstHostOnlineMs: 3_000,
        allHostsOnlineMs: null,
      },
    ]);
  });

  it("settles once the cache restore is done and every restored Hub Host is online", () => {
    const { subject } = timeline();
    const settled: string[] = [];
    subject.whenSettled(() => settled.push("early listener"));
    subject.registryRestored(["a", "b"]);
    subject.hostOnline("a");
    subject.hostOnline("b");
    expect(subject.isSettled()).toBe(false);
    subject.mark("cachedDirectories");
    expect(subject.isSettled()).toBe(true);
    subject.whenSettled(() => settled.push("late listener"));
    expect(settled).toEqual(["early listener", "late listener"]);
  });

  it("settles 10 s after the registry restore when a Host stays offline", () => {
    const { subject, fireSettleDeadline } = timeline();
    subject.registryRestored(["a", "b"]);
    subject.hostOnline("a");
    subject.mark("cachedDirectories");
    expect(subject.isSettled()).toBe(false);
    fireSettleDeadline();
    expect(subject.isSettled()).toBe(true);
  });

  it("waits for the cache restore even after the settle deadline", () => {
    const { subject, fireSettleDeadline } = timeline();
    subject.registryRestored(["a"]);
    fireSettleDeadline();
    expect(subject.isSettled()).toBe(false);
    subject.mark("cachedDirectories");
    expect(subject.isSettled()).toBe(true);
  });

  it("settles on the cache restore alone without Hub-managed Hosts", () => {
    const { subject } = timeline();
    subject.registryRestored([]);
    expect(subject.isSettled()).toBe(false);
    subject.mark("cachedDirectories");
    expect(subject.isSettled()).toBe(true);
  });

  it("reports nothing when no Hub-managed Host was restored", () => {
    const { subject, reports, fireDeadline } = timeline();
    subject.registryRestored([]);
    subject.hostOnline("local");
    fireDeadline();
    expect(reports).toEqual([]);
  });
});
