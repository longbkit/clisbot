// Indexes on `channel_ingress_queue` that the Hub builds online at start
// instead of in a migration. The table holds every channel message for the
// retention window (a million rows on a busy Hub), so a build reads gigabytes;
// a migration would hold a write lock for that long inside the migrator's one
// transaction, and the pool's 3 s deadline would fail it on every boot. They are
// deliberately absent from `schema.ts`: drizzle-kit would generate exactly that
// migration.
import type { DatabaseRuntime, OnlineIndex } from "./runtime/index.js";

const TABLE = "channel_ingress_queue";

export const CHANNEL_INGRESS_ONLINE_INDEXES: readonly OnlineIndex[] = [
  // `ChannelInboxStore.listHeldBindings`, `holds` and `list(state: held)`.
  // `channel_ingress_queue_inbox_idx` puts `binding_key` before `inbox_state`,
  // so finding an account's held rows scanned every inbox row it ever had.
  // Held rows are few and short-lived, so this index stays tiny.
  {
    name: "channel_ingress_queue_held_idx",
    table: TABLE,
    definition: `("organization_id", "channel", "account_id", "binding_key", "created_at") where "inbox_state" = 'held'`,
  },
  // `ChannelInboxStore.threadContextSentTo`: one row per thread snapshot a
  // session confirmed taking. The predicate must stay textually the query's.
  {
    name: "channel_ingress_queue_thread_context_idx",
    table: TABLE,
    definition: `("organization_id", "channel", "account_id", "binding_key", "external_thread_id", "created_at") where ("payload" -> 'threadContextSentTo' ->> 'confirmed') = 'true'`,
  },
  // The retention sweep's batches (`ChannelStore.pruneChannelIngress`): with
  // `completed_at` in no index, finding the next batch of expired rows, and
  // proving none is left, read the whole table.
  {
    name: "channel_ingress_queue_completed_idx",
    table: TABLE,
    definition: `("organization_id", "completed_at") where "status" = 'completed'`,
  },
];

export interface ChannelIngressIndexLog {
  built?: (detail: { index: string; ms: number }) => void;
  failed?: (detail: { index: string; error: unknown }) => void;
}

/**
 * Build any missing index, one at a time. Runs in the background: the queries
 * work without them, only slower. A failure is logged and the next start
 * tries again.
 */
export async function ensureChannelIngressIndexes(
  runtime: Pick<DatabaseRuntime, "buildIndexOnline">,
  log: ChannelIngressIndexLog = {},
  now: () => number = Date.now,
): Promise<void> {
  for (const index of CHANNEL_INGRESS_ONLINE_INDEXES) {
    const started = now();
    try {
      if ((await runtime.buildIndexOnline(index)) === "built")
        log.built?.({ index: index.name, ms: now() - started });
    } catch (error) {
      log.failed?.({ index: index.name, error });
    }
  }
}
