export interface CommittedEventOutboxOptions {
  /** The agent's history writes still in flight, covering every row recorded so far. */
  pendingWrite: (agentId: string) => Promise<void> | undefined;
  /** True while the agent's history is known to be incomplete. */
  failed: (agentId: string) => boolean;
  onDeliveryError: (agentId: string, error: unknown) => void;
}

export interface PublishOptions {
  /** The delivery certifies a committed row, so it is dropped once history has failed. */
  cursor?: boolean;
}

interface Entry {
  deliver: () => void;
  write: Promise<void> | undefined;
  cursor: boolean;
  settled?: { promise: Promise<void>; resolve: () => void };
}

type Queue = Entry[];

/**
 * Publishes an agent's events in call order, each only after the history writes that were in
 * flight when it was published have committed. Provider events are processed without waiting
 * for their rows, so the store can group commit, while clients and turn waiters still never see
 * a row, a state or a turn end ahead of the history it follows.
 *
 * With nothing queued and no write in flight a delivery runs synchronously. Once history has
 * failed, queued deliveries are discarded, cursor deliveries are dropped and every other
 * delivery runs at once, so the failure itself still reaches clients while a write is stuck.
 */
export class CommittedEventOutbox {
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly options: CommittedEventOutboxOptions) {}

  publish(agentId: string, deliver: () => void, options?: PublishOptions): void {
    const cursor = options?.cursor === true;
    if (this.options.failed(agentId)) {
      if (!cursor) deliver();
      return;
    }
    const write = this.options.pendingWrite(agentId);
    const queue = this.queues.get(agentId);
    if (queue) {
      queue.push({ deliver, write, cursor });
      return;
    }
    if (!write) {
      deliver();
      return;
    }
    const created: Queue = [{ deliver, write, cursor }];
    this.queues.set(agentId, created);
    void this.drain(agentId, created);
  }

  /** Drops every delivery still waiting; called when the agent's history fails. */
  discard(agentId: string): void {
    const queue = this.queues.get(agentId);
    if (!queue) return;
    this.queues.delete(agentId);
    for (const entry of queue.splice(0)) entry.settled?.resolve();
  }

  /** Resolves once everything published so far was delivered or discarded. */
  delivered(agentId: string): Promise<void> {
    const last = this.queues.get(agentId)?.at(-1);
    if (!last) return Promise.resolve();
    if (!last.settled) {
      let resolve!: () => void;
      const promise = new Promise<void>((settle) => {
        resolve = settle;
      });
      last.settled = { promise, resolve };
    }
    return last.settled.promise;
  }

  has(agentId: string): boolean {
    return this.queues.has(agentId);
  }

  private async drain(agentId: string, queue: Queue): Promise<void> {
    while (queue.length > 0) {
      const entry = queue[0];
      // Write tails only grow, so waiting on each entry's own write never reorders entries.
      if (entry.write) await entry.write;
      if (this.queues.get(agentId) !== queue) return;
      queue.shift();
      if (!(entry.cursor && this.options.failed(agentId))) {
        try {
          entry.deliver();
        } catch (error) {
          this.options.onDeliveryError(agentId, error);
        }
      }
      entry.settled?.resolve();
    }
    this.queues.delete(agentId);
  }
}
