import { randomUUID } from "node:crypto";
import type { DatabaseRuntime, QueryRow } from "../db/runtime/index.js";
import type { AccountSession } from "../auth/organization-access.js";
import {
  provisionOrganization,
  type ProvisioningEntitlement,
} from "../organizations/provisioning.js";

export async function bootstrapPersonalOwner(
  database: DatabaseRuntime,
  entitlement: ProvisioningEntitlement,
): Promise<void> {
  await database.transaction(async (transaction) => {
    // Share the first-operator lock and table locks with InstanceSetup. Personal startup never adopts a team.
    await transaction.query(
      `insert into instance_bootstrap (id) values ('default') on conflict (id) do nothing`,
    );
    await transaction.query(`select id from instance_bootstrap where id = 'default' for update`);
    await transaction.query(`lock table "user", organization in share row exclusive mode`);
    const state = await transaction.query(
      `select personal_user_id from device_authority where singleton = true for update`,
    );
    if (state.rows[0]?.["personal_user_id"]) return;
    const existing = await transaction.query(
      `select (select count(*) from "user") + (select count(*) from organization) as count`,
    );
    if (Number(existing.rows[0]?.["count"]) !== 0)
      throw new Error(
        "Personal onboarding requires a new Hub; existing accounts and organizations are preserved",
      );
    const userId = randomUUID();
    const organizationId = randomUUID();
    // Internal attribution only: no password/account entry, no deliverable address or reset flow.
    await transaction.query(
      `insert into "user" (id, name, email, email_verified, must_change_password, is_instance_operator)
      values ($1, 'Local owner', $2, false, false, true)`,
      [userId, `${userId}@personal.clisbot.invalid`],
    );
    await provisionOrganization(
      transaction,
      { organizationId, name: "Personal", ownerUserId: userId },
      entitlement,
    );
    await transaction.query(
      `update device_authority set personal_user_id = $1, personal_organization_id = $2 where singleton = true`,
      [userId, organizationId],
    );
    await transaction.query(
      `update instance_bootstrap set owner_user_id = $1, organization_id = $2, completed_at = now() where id = 'default'`,
      [userId, organizationId],
    );
  });
}

interface PersonalOwnerRow extends QueryRow {
  id: string;
  name: string;
  email: string;
  personal_organization_id: string;
  must_change_password: boolean;
  is_instance_operator: boolean;
}

export async function personalOwnerSession(
  database: DatabaseRuntime,
  deviceId: string,
): Promise<AccountSession | undefined> {
  const result =
    await database.query<PersonalOwnerRow>(`select u.id, u.name, u.email, u.must_change_password,
      u.is_instance_operator, d.personal_organization_id from device_authority d
      join "user" u on u.id = d.personal_user_id where d.singleton = true`);
  const owner = result.rows[0];
  if (!owner) return undefined;
  return {
    sessionId: `device:${deviceId}`,
    userId: owner.id,
    name: owner.name,
    email: owner.email,
    activeOrganizationId: owner.personal_organization_id,
    mustChangePassword: owner.must_change_password,
    isInstanceOperator: owner.is_instance_operator,
  };
}
