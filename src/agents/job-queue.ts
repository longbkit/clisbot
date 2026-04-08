type QueueTask<T> = () => Promise<T>;

export class AgentJobQueue {
  private tails = new Map<string, Promise<unknown>>();
  private pendingCounts = new Map<string, number>();

  enqueue<T>(key: string, task: QueueTask<T>) {
    const positionAhead = this.pendingCounts.get(key) ?? 0;
    const previous = this.tails.get(key) ?? Promise.resolve();
    this.pendingCounts.set(key, positionAhead + 1);

    const run = previous.catch(() => undefined).then(task);
    const tail = run.catch(() => undefined).finally(() => {
      const nextCount = (this.pendingCounts.get(key) ?? 1) - 1;
      if (nextCount <= 0) {
        this.pendingCounts.delete(key);
        this.tails.delete(key);
      } else {
        this.pendingCounts.set(key, nextCount);
      }
    });
    this.tails.set(
      key,
      tail,
    );

    return {
      positionAhead,
      result: run,
    };
  }

  isBusy(sessionKey: string) {
    for (const key of this.pendingCounts.keys()) {
      if (key === sessionKey || key.startsWith(`${sessionKey}:`)) {
        return true;
      }
    }

    return false;
  }
}
