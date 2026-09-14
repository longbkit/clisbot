import type { AgentTimelineRow } from "../agent-timeline-store-types.js";

export const TIMELINE_MEMORY_LIMITS = {
  sessionBytes: 2 * 1024 * 1024,
  totalBytes: 32 * 1024 * 1024,
} as const;

/** Only acknowledged rows enter this budget. Pending writes belong to the journal admission budget. */
export class TimelineRetentionBudget {
  private readonly sessions = new Map<string, Map<number, number>>();
  private totalBytes = 0;
  constructor(
    private readonly discard: (agentId: string, seqs: ReadonlySet<number>) => void,
    private readonly limits: { sessionBytes: number; totalBytes: number } = TIMELINE_MEMORY_LIMITS,
  ) {}

  retain(agentId: string, rows: readonly AgentTimelineRow[]): void {
    const retained = this.sessions.get(agentId) ?? new Map<number, number>();
    this.sessions.delete(agentId);
    this.sessions.set(agentId, retained);
    for (const row of rows) {
      const bytes = Buffer.byteLength(JSON.stringify(row), "utf8") * 2 + 256;
      this.totalBytes += bytes - (retained.get(row.seq) ?? 0);
      retained.set(row.seq, bytes);
    }
    let sessionBytes = [...retained.values()].reduce((sum, bytes) => sum + bytes, 0);
    const dropped = new Set<number>();
    for (const [seq, bytes] of retained) {
      if (sessionBytes <= this.limits.sessionBytes) break;
      retained.delete(seq);
      dropped.add(seq);
      sessionBytes -= bytes;
      this.totalBytes -= bytes;
    }
    if (dropped.size) this.discard(agentId, dropped);
    for (const [oldAgentId, cached] of this.sessions) {
      if (this.totalBytes <= this.limits.totalBytes) break;
      const evicted = new Set<number>();
      for (const [seq, bytes] of cached) {
        if (this.totalBytes <= this.limits.totalBytes) break;
        cached.delete(seq);
        evicted.add(seq);
        this.totalBytes -= bytes;
      }
      if (evicted.size) this.discard(oldAgentId, evicted);
      if (!cached.size) this.sessions.delete(oldAgentId);
    }
  }
  delete(agentId: string): void {
    for (const bytes of this.sessions.get(agentId)?.values() ?? []) this.totalBytes -= bytes;
    this.sessions.delete(agentId);
  }
  get bytes(): number {
    return this.totalBytes;
  }
}
