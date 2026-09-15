import { randomUUID } from "node:crypto";
import type { TransactionHandle } from "../db/runtime/index.js";
import type { Locks } from "../db/runtime/locks/index.js";
import { provisionOrganization, type ProvisioningEntitlement } from "./provisioning.js";

export interface DomainMembership {
  organizationId: string;
  role: "owner" | "member";
  /** True when this call created the organization (and therefore the first owner). */
  created: boolean;
}

/**
 * Finds or creates the one organization that owns `domain` and makes `userId` a member of it,
 * inside the caller's transaction. The transaction lock serializes registrations for the same
 * domain, and the `organization_email_domains` primary key backs it at the database: two
 * concurrent first registrations converge on one organization with one initial owner. Re-running
 * for a user that is already a member changes nothing.
 */
export async function provisionDomainMembership(
  client: TransactionHandle,
  locks: Locks,
  input: { domain: string; userId: string },
  entitlement: ProvisioningEntitlement,
): Promise<DomainMembership> {
  await locks.withTxLock(client, `paseo-organization-domain:${input.domain}`);
  const claimed = await client.query<{ organization_id: string }>(
    `select organization_id from organization_email_domains where domain = $1`,
    [input.domain],
  );
  const organizationId = claimed.rows[0]?.organization_id;
  if (organizationId === undefined) {
    const created = await provisionOrganization(
      client,
      { organizationId: randomUUID(), name: input.domain, ownerUserId: input.userId },
      entitlement,
    );
    await client.query(
      `insert into organization_email_domains (domain, organization_id) values ($1, $2)`,
      [input.domain, created.id],
    );
    return { organizationId: created.id, role: "owner", created: true };
  }
  await locks.withTxLock(client, `paseo-organization-membership:${organizationId}`);
  await client.query(
    `insert into member (id, organization_id, user_id, role)
     values ($1, $2, $3, 'member')
     on conflict (organization_id, user_id) do nothing`,
    [randomUUID(), organizationId, input.userId],
  );
  const membership = await client.query<{ role: string }>(
    `select role from member where organization_id = $1 and user_id = $2`,
    [organizationId, input.userId],
  );
  return {
    organizationId,
    role: membership.rows[0]?.role === "owner" ? "owner" : "member",
    created: false,
  };
}
