import { describe, expect, it } from "vitest";
import { ColdStartConnectTimeline, type ColdStartConnectSummary } from "./cold-start-connect";

function timeline() {
  let now = 1_000;
  const reports: ColdStartConnectSummary[] = [];
  const scheduled: Array<() => void> = [];
  const subject = new ColdStartConnectTimeline({
    now: () => now,
    report: (summary) => reports.push(summary),
    schedule: (callback) => {
      scheduled.push(callback);
      return () => undefined;
    },
  });
  return {
    subject,
    reports,
    advanceTo: (ms: number) => {
      now = 1_000 + ms;
    },
    fireDeadline: () => scheduled.shift()?.(),
  };
}

describe("the cold-start connect summary", () => {
  it("reports each phase once, when every restored Hub Host is online", () => {
    const { subject, reports, advanceTo } = timeline();
    advanceTo(80);
    subject.registryRestored(["a", "b"]);
    advanceTo(90);
    subject.mark("hubBinding");
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
        firstHostOnlineMs: 2_000,
        allHostsOnlineMs: 2_400,
      },
    ]);
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
