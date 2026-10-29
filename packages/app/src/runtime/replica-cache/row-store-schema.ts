import type { ReplicaRowKind, ReplicaTailKind } from "./row-store";

// 2: chat transcript tails and the per-tail opened time. A version change drops the cache.
export const REPLICA_ROW_STORE_SCHEMA_VERSION = 2;

export const REPLICA_SINGLETON_ROW_ID = "singleton";

export function isReplicaTailKind(kind: ReplicaRowKind): kind is ReplicaTailKind {
  return kind === "timeline" || kind === "transcript";
}
