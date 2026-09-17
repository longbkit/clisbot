import type { Logger } from "pino";

const SWEEP_INTERVAL_MS = 60_000;
/** Shorter windows are raised to this, so a load always has time to turn into visible work. */
const MIN_IDLE_WINDOW_MS = 60_000;

export interface IdleSessionHost {
  listLiveAgentIds(): string[];
  /** The idle window for this agent's provider; 0 keeps it resident. */
  resolveIdleWindowMs(agentId: string): number;
  /** True when nothing is using the agent's runtime and its provider certifies it idle. */
  isSessionIdle(agentId: string): boolean;
  closeIdleSession(agentId: string, idleMs: number): Promise<void>;
}

export interface IdleSessionClock {
  now(): number;
  setInterval(callback: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(timer: ReturnType<typeof setInterval>): void;
}

export interface IdleSessionReaperOptions {
  host: IdleSessionHost;
  logger: Logger;
  clock?: IdleSessionClock;
}

const SYSTEM_CLOCK: IdleSessionClock = {
  now: () => Date.now(),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (timer) => clearInterval(timer),
};

/**
 * Closes the provider runtime of agents that stayed idle for their provider's window. Closing keeps
 * the stored agent and its history; the next load resumes it. Any activity or any sweep that finds
 * the agent busy restarts its idle clock, so only continuous idleness counts.
 */
export class IdleSessionReaper {
  private readonly host: IdleSessionHost;
  private readonly logger: Logger;
  private readonly clock: IdleSessionClock;
  private readonly idleSince = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: IdleSessionReaperOptions) {
    this.host = options.host;
    this.logger = options.logger;
    this.clock = options.clock ?? SYSTEM_CLOCK;
  }

  start(): void {
    if (this.timer) return;
    this.timer = this.clock.setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) this.clock.clearInterval(this.timer);
    this.timer = null;
    this.idleSince.clear();
  }

  markActive(agentId: string): void {
    this.idleSince.set(agentId, this.clock.now());
  }

  /** How long the agent has been continuously idle, or null when its window has not elapsed. */
  elapsedIdleMs(agentId: string): number | null {
    const windowMs = this.host.resolveIdleWindowMs(agentId);
    const since = this.idleSince.get(agentId);
    if (windowMs <= 0 || since === undefined) return null;
    const idleMs = this.clock.now() - since;
    return idleMs >= Math.max(windowMs, MIN_IDLE_WINDOW_MS) ? idleMs : null;
  }

  sweep(): void {
    const liveAgentIds = new Set(this.host.listLiveAgentIds());
    for (const agentId of this.idleSince.keys()) {
      if (!liveAgentIds.has(agentId)) this.idleSince.delete(agentId);
    }
    for (const agentId of liveAgentIds) {
      if (!this.idleSince.has(agentId) || !this.host.isSessionIdle(agentId)) {
        this.markActive(agentId);
        continue;
      }
      const idleMs = this.elapsedIdleMs(agentId);
      if (idleMs === null) continue;
      void this.host.closeIdleSession(agentId, idleMs).catch((error: unknown) => {
        this.logger.warn({ err: error, agentId }, "Failed to close idle agent session");
      });
    }
  }
}
