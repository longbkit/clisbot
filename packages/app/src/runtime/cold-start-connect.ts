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
  firstHostOnlineMs: number | null;
  /** Null when the deadline passed first. */
  allHostsOnlineMs: number | null;
}

export type ColdStartPhase = "hubBinding" | "hubAccount" | "hubList";

const COLD_START_DEADLINE_MS = 60_000;

interface ColdStartConnectTimelineDeps {
  now: () => number;
  report: (summary: ColdStartConnectSummary) => void;
  schedule: (callback: () => void, delayMs: number) => () => void;
}

export class ColdStartConnectTimeline {
  private readonly startedAt: number;
  private readonly phases = new Map<ColdStartPhase, number>();
  private pending: Set<string> | null = null;
  private hosts = 0;
  private failedAttempts = 0;
  private registryRestoredMs = 0;
  private firstHostOnlineMs: number | null = null;
  private finished = false;
  private cancelDeadline: () => void = () => undefined;

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
    const allOnline = this.pending.size === 0;
    this.deps.report({
      hosts: this.hosts,
      online: this.hosts - this.pending.size,
      failedAttempts: this.failedAttempts,
      registryRestoredMs: this.registryRestoredMs,
      hubBindingMs: this.phases.get("hubBinding") ?? null,
      hubAccountMs: this.phases.get("hubAccount") ?? null,
      hubListMs: this.phases.get("hubList") ?? null,
      firstHostOnlineMs: this.firstHostOnlineMs,
      allHostsOnlineMs: allOnline ? this.elapsed() : null,
    });
  }

  private elapsed(): number {
    return this.deps.now() - this.startedAt;
  }
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
  });
  Reflect.set(globalThis, GLOBAL_KEY, created);
  return created;
}
