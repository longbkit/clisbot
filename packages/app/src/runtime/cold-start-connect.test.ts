import { describe, expect, it } from "vitest";
import { ColdStartConnectTimeline, type ColdStartConnectSummary } from "./cold-start-connect";

function timeline() {
  let now = 1_000;
  const reports: ColdStartConnectSummary[] = [];
  const scheduled: Array<() => void> = [];
  let stall: ((lagMs: number) => void) | null = null;
  let watching = false;
  const subject = new ColdStartConnectTimeline({
    now: () => now,
    report: (summary) => reports.push(summary),
    schedule: (callback) => {
      scheduled.push(callback);
      return () => undefined;
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
    fireDeadline: () => scheduled.shift()?.(),
  };
}

describe("the cold-start connect summary", () => {
  it("reports each phase once, when every restored Hub Host is online", () => {
    const { subject, reports, advanceTo, stall, watching } = timeline();
    advanceTo(80);
    subject.registryRestored(["a", "b"]);
    advanceTo(90);
    subject.mark("hubBinding");
    stall(300);
    stall(1_200);
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
        jsStallMaxMs: 0,
        jsStallTotalMs: 0,
        firstHostOnlineMs: 3_000,
        allHostsOnlineMs: null,
      },
    ]);
  });

  it("reports nothing when no Hub-managed Host was restored", () => {
    const { subject, reports, fireDeadline } = timeline();
    subject.registryRestored([]);
    subject.hostOnline("local");
    fireDeadline();
    expect(reports).toEqual([]);
  });
});
