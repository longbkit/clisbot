import { describe, expect, it } from "vitest";
import {
  DAEMON_USAGE_TTL_MS,
  USAGE_MIN_GAP_MS,
  USAGE_POLL_MS,
  entryGoodAt,
  isUsageStale,
  mayReadUsageNow,
  readUsageFreshness,
  usagePollInterval,
  usageRetryDelayMs,
} from "./refresh-policy";
import type { UsageReportEntry } from "./types";

const now = Date.parse("2026-10-27T10:00:00Z");
const minutes = (count: number) => count * 60_000;
const ago = (ms: number) => new Date(now - ms).toISOString();

function entry(overrides: Partial<UsageReportEntry> = {}): UsageReportEntry {
  return {
    id: "claude:me",
    sourceId: "claude",
    sourceLabel: "Claude",
    account: {},
    fetchedAt: ago(0),
    report: { status: "available", windows: [] },
    ...overrides,
  } as UsageReportEntry;
}

const failed = (extra: Partial<UsageReportEntry> = {}) =>
  entry({ report: { status: "error", error: "429" }, ...extra });

describe("entryGoodAt", () => {
  it("is when an available report was read, preferring the success time over the attempt", () => {
    expect(entryGoodAt(entry({ fetchedAt: ago(minutes(1)) }))).toBe(now - minutes(1));
    expect(entryGoodAt(entry({ fetchedAt: ago(0), successfulAt: ago(minutes(3)) }))).toBe(
      now - minutes(3),
    );
  });

  it("is the daemon's last good read for a failed report, and unknown without one", () => {
    const lastSuccessful = {
      fetchedAt: ago(minutes(8)),
      report: { status: "available" as const, windows: [] },
    };
    expect(entryGoodAt(failed({ lastSuccessful }))).toBe(now - minutes(8));
    expect(entryGoodAt(failed())).toBeNull();
  });
});

describe("readUsageFreshness", () => {
  it("is failing when the request failed or any report is not available", () => {
    expect(readUsageFreshness([entry()], false).failing).toBe(false);
    expect(readUsageFreshness([entry()], true).failing).toBe(true);
    expect(readUsageFreshness([entry(), failed()], false).failing).toBe(true);
  });

  it("is good as of the oldest good report", () => {
    const reports = [entry({ fetchedAt: ago(minutes(1)) }), entry({ fetchedAt: ago(minutes(4)) })];
    expect(readUsageFreshness(reports, false).goodAt).toBe(now - minutes(4));
    expect(readUsageFreshness([], false)).toEqual({ goodAt: null, failing: false });
  });
});

describe("isUsageStale", () => {
  const age = (ms: number, failing: boolean) => ({ goodAt: now - ms, failing });

  it("never marks numbers whose latest read worked, however old", () => {
    expect(isUsageStale(age(minutes(60), false), now)).toBe(false);
  });

  it("marks failing numbers once they are older than a cache lifetime", () => {
    expect(isUsageStale(age(DAEMON_USAGE_TTL_MS - 1, true), now)).toBe(false);
    expect(isUsageStale(age(DAEMON_USAGE_TTL_MS, true), now)).toBe(true);
  });

  it("has nothing to mark without good numbers", () => {
    expect(isUsageStale({ goodAt: null, failing: true }, now)).toBe(false);
  });
});

describe("usageRetryDelayMs", () => {
  const failingFor = (ms: number) => ({ goodAt: now - ms, failing: true });

  it("polls every two minutes while reads work, under the daemon's cache lifetime", () => {
    expect(usageRetryDelayMs({ goodAt: now, failing: false }, now)).toBe(USAGE_POLL_MS);
    expect(USAGE_POLL_MS).toBeLessThan(DAEMON_USAGE_TTL_MS);
  });

  it("backs off to 5, 10 and 15 minutes as the numbers age, and stays there", () => {
    const delays = [1, 9, 11, 19, 21, 600].map((age) =>
      usageRetryDelayMs(failingFor(minutes(age)), now),
    );
    expect(delays).toEqual([
      minutes(5),
      minutes(5),
      minutes(10),
      minutes(10),
      minutes(15),
      minutes(15),
    ]);
  });

  it("never asks sooner as an outage goes on, and never sooner than while reads work", () => {
    let previous = USAGE_POLL_MS;
    for (let age = 0; age <= minutes(120); age += minutes(1)) {
      const delay = usageRetryDelayMs(failingFor(age), now);
      expect(delay).toBeGreaterThanOrEqual(previous);
      previous = delay;
    }
  });

  it("waits the floor when there were never good numbers", () => {
    expect(usageRetryDelayMs({ goodAt: null, failing: true }, now)).toBe(DAEMON_USAGE_TTL_MS);
  });
});

describe("usagePollInterval", () => {
  const working = { goodAt: now, failing: false };

  it("is off while the window is hidden and on, at the delay, while it is visible", () => {
    expect(usagePollInterval({ active: false, freshness: working, now })).toBe(false);
    expect(usagePollInterval({ active: true, freshness: working, now })).toBe(USAGE_POLL_MS);
  });
});

describe("mayReadUsageNow", () => {
  it("spaces event reads 30 seconds apart while reads work", () => {
    const freshness = { goodAt: now, failing: false };
    expect(mayReadUsageNow({ freshness, lastAttemptAt: now - USAGE_MIN_GAP_MS + 1, now })).toBe(
      false,
    );
    expect(mayReadUsageNow({ freshness, lastAttemptAt: now - USAGE_MIN_GAP_MS, now })).toBe(true);
  });

  it("makes an event wait the failure interval, so a burst of finished turns cannot out-ask it", () => {
    const freshness = { goodAt: now - minutes(12), failing: true };
    expect(mayReadUsageNow({ freshness, lastAttemptAt: now - minutes(9), now })).toBe(false);
    expect(mayReadUsageNow({ freshness, lastAttemptAt: now - minutes(10), now })).toBe(true);
  });

  it("allows the first read when nothing was ever read", () => {
    expect(
      mayReadUsageNow({ freshness: { goodAt: null, failing: false }, lastAttemptAt: 0, now }),
    ).toBe(true);
  });
});
