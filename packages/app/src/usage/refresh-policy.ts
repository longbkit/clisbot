import type { UsageReportEntry } from "./types";

/**
 * When a surface that stays open (the rail's quota) re-reads an agent's usage. Pure, so the
 * rules are tested without a clock or a query.
 *
 * Every read here is a plain `usage.list_reports`, never `forceRefresh`: the daemon answers from
 * its five-minute cache (`DAEMON_USAGE_TTL_MS`), so however many apps and sessions ask, one
 * account costs its provider at most one call per TTL. A forced refresh would skip that cache;
 * Claude's `/api/oauth/usage` turns callers away with 429s lasting tens of minutes, and the
 * Codex endpoint is undocumented, so the rail never forces. Why these numbers:
 * docs/audits/2026-10-27-session-quota-refresh-cadence.md.
 */

/** The daemon's fetch cache (`UsageSourceRegistry`, `ttlMs`); a read sooner than this is a hit. */
export const DAEMON_USAGE_TTL_MS = 300_000;

/**
 * How often an open window asks. Under the TTL so a number is at most TTL + this old (7 minutes)
 * instead of up to 2 TTLs, and well above the cost of a cache hit, which is one WebSocket
 * round trip.
 */
export const USAGE_POLL_MS = 120_000;

/** The soonest one read (focus, a finished turn) follows another while reads succeed. */
export const USAGE_MIN_GAP_MS = 30_000;

/** A number this old, with the latest read failing, is shown as stale. */
export const USAGE_STALE_AFTER_MS = DAEMON_USAGE_TTL_MS;

const RETRY_STEPS_MS = [DAEMON_USAGE_TTL_MS, 600_000, 900_000] as const;

export interface UsageFreshness {
  /** When the newest good numbers were read; null when none were. */
  goodAt: number | null;
  /** The latest read did not produce good numbers. */
  failing: boolean;
}

/** When one report's numbers were read: its own success, else the daemon's last good one. */
export function entryGoodAt(entry: UsageReportEntry): number | null {
  const iso =
    entry.report.status === "available"
      ? // COMPAT(usageSuccessfulAt): added in v0.12.0, remove after 2027-04-17 once daemon floor >= v0.12.0.
        (entry.successfulAt ?? entry.fetchedAt)
      : entry.lastSuccessful?.fetchedAt;
  const at = iso === undefined ? Number.NaN : Date.parse(iso);
  return Number.isNaN(at) ? null : at;
}

/**
 * The freshness of a report list: failing when the request failed or any report is not
 * available; good as of its oldest good report, since that is the one to distrust first.
 */
export function readUsageFreshness(
  reports: readonly UsageReportEntry[],
  requestFailed: boolean,
): UsageFreshness {
  let goodAt: number | null = null;
  let failing = requestFailed;
  for (const entry of reports) {
    if (entry.report.status !== "available") failing = true;
    const at = entryGoodAt(entry);
    if (at !== null && (goodAt === null || at < goodAt)) goodAt = at;
  }
  return { goodAt, failing };
}

/**
 * Whether numbers read at `goodAt` are stale: the latest read failed and they are older than a
 * cache lifetime, so a working read would have replaced them by now.
 */
export function isUsageStale(freshness: UsageFreshness, now: number): boolean {
  if (!freshness.failing || freshness.goodAt === null) return false;
  return now - freshness.goodAt >= USAGE_STALE_AFTER_MS;
}

/**
 * How long to wait before asking again. While reads work it is `USAGE_POLL_MS`. Once they fail
 * it is at least the cache lifetime and grows with how long the numbers have been old
 * (5, 10, then 15 minutes), so an outage is asked about less and less, never more. The steps are
 * constants, not the age itself, so the interval timer is not restarted on every render.
 */
export function usageRetryDelayMs(freshness: UsageFreshness, now: number): number {
  if (!freshness.failing) return USAGE_POLL_MS;
  if (freshness.goodAt === null) return RETRY_STEPS_MS[0];
  const age = now - freshness.goodAt;
  if (age < 2 * DAEMON_USAGE_TTL_MS) return RETRY_STEPS_MS[0];
  if (age < 4 * DAEMON_USAGE_TTL_MS) return RETRY_STEPS_MS[1];
  return RETRY_STEPS_MS[2];
}

/**
 * Whether a read triggered by an event (the window regains focus, a turn finishes) may go out.
 * While reads work, events are spaced `USAGE_MIN_GAP_MS` apart. While they fail, an event waits
 * as long as the failure interval, so a burst of finished turns cannot out-ask the backoff.
 */
export function mayReadUsageNow(input: {
  freshness: UsageFreshness;
  lastAttemptAt: number;
  now: number;
}): boolean {
  const { freshness, lastAttemptAt, now } = input;
  const wait = freshness.failing ? usageRetryDelayMs(freshness, now) : USAGE_MIN_GAP_MS;
  return now - lastAttemptAt >= wait;
}

/**
 * The interval handed to the query: nothing while the window is hidden or the host cannot report.
 */
export function usagePollInterval(input: {
  active: boolean;
  freshness: UsageFreshness;
  now: number;
}): number | false {
  return input.active ? usageRetryDelayMs(input.freshness, input.now) : false;
}
