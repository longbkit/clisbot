import type { DatabaseRuntime } from "../db/runtime/index.js";

/** Replays durable revocations only after the enrolled daemon session is ready. */
export async function reconcileDaemonLeaseRevocations(
  runtime: Pick<DatabaseRuntime, "query">,
  daemonId: string,
  notify: (leaseIds: readonly string[]) => boolean,
): Promise<void> {
  let after: string | null = null;
  for (;;) {
    const result: { rows: Array<{ id: string }> } = await runtime.query<{ id: string }>(
      `select id from daemon_access_leases where daemon_id = $1
       and revoked_at is not null and expires_at > now()
       and ($2::uuid is null or id > $2::uuid) order by id limit 256`,
      [daemonId, after],
    );
    if (!result.rows.length) return;
    if (!notify(result.rows.map((lease) => lease.id)))
      throw new Error("Daemon disconnected before persisted access revocations were delivered");
    if (result.rows.length < 256) return;
    after = result.rows[result.rows.length - 1]!.id;
  }
}
