// Legacy KV totals remain the baseline. New increments belong to the SQLite
// Durable Object, so importing the baseline again cannot overwrite increments.
export type InstallWindow = "week" | "month" | "all";
export type InstallCounts = Record<InstallWindow, number>;
export type DailyInstalls = Record<string, number>;
export interface LegacyInstalls {
  total: number;
  daily: DailyInstalls;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DAYS_KEPT = 60;
const WINDOW_DAYS = { week: 7, month: 30 } as const;
const TOTAL_PREFIX = "plugin-installs:";
const DAILY_PREFIX = "plugin-installs-daily:";

export function installCounter(namespace: DurableObjectNamespace): DurableObjectStub {
  return namespace.get(namespace.idFromName("plugin-installs:v1"));
}

export async function recordClientInstall({
  counter,
  id,
  ip,
}: {
  counter: DurableObjectNamespace;
  id: string;
  ip: string | null;
}): Promise<void> {
  if (!ip) return;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const response = await installCounter(counter).fetch("https://counter/install", {
    method: "POST",
    body: JSON.stringify({ id, hash }),
  });
  if (!response.ok) throw new Error(`Plugin install counter returned ${response.status}`);
}

async function listKeys(cache: KVNamespace, prefix: string): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await cache.list({ prefix, cursor, limit: 1000 });
    names.push(...page.keys.map((key) => key.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor !== undefined);
  return names;
}

/** List existing counters, including unlisted plugins; never probe every registry ID. */
export async function readLegacyInstalls(
  cache: KVNamespace | null,
): Promise<Record<string, LegacyInstalls>> {
  if (!cache) return {};
  const [totals, days] = await Promise.all([
    listKeys(cache, TOTAL_PREFIX),
    listKeys(cache, DAILY_PREFIX),
  ]);
  const result: Record<string, LegacyInstalls> = {};
  const totalEntries = await Promise.all(
    totals.map(async (key) => {
      const raw = await cache.get(key);
      const total = Number(raw ?? 0);
      if (!Number.isSafeInteger(total) || total < 0)
        throw new Error(`Invalid legacy install total: ${key}`);
      return { id: key.slice(TOTAL_PREFIX.length), total };
    }),
  );
  for (const { id, total } of totalEntries) result[id] = { total, daily: {} };
  const dailyEntries = await Promise.all(
    days.map(async (key) => {
      const raw: unknown = await cache.get(key, { type: "json" });
      const daily: DailyInstalls = {};
      if (typeof raw === "object" && raw !== null) {
        for (const [day, count] of Object.entries(raw)) {
          if (
            /^\d{4}-\d{2}-\d{2}$/.test(day) &&
            typeof count === "number" &&
            Number.isSafeInteger(count) &&
            count >= 0
          )
            daily[day] = count;
        }
      }
      return { id: key.slice(DAILY_PREFIX.length), daily };
    }),
  );
  for (const { id, daily } of dailyEntries) result[id] = { total: result[id]?.total ?? 0, daily };
  return result;
}

export async function readInstallCounts(
  cache: KVNamespace | null,
  ids: string[],
  now: Date,
): Promise<Record<string, InstallCounts>> {
  const legacy = await readLegacyInstalls(cache);
  return Object.fromEntries(
    ids.map((id) => [id, countInstalls(legacy[id]?.daily ?? {}, legacy[id]?.total ?? 0, now)]),
  );
}

export function isInstallCounts(value: unknown): value is Record<string, InstallCounts> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((counts) => {
    if (typeof counts !== "object" || counts === null) return false;
    return [counts.week, counts.month, counts.all].every(
      (count) => Number.isSafeInteger(count) && count >= 0,
    );
  });
}

export async function readCounterCounts(
  counter: DurableObjectNamespace,
): Promise<Record<string, InstallCounts>> {
  const response = await installCounter(counter).fetch("https://counter/counts");
  if (!response.ok) throw new Error(`Plugin install counter returned ${response.status}`);
  const counts: unknown = await response.json();
  if (!isInstallCounts(counts)) throw new Error("Invalid plugin install counter response");
  return counts;
}

export function countInstalls(daily: DailyInstalls, total: number, now: Date): InstallCounts {
  const today = utcDay(now, 0);
  return {
    week: installsSince(daily, utcDay(now, WINDOW_DAYS.week - 1), today),
    month: installsSince(daily, utcDay(now, WINDOW_DAYS.month - 1), today),
    all: total,
  };
}

function installsSince(daily: DailyInstalls, oldest: string, today: string): number {
  return Object.entries(daily).reduce(
    (sum, [day, count]) => (day >= oldest && day <= today ? sum + count : sum),
    0,
  );
}

export function utcDay(now: Date, daysBefore: number): string {
  return new Date(now.getTime() - daysBefore * DAY_MS).toISOString().slice(0, 10);
}
