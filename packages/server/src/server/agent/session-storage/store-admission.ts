/**
 * The store refused new work because queued work has not drained; nothing was written. It is
 * deliberately not a `PendingEventBudgetError`: a caller that already assigned the refused row a
 * seq has a hole in its durable log and must treat this like any other failed write.
 */
export class SessionStorageOverloadError extends Error {}

export type StoreOperationKind = "read" | "write";

/**
 * Per-agent write limits sit above the pending event budget (1,024 events / 8 MiB estimated
 * per agent), so a manager write that reserved an event is refused there first; global limits
 * are several agents deep, so one stalled agent cannot refuse every other agent's writes.
 * Reads are counted apart: a stalled write never makes another caller's read fail admission.
 */
export const STORE_ADMISSION_LIMITS = {
  agentWriteOperations: 1536,
  agentWriteBytes: 8 * 1024 * 1024,
  writeOperations: 8192,
  writeBytes: 32 * 1024 * 1024,
  agentReadOperations: 1024,
  readOperations: 8192,
} as const;

interface Usage {
  operations: number;
  bytes: number;
}

interface Limits {
  agentOperations: number;
  agentBytes: number;
  operations: number;
  bytes: number;
}

function limitsFor(kind: StoreOperationKind): Limits {
  const limits = STORE_ADMISSION_LIMITS;
  return kind === "write"
    ? {
        agentOperations: limits.agentWriteOperations,
        agentBytes: limits.agentWriteBytes,
        operations: limits.writeOperations,
        bytes: limits.writeBytes,
      }
    : {
        agentOperations: limits.agentReadOperations,
        agentBytes: Number.POSITIVE_INFINITY,
        operations: limits.readOperations,
        bytes: Number.POSITIVE_INFINITY,
      };
}

class UsageLedger {
  private readonly total: Usage = { operations: 0, bytes: 0 };
  private readonly agents = new Map<string, Usage>();

  constructor(private readonly limits: Limits) {}

  admit(agentId: string, bytes: number): () => void {
    const agent = this.agents.get(agentId) ?? { operations: 0, bytes: 0 };
    if (
      agent.operations >= this.limits.agentOperations ||
      agent.bytes + bytes > this.limits.agentBytes ||
      this.total.operations >= this.limits.operations ||
      this.total.bytes + bytes > this.limits.bytes
    )
      throw new SessionStorageOverloadError(
        "Session storage overloaded: operation queue limit exceeded",
      );
    this.adjust(agentId, agent, 1, bytes);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.adjust(agentId, this.agents.get(agentId)!, -1, -bytes);
    };
  }

  usage(agentId?: string): Usage {
    const usage = agentId === undefined ? this.total : this.agents.get(agentId);
    return { operations: usage?.operations ?? 0, bytes: usage?.bytes ?? 0 };
  }

  private adjust(agentId: string, agent: Usage, operations: number, bytes: number): void {
    agent.operations += operations;
    agent.bytes += bytes;
    this.total.operations += operations;
    this.total.bytes += bytes;
    if (agent.operations === 0) this.agents.delete(agentId);
    else this.agents.set(agentId, agent);
  }
}

/** Process-wide: every store instance in the daemon shares one disk and one threadpool. */
const ledgers: Record<StoreOperationKind, UsageLedger> = {
  read: new UsageLedger(limitsFor("read")),
  write: new UsageLedger(limitsFor("write")),
};

/** Admits one store operation or throws `SessionStorageOverloadError`. Release exactly once. */
export function admitStoreOperation(
  agentId: string,
  kind: StoreOperationKind,
  bytes = 0,
): () => void {
  return ledgers[kind].admit(agentId, bytes);
}

export function storeOperationUsage(kind: StoreOperationKind, agentId?: string): Usage {
  return ledgers[kind].usage(agentId);
}
