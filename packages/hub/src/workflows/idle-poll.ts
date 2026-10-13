import type { DatabaseRuntime } from "../db/runtime/index.js";

/** Only the embedded single-owner runtime can rely on immediate in-process event wakes.
 * Active workflows and leased terminal notifications retain the original 250ms cadence. */
export async function embeddedWorkflowNextPoll(runtime: DatabaseRuntime): Promise<number> {
  const result = await runtime.query<{ busy: boolean }>(`
    select exists (select 1 from workflow_wakeups)
      or exists (select 1 from trigger_runs where status = 'running'
        or (terminal_notification_pending_at is not null and terminal_notification_delivered_at is null)) as busy
  `);
  return result.rows[0]?.busy === true ? 250 : 5000;
}
