import type { DatabaseRuntime } from "../db/runtime/index.js";

const BOOTSTRAP_ROW_ID = "default";

/** Durable first-run app-onboarding state. Existing instances are backfilled by the migration. */
export class InstanceAppOnboarding {
  constructor(private readonly database: DatabaseRuntime) {}

  async isComplete(): Promise<boolean> {
    const result = await this.database.query<{ complete: boolean }>(
      `select app_onboarding_completed_at is not null as complete
       from instance_bootstrap where id = $1`,
      [BOOTSTRAP_ROW_ID],
    );
    // No setup row is a pristine instance. Its later claim creates the incomplete row.
    return result.rows[0]?.complete ?? false;
  }

  async complete(): Promise<void> {
    const result = await this.database.query(
      `update instance_bootstrap
       set app_onboarding_completed_at = coalesce(app_onboarding_completed_at, now())
       where id = $1 and completed_at is not null`,
      [BOOTSTRAP_ROW_ID],
    );
    if (result.rowCount !== 1) throw new Error("instance app onboarding is unavailable");
  }
}
