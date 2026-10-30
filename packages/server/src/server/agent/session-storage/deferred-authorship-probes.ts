import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import type { Logger } from "pino";

/**
 * Cold records skip the startup authorship probe (docs/features/agent-session-storage/
 * cold-storage.md). Each runs once later: on the first history open of that agent, or in a
 * background drain that probes one record per event-loop turn.
 */
export class DeferredAuthorshipProbes {
  private readonly pending: Set<string>;
  private stopped = false;

  constructor(
    agentIds: Iterable<string>,
    private readonly probe: (agentId: string) => Promise<void>,
    private readonly logger: Logger,
  ) {
    this.pending = new Set(agentIds);
  }

  get size(): number {
    return this.pending.size;
  }

  /** Runs the probe for one agent if it is still deferred; a second call is a no-op. */
  async hydrate(agentId: string): Promise<void> {
    if (!this.pending.delete(agentId)) return;
    try {
      await this.probe(agentId);
    } catch (error) {
      this.logger.warn({ err: error, agentId }, "Deferred authorship probe failed");
    }
  }

  /**
   * Probes what is left through `run`, which must order the probe with that agent's history
   * writes. Stops early on `stop()`.
   */
  async drain(run: (agentId: string, probe: () => Promise<void>) => Promise<void>): Promise<void> {
    // A Set iteration skips entries deleted before it reaches them, so hydrated agents drop out.
    for (const agentId of this.pending) {
      if (this.stopped) return;
      await yieldToEventLoop();
      await run(agentId, () => this.hydrate(agentId)).catch((error: unknown) => {
        this.logger.warn({ err: error, agentId }, "Deferred authorship probe failed");
      });
    }
  }

  stop(): void {
    this.stopped = true;
  }
}
