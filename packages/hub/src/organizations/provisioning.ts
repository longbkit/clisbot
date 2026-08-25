import { randomUUID } from "node:crypto";
import type { QueryHandle } from "../db/runtime/index.js";
import {
  hashTemplate,
  UNLIMITED_TEMPLATE,
  type EntitlementTemplate,
} from "../entitlements/catalog.js";

export interface ProvisionedOrganization {
  id: string;
  slug: string;
  projectId: string;
}

/**
 * The entitlement a new organization is stamped with. Resolved by the caller before provisioning,
 * never fetched here: self-hosted (no billing) stamps the unlimited default; a hosted instance
 * stamps its Free plan from the catalog mirror. Keeping this a value the caller passes in is what
 * lets `src/organizations/` stay clear of `src/billing/` — see the plan's boundary rule.
 */
export interface ProvisioningEntitlement {
  /** The plan that produced this template, or null for the self-hosted unlimited default. */
  planId: string | null;
  granted: EntitlementTemplate;
}

/** Resolves the entitlement to stamp at provisioning time, so a Free plan synced after boot is
 * picked up on the next org creation rather than frozen at composition. */
export type ProvisioningEntitlementResolver = () => Promise<ProvisioningEntitlement>;

/** Self-hosted default: no billing means no limits (see the plan's deletion test). */
export const UNLIMITED_PROVISIONING: ProvisioningEntitlement = {
  planId: null,
  granted: UNLIMITED_TEMPLATE,
};

export async function provisionOrganization(
  client: QueryHandle,
  input: { organizationId: string; name: string; ownerUserId: string },
  entitlement: ProvisioningEntitlement,
): Promise<ProvisionedOrganization> {
  const slug = organizationSlug(input.name, input.organizationId);
  const projectId = randomUUID();
  await client.query(`insert into organization (id, name, slug) values ($1, $2, $3)`, [
    input.organizationId,
    input.name,
    slug,
  ]);
  await client.query(
    `insert into member (id, organization_id, user_id, role)
     values ($1, $2, $3, 'owner')`,
    [randomUUID(), input.organizationId, input.ownerUserId],
  );
  await client.query(
    `insert into projects (id, organization_id, name, slug, created_by_user_id)
     values ($1, $2, 'Default', 'default', $3)`,
    [projectId, input.organizationId, input.ownerUserId],
  );
  await client.query(
    `insert into project_configuration_sources
       (project_id, organization_id, kind, automatic_deployment_enabled, selected_by_user_id)
     values ($1, $2, 'manual', false, $3)`,
    [projectId, input.organizationId, input.ownerUserId],
  );
  await stampProvisioningEntitlements(client, input.organizationId, input.ownerUserId, entitlement);
  return { id: input.organizationId, slug, projectId };
}

/**
 * Every organization is stamped at provisioning — `EntitlementsService.read()` throws
 * for an organization with no row, so this insert cannot be skipped or deferred. The stamp
 * shares the provisioning transaction, so the row and the audit trail land atomically with the
 * organization itself.
 */
async function stampProvisioningEntitlements(
  client: QueryHandle,
  organizationId: string,
  ownerUserId: string,
  entitlement: ProvisioningEntitlement,
): Promise<void> {
  const { granted, planId } = entitlement;
  await client.query(
    `insert into organization_entitlements
       (organization_id, granted, overrides, plan_id, plan_version, stamped_at, updated_at)
     values ($1, $2::jsonb, '{}'::jsonb, $3, $4, now(), now())`,
    [organizationId, JSON.stringify(granted), planId, hashTemplate(granted)],
  );
  await client.query(
    `insert into entitlement_changes (organization_id, actor, source, before, after, reason)
     values ($1, $2, 'provisioning', null, $3::jsonb, null)`,
    [organizationId, ownerUserId, JSON.stringify({ granted, overrides: {} })],
  );
}

export function organizationSlug(name: string, id: string): string {
  const stem = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 48);
  return `${stem.length === 0 ? "organization" : stem}-${id.slice(0, 8)}`;
}
