export interface TimelineReadingPosition {
  agentId: string;
  epoch: string;
  itemId: string;
  seq: number;
  startSeq: number;
  endSeq: number;
  nearStart: boolean;
  nearEnd: boolean;
  hasOlder: boolean;
  hasNewer: boolean;
}
export interface AdjacentTimelineRequest {
  direction: "before" | "after";
  cursor: { epoch: string; seq: number };
  signal: AbortSignal;
}

/** At most one speculative request. Pages are committed by the existing owner. */
export class TimelineDirectionalPrefetch {
  private previous: TimelineReadingPosition | null = null;
  private controller: AbortController | null = null;
  private requestedBoundary: string | null = null;
  constructor(
    private readonly ports: {
      canPrefetch: (agentId: string) => boolean;
      fetch: (agentId: string, request: AdjacentTimelineRequest) => Promise<void>;
      reportError: (error: unknown) => void;
    },
  ) {}
  cancel(): void {
    this.controller?.abort();
    this.controller = null;
  }
  reset(): void {
    this.cancel();
    this.previous = null;
    this.requestedBoundary = null;
  }
  cursorChanged(agentId: string): void {
    if (this.previous?.agentId === agentId) this.cancel();
  }
  reading(position: TimelineReadingPosition): void {
    const previous = this.previous;
    this.previous = position;
    if (!previous || previous.agentId !== position.agentId || previous.epoch !== position.epoch) {
      this.cancel();
      this.requestedBoundary = null;
      return;
    }
    if (previous.itemId === position.itemId || previous.seq === position.seq) return;
    const direction = position.seq < previous.seq ? "before" : "after";
    const adjacentAvailable =
      direction === "before"
        ? position.nearStart && position.hasOlder
        : position.nearEnd && position.hasNewer;
    if (!adjacentAvailable || !this.ports.canPrefetch(position.agentId)) {
      this.cancel();
      return;
    }
    const seq = direction === "before" ? position.startSeq : position.endSeq;
    const boundary = JSON.stringify([position.agentId, position.epoch, direction, seq]);
    if (this.controller || boundary === this.requestedBoundary) return;
    this.requestedBoundary = boundary;
    const controller = new AbortController();
    this.controller = controller;
    void this.ports
      .fetch(position.agentId, {
        direction,
        cursor: { epoch: position.epoch, seq },
        signal: controller.signal,
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) this.ports.reportError(error);
      })
      .finally(() => {
        if (this.controller === controller) this.controller = null;
      });
  }
}
