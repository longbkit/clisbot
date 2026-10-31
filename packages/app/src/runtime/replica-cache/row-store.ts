export { REPLICA_ROW_STORE_SCHEMA_VERSION, REPLICA_SINGLETON_ROW_ID } from "./row-store-schema";

export type ReplicaRowKind =
  | "agent"
  | "workspace"
  | "project"
  | "timeline"
  | "transcript"
  | "checkpoint";

/** Session and chat tails: evicted per row, least recently opened first. */
export type ReplicaTailKind = Extract<ReplicaRowKind, "timeline" | "transcript">;

export interface ReplicaRowKey {
  serverId: string;
  kind: ReplicaRowKind;
  id: string;
}

export interface ReplicaRow extends ReplicaRowKey {
  payload: string;
  /** When the user last opened this tail (epoch ms). Metadata rows have none. */
  openedAt?: number;
}

export interface ReplicaRowChanges {
  upserts: ReplicaRow[];
  deletes: ReplicaRowKey[];
}

export interface ReplicaHostRows {
  serverId: string;
  rows: ReplicaRow[];
}

export interface ReplicaRowStore {
  open(): Promise<void>;
  read(
    serverId: string,
    kinds: readonly ReplicaRowKind[],
    ids?: readonly string[],
  ): Promise<ReplicaRow[]>;
  readAll(): Promise<ReplicaHostRows[]>;
  apply(changes: ReplicaRowChanges): Promise<void>;
  deleteHost(serverId: string): Promise<void>;
  renameHost(oldServerId: string, newServerId: string): Promise<void>;
  /** Drops every row whose `openedAt` is older than `cutoff`; metadata rows are never touched. */
  deleteOpenedBefore(cutoff: number): Promise<void>;
  clear(): Promise<void>;
}
