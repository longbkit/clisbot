/** A group commit stops growing here; later rows start the next batch. */
export const GROUP_COMMIT_LIMITS = { rows: 256, bytes: 1024 * 1024 } as const;

interface QueuedAppend<Row> {
  rows: readonly Row[];
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface Batch<Row> {
  appends: QueuedAppend<Row>[];
  rows: number;
  bytes: number;
}

export interface GroupCommitOptions<Row> {
  /** Queues an operation behind everything already queued for the agent. */
  schedule: (agentId: string, operation: () => Promise<void>) => Promise<void>;
  /** Writes the rows with one append and one fsync. */
  commit: (agentId: string, rows: readonly Row[]) => Promise<void>;
}

/**
 * Coalesces consecutive appends for one agent into one durable write. A batch accepts rows only
 * while it is the last queued operation for its agent and has not started, so joining it never
 * moves a row ahead of any other operation. Every append in a batch settles with that batch's
 * commit: acknowledged after its fsync, or rejected with its error.
 */
export class GroupCommit<Row> {
  private readonly open = new Map<string, Batch<Row>>();

  constructor(private readonly options: GroupCommitOptions<Row>) {}

  /** Any other operation queued for the agent ends the open batch. */
  close(agentId: string): void {
    this.open.delete(agentId);
  }

  append(agentId: string, rows: readonly Row[], bytes: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const append = { rows, resolve, reject };
      const open = this.open.get(agentId);
      if (
        open &&
        open.rows + rows.length <= GROUP_COMMIT_LIMITS.rows &&
        open.bytes + bytes <= GROUP_COMMIT_LIMITS.bytes
      ) {
        open.appends.push(append);
        open.rows += rows.length;
        open.bytes += bytes;
        return;
      }
      const batch: Batch<Row> = { appends: [append], rows: rows.length, bytes };
      void this.options.schedule(agentId, () => this.commit(agentId, batch)).catch(() => undefined);
      this.open.set(agentId, batch);
    });
  }

  private async commit(agentId: string, batch: Batch<Row>): Promise<void> {
    if (this.open.get(agentId) === batch) this.open.delete(agentId);
    try {
      await this.options.commit(
        agentId,
        batch.appends.flatMap((append) => append.rows),
      );
    } catch (error) {
      for (const append of batch.appends) append.reject(error);
      throw error;
    }
    for (const append of batch.appends) append.resolve();
  }
}
