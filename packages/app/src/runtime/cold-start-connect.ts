import { recordHostDiagnostic } from "./host-diagnostics";

/**
 * How long the Hub-managed Hosts restored at launch took to come online, as one diagnostic
 * event per app start (`cold-start-connect`). Each method is O(1) and nothing is written until
 * the summary, so it costs nothing measurable in production. Times are milliseconds since the
 * JS bundle started. See docs/features/offline/connection-resilience.md#cold-start-connect-path.
 */
export interface ColdStartConnectSummary {
  hosts: number;
  online: number;
  /** Connect attempts of these Hosts that ended offline or in error before the summary. */
  failedAttempts: number;
  registryRestoredMs: number;
  /** The first Hub binding registered (from the remembered or the live daemon list). */
  hubBindingMs: number | null;
  /** The first Hub account read answered. */
  hubAccountMs: number | null;
  /** The first live daemon list read answered. */
  hubListMs: number | null;
  /** The first Hub access token was refreshed (native; null when a valid one was held). */
  hubTokenMs: number | null;
  /** The first Host access ticket answered. */
  hubTicketMs: number | null;
  /** The first hello asked for its ticket: a transport and its relay handshake were open. */
  hostTransportOpenMs: number | null;
  /** Every restored Host's cached directory was read back. */
  cachedDirectoriesMs: number | null;
  /** The longest the JS thread was busy past a timer, from the registry restore to the summary. */
  jsStallMaxMs: number;
  /** All such delays added up; network answers wait this long for the JS thread. */
  jsStallTotalMs: number;
  firstHostOnlineMs: number | null;
  /** Null when the deadline passed first. */
  allHostsOnlineMs: number | null;
}

export type ColdStartPhase =
  | "hubBinding"
  | "hubAccount"
  | "hubList"
  | "hubToken"
  | "hubTicket"
  | "hostTransportOpen"
  | "cachedDirectories";

const COLD_START_DEADLINE_MS = 60_000;
/** Event-loop sampling step, and the lag below which the JS thread counts as free. */
const EVENT_LOOP_SAMPLE_MS = 100;
const EVENT_LOOP_STALL_MS = 50;

interface ColdStartConnectTimelineDeps {
  now: () => number;
  report: (summary: ColdStartConnectSummary) => void;
  schedule: (callback: () => void, delayMs: number) => () => void;
  /** Reports each delay past a sampling timer while watched; returns the stop. */
  watchEventLoop?: (onStall: (lagMs: number) => void) => () => void;
}

export class ColdStartConnectTimeline {
  private readonly startedAt: number;
  private readonly phases = new Map<ColdStartPhase, number>();
  private pending: Set<string> | null = null;
  private hosts = 0;
  private failedAttempts = 0;
  private registryRestoredMs = 0;
  private firstHostOnlineMs: number | null = null;
  private jsStallMaxMs = 0;
  private jsStallTotalMs = 0;
  private finished = false;
  private cancelDeadline: () => void = () => undefined;
  private stopWatchingEventLoop: () => void = () => undefined;

  constructor(private readonly deps: ColdStartConnectTimelineDeps) {
    this.startedAt = deps.now();
  }

  /** The registry is loaded; `serverIds` are the Hub-managed Hosts it restored. */
  registryRestored(serverIds: readonly string[]): void {
    if (this.pending !== null || this.finished) return;
    this.registryRestoredMs = this.elapsed();
    if (serverIds.length === 0) {
      this.finished = true;
      return;
    }
    this.pending = new Set(serverIds);
    this.hosts = serverIds.length;
    this.cancelDeadline = this.deps.schedule(() => this.finish(), COLD_START_DEADLINE_MS);
    // From the registry restore on: before it nothing connects, and the deadline ends the watch.
    this.stopWatchingEventLoop =
      this.deps.watchEventLoop?.((lagMs) => {
        this.jsStallMaxMs = Math.max(this.jsStallMaxMs, lagMs);
        this.jsStallTotalMs += lagMs;
      }) ?? (() => undefined);
  }

  mark(phase: ColdStartPhase): void {
    if (this.finished || this.phases.has(phase)) return;
    this.phases.set(phase, this.elapsed());
  }

  attemptFailed(serverId: string): void {
    if (!this.finished && this.pending?.has(serverId)) this.failedAttempts += 1;
  }

  hostOnline(serverId: string): void {
    if (this.finished || !this.pending?.delete(serverId)) return;
    this.firstHostOnlineMs ??= this.elapsed();
    if (this.pending.size === 0) this.finish();
  }

  private finish(): void {
    if (this.finished || this.pending === null) return;
    this.finished = true;
    this.cancelDeadline();
    this.stopWatchingEventLoop();
    const allOnline = this.pending.size === 0;
    this.deps.report({
      hosts: this.hosts,
      online: this.hosts - this.pending.size,
      failedAttempts: this.failedAttempts,
      registryRestoredMs: this.registryRestoredMs,
      hubBindingMs: this.phase("hubBinding"),
      hubAccountMs: this.phase("hubAccount"),
      hubListMs: this.phase("hubList"),
      hubTokenMs: this.phase("hubToken"),
      hubTicketMs: this.phase("hubTicket"),
      hostTransportOpenMs: this.phase("hostTransportOpen"),
      cachedDirectoriesMs: this.phase("cachedDirectories"),
      jsStallMaxMs: this.jsStallMaxMs,
      jsStallTotalMs: this.jsStallTotalMs,
      firstHostOnlineMs: this.firstHostOnlineMs,
      allHostsOnlineMs: allOnline ? this.elapsed() : null,
    });
  }

  private phase(phase: ColdStartPhase): number | null {
    return this.phases.get(phase) ?? null;
  }

  private elapsed(): number {
    return this.deps.now() - this.startedAt;
  }
}

/** A repeating timer: how late each tick fires is how long the JS thread was busy. */
function watchEventLoop(onStall: (lagMs: number) => void): () => void {
  let expected = Date.now() + EVENT_LOOP_SAMPLE_MS;
  const timer = setInterval(() => {
    const now = Date.now();
    const lag = now - expected;
    if (lag >= EVENT_LOOP_STALL_MS) onStall(lag);
    expected = now + EVENT_LOOP_SAMPLE_MS;
  }, EVENT_LOOP_SAMPLE_MS);
  return () => clearInterval(timer);
}

const GLOBAL_KEY = "__clisbotColdStartConnectTimeline";

/** One timeline per JS bundle start; Fast Refresh keeps it, as it keeps the runtime store. */
export function getColdStartConnectTimeline(): ColdStartConnectTimeline {
  const existing = Reflect.get(globalThis, GLOBAL_KEY);
  if (existing instanceof ColdStartConnectTimeline) return existing;
  const created = new ColdStartConnectTimeline({
    now: Date.now,
    report: (summary) => recordHostDiagnostic("cold-start-connect", { ...summary }),
    schedule: (callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      return () => clearTimeout(timer);
    },
    watchEventLoop,
  });
  Reflect.set(globalThis, GLOBAL_KEY, created);
  return created;
}
