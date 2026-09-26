// Per-key promise chain: operations under one key run one after another,
// operations under different keys run freely. The `Map<key, Promise>` idiom
// `AgentStorage.queueRecordMutation` and `MessageReceipts.send` each keep
// privately, shared by the chat store, the transcript log and the engine
// (docs/features/bots-and-chats/plans/server-chat.md, §5).

export class KeyedSerialQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  /** Runs `operation` after every earlier operation under `key`; a failure never blocks the next. */
  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    // The caller sees the failure through `next`; the chain itself never rejects.
    const tracked: Promise<unknown> = next
      .catch(() => undefined)
      .finally(() => {
        if (this.tails.get(key) === tracked) this.tails.delete(key);
      });
    this.tails.set(key, tracked);
    return next;
  }

  /** Resolves once every operation queued so far has settled. */
  async idle(): Promise<void> {
    await Promise.allSettled(Array.from(this.tails.values()));
  }
}
