export const PENDING_SESSION_EVENT_LIMITS = {
  sessionBytes: 8 * 1024 * 1024,
  totalBytes: 32 * 1024 * 1024,
  sessionEvents: 1024,
  totalEvents: 4096,
};

interface PendingEventLimits {
  sessionBytes: number;
  totalBytes: number;
  sessionEvents?: number;
  totalEvents?: number;
}

export class PendingEventBudgetError extends Error {}

/** Reservations precede promise closures, staged provider events and turn waiter buffers. */
export class PendingEventBudget {
  private bytes = 0;
  private events = 0;
  private readonly sessionEvents = new Map<string, number>();
  private readonly sessions = new Map<string, number>();
  constructor(private readonly limits: PendingEventLimits = PENDING_SESSION_EVENT_LIMITS) {}
  reserve(agentId: string, event: unknown): () => void {
    const eventCount = this.sessionEvents.get(agentId) ?? 0;
    if (
      eventCount >= (this.limits.sessionEvents ?? PENDING_SESSION_EVENT_LIMITS.sessionEvents) ||
      this.events >= (this.limits.totalEvents ?? PENDING_SESSION_EVENT_LIMITS.totalEvents)
    )
      throw new PendingEventBudgetError(
        "Session history overloaded: pending provider event count limit exceeded",
      );
    const bytes = Buffer.byteLength(JSON.stringify(event)) * 2 + 256;
    const sessionBytes = this.sessions.get(agentId) ?? 0;
    if (
      sessionBytes + bytes > this.limits.sessionBytes ||
      this.bytes + bytes > this.limits.totalBytes
    )
      throw new PendingEventBudgetError(
        "Session history overloaded: pending provider event byte limit exceeded",
      );
    this.bytes += bytes;
    this.events++;
    this.sessionEvents.set(agentId, eventCount + 1);
    this.sessions.set(agentId, sessionBytes + bytes);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.bytes -= bytes;
      this.events--;
      const remainingEvents = (this.sessionEvents.get(agentId) ?? 0) - 1;
      if (remainingEvents) this.sessionEvents.set(agentId, remainingEvents);
      else this.sessionEvents.delete(agentId);
      const remaining = (this.sessions.get(agentId) ?? 0) - bytes;
      if (remaining > 0) this.sessions.set(agentId, remaining);
      else this.sessions.delete(agentId);
    };
  }
  get pendingEvents(): number {
    return this.events;
  }
  get pendingBytes(): number {
    return this.bytes;
  }
  sessionBytes(agentId: string): number {
    return this.sessions.get(agentId) ?? 0;
  }
}

// Shared across all manager/waiter owners in this daemon process.
export const pendingSessionEvents = new PendingEventBudget();
