interface MessageTotals {
  count: number;
  bytes: number;
  ms: number;
}

interface DurationTotals {
  count: number;
  ms: number;
}

/** One probe window: what the JS thread spent its time on, by source. */
export interface PerfReport {
  windowMs: number;
  messages: Record<string, MessageTotals>;
  stores: Record<string, number>;
  renders: Record<string, DurationTotals>;
  timers: Record<string, DurationTotals>;
  longestTaskMs: number;
}

interface PerfCollectorOptions {
  now: () => number;
  /** Distinct keys per category and window; the rest count under `other`. */
  maxKeys?: number;
}

export interface PerfCollector {
  message(type: string, bytes: number, ms: number): void;
  /** `action` is null when the commit came from a bare `setState`. */
  storeCommit(store: string, action: string | null): void;
  /** Profiler ids carry dynamic suffixes (`HomeRow:<key>`); they aggregate by prefix. */
  render(id: string, ms: number): void;
  timer(source: string, ms: number): void;
  lag(ms: number): void;
  flush(): PerfReport;
}

const DEFAULT_MAX_KEYS = 64;

export function createPerfCollector({
  now,
  maxKeys = DEFAULT_MAX_KEYS,
}: PerfCollectorOptions): PerfCollector {
  let windowStart = now();
  let report = emptyReport();

  function key(record: Record<string, unknown>, name: string): string {
    if (name in record || Object.keys(record).length < maxKeys) return name;
    return "other";
  }

  function addDuration(record: Record<string, DurationTotals>, name: string, ms: number) {
    const entry = (record[key(record, name)] ??= { count: 0, ms: 0 });
    entry.count += 1;
    entry.ms += ms;
  }

  return {
    message(type, bytes, ms) {
      const entry = (report.messages[key(report.messages, type)] ??= {
        count: 0,
        bytes: 0,
        ms: 0,
      });
      entry.count += 1;
      entry.bytes += bytes;
      entry.ms += ms;
    },
    storeCommit(store, action) {
      const name = key(report.stores, `${store}.${action ?? "set"}`);
      report.stores[name] = (report.stores[name] ?? 0) + 1;
    },
    render(id, ms) {
      addDuration(report.renders, id.split(":", 1)[0]!, ms);
    },
    timer(source, ms) {
      addDuration(report.timers, source, ms);
    },
    lag(ms) {
      report.longestTaskMs = Math.max(report.longestTaskMs, ms);
    },
    flush() {
      const end = now();
      const finished = { ...report, windowMs: end - windowStart };
      windowStart = end;
      report = emptyReport();
      return finished;
    },
  };
}

function emptyReport(): PerfReport {
  return { windowMs: 0, messages: {}, stores: {}, renders: {}, timers: {}, longestTaskMs: 0 };
}

export function formatPerfLine(report: PerfReport): string {
  return `[clisbot:perf] ${JSON.stringify(report, roundDurations)}`;
}

function roundDurations(name: string, value: unknown): unknown {
  if (typeof value !== "number" || (name !== "ms" && name !== "longestTaskMs")) return value;
  return Math.round(value * 10) / 10;
}
