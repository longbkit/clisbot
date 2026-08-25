import type { QueryHandle, TransactionHandle } from "../index.js";
import { EmbeddedLocks } from "./internal/embedded.js";
import { PostgresLocks } from "./internal/postgres.js";

export interface Locks {
  withLock<T>(key: string, operation: () => Promise<T>): Promise<T>;
  withTxLock(transaction: TransactionHandle, key: string): Promise<void>;
}

/** @package */
export interface EmbeddedLockLifecycle extends Locks {
  releaseTransaction(transaction: TransactionHandle): void;
}

/** @package */
export function postgresLocks(
  withConnection: <T>(operation: (connection: QueryHandle) => Promise<T>) => Promise<T>,
): Locks {
  return new PostgresLocks(withConnection);
}

/** @package */
export function embeddedLocks(): EmbeddedLockLifecycle {
  return new EmbeddedLocks();
}
