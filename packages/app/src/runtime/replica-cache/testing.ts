import type { ReplicaHostRows, ReplicaRow, ReplicaRowChanges, ReplicaRowStore } from "./row-store";

/** An in-memory row store for cache tests, with hooks to gate and fail reads and writes. */
export class MemoryStorage implements ReplicaRowStore {
  readonly rows = new Map<string, ReplicaRow>();
  readonly changes: ReplicaRowChanges[] = [];
  readonly reads: Array<{
    serverId: string;
    kinds: readonly ReplicaRow["kind"][];
    ids?: readonly string[];
  }> = [];
  writes = 0;
  cleanups = 0;
  nextWriteFailure: Error | null = null;
  persistentWriteFailure: Error | null = null;
  writeGate: Promise<void> | null = null;
  onWrite: (() => void) | null = null;
  readGate: Promise<void> | null = null;
  onRead: (() => void) | null = null;
  /** Throws once a read goes past this count, so a non-terminating read loop fails the test. */
  readLimit: number | null = null;

  private key(row: Pick<ReplicaRow, "serverId" | "kind" | "id">): string {
    return `${row.serverId}:${row.kind}:${row.id}`;
  }

  async open(): Promise<void> {}

  async read(
    serverId: string,
    kinds: readonly ReplicaRow["kind"][],
    ids?: readonly string[],
  ): Promise<ReplicaRow[]> {
    this.reads.push({ serverId, kinds, ...(ids ? { ids } : {}) });
    if (this.readLimit !== null && this.reads.length > this.readLimit) {
      throw new Error(
        `replica cache read ${this.reads.length} passed the limit of ${this.readLimit}`,
      );
    }
    this.onRead?.();
    await this.readGate;
    const acceptedKinds = new Set(kinds);
    const acceptedIds = ids ? new Set(ids) : null;
    return [...this.rows.values()].filter(
      (row) =>
        row.serverId === serverId &&
        acceptedKinds.has(row.kind) &&
        (!acceptedIds || acceptedIds.has(row.id)),
    );
  }

  async readAll(): Promise<ReplicaHostRows[]> {
    const hosts = new Map<string, ReplicaRow[]>();
    for (const row of this.rows.values()) {
      const rows = hosts.get(row.serverId) ?? [];
      rows.push(row);
      hosts.set(row.serverId, rows);
    }
    return [...hosts].map(([serverId, rows]) => ({ serverId, rows }));
  }

  async apply(changes: ReplicaRowChanges): Promise<void> {
    this.writes += 1;
    this.onWrite?.();
    await this.writeGate;
    if (this.persistentWriteFailure) throw this.persistentWriteFailure;
    if (this.nextWriteFailure) {
      const error = this.nextWriteFailure;
      this.nextWriteFailure = null;
      throw error;
    }
    this.changes.push(changes);
    for (const key of changes.deletes) this.rows.delete(this.key(key));
    for (const row of changes.upserts) this.rows.set(this.key(row), row);
  }

  async deleteHost(serverId: string): Promise<void> {
    for (const [key, row] of this.rows) if (row.serverId === serverId) this.rows.delete(key);
  }

  async renameHost(oldServerId: string, newServerId: string): Promise<void> {
    for (const [key, row] of this.rows) {
      if (row.serverId !== oldServerId) continue;
      this.rows.delete(key);
      const renamed = { ...row, serverId: newServerId };
      this.rows.set(this.key(renamed), renamed);
    }
  }

  async deleteOpenedBefore(cutoff: number): Promise<void> {
    for (const [key, row] of this.rows)
      if (row.openedAt !== undefined && row.openedAt < cutoff) this.rows.delete(key);
  }

  async clear(): Promise<void> {
    this.rows.clear();
  }
}
