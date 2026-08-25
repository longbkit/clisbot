import type { TransactionHandle } from "../../index.js";
import type { EmbeddedLockLifecycle } from "../index.js";

export class EmbeddedLocks implements EmbeddedLockLifecycle {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly transactionReleases = new WeakMap<TransactionHandle, Map<string, () => void>>();

  async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire(key);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async withTxLock(transaction: TransactionHandle, key: string): Promise<void> {
    const held = this.transactionReleases.get(transaction) ?? new Map<string, () => void>();
    if (held.has(key)) return;
    held.set(key, await this.acquire(key));
    this.transactionReleases.set(transaction, held);
  }

  releaseTransaction(transaction: TransactionHandle): void {
    const held = this.transactionReleases.get(transaction);
    if (held === undefined) return;
    this.transactionReleases.delete(transaction);
    for (const release of held.values()) release();
  }

  private async acquire(key: string): Promise<() => void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    await previous;
    return () => {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    };
  }
}
