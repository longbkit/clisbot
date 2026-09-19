// COMPAT(route-audience-rules): added 2026-09-19, remove after 2027-03-19.
//
// The one-time move from `channel.use` Access grants (and the old `match` +
// one-value `audience` route shape) to audience rules on every Route, run once
// per organization at Hub start (docs/audits/2026-09-19-route-audience-rules.md#migration-automatic).
// Idempotent: an organization with no old-shape route and no `channel.use`
// grant is skipped. What it writes is one new configuration revision per
// organization, then `channel.use` is removed from the folded rows (a
// Channel Route Admin row keeps `channel.manage`) — so a crash between
// the two leaves the grants in place and the next start folds them again
// (appending a duplicate rule, never losing one).

import { dump, load } from "js-yaml";
import {
  CHANNELS_DIRECTORY,
  CHANNEL_POLICY_PATH,
  type HubBundleFile,
} from "../config/bundle-contract.js";
import type { Database } from "../db/types.js";
import { createHash } from "node:crypto";
import type { ChannelUseGrant, ChannelUseGrantSource } from "./access-grants.js";
import {
  appendAudienceRule,
  fallbackInNewShape,
  migrateRouteAudience,
  routeInNewShape,
  whereFromChannelUseConstraint,
  whoFromChannelUseSubject,
} from "./config/audience-migration.js";
import { AccountFileSchema, type AccountFile, type AudienceRule } from "./config/schema.js";
import type { PlaneLogger } from "./plane/types.js";

export interface ChannelAudienceMigrationResult {
  organizationId: string;
  /** Account files rewritten (old shape and/or grants folded in). */
  accounts: number;
  /** Routes (fallbacks included) that received at least one grant rule. */
  routes: number;
  /** Grant rows folded; Use-only rows deleted, Admin rows keep Admin. */
  grants: number;
  revisionId: string | null;
}

const MIGRATION_COMMENT =
  "# Rewritten by the Hub on start: audience rules replace match/audience and channel.use grants (docs/audits/2026-09-19-route-audience-rules.md).\n";

/** Run the migration for every organization. Never throws for one
 * organization's failure: it is logged and the others still run. */
export async function migrateChannelAudiences(input: {
  database: Database;
  grants: ChannelUseGrantSource;
  logger: PlaneLogger;
}): Promise<ChannelAudienceMigrationResult[]> {
  const results: ChannelAudienceMigrationResult[] = [];
  for (const organization of await input.database.listOrganizationsForOperator()) {
    try {
      const result = await migrateOrganizationAudiences(input, organization.id);
      if (result !== undefined) results.push(result);
    } catch (error) {
      input.logger.warn("channel audience migration failed", {
        organizationId: organization.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export async function migrateOrganizationAudiences(
  input: { database: Database; grants: ChannelUseGrantSource; logger: PlaneLogger },
  organizationId: string,
): Promise<ChannelAudienceMigrationResult | undefined> {
  const active = await input.database.findActiveChannelConfiguration(organizationId);
  const grants = await input.grants.listChannelUseGrants(organizationId);
  if (active === undefined) {
    if (grants.length > 0) {
      input.logger.warn("channel audience migration left grants without a configuration", {
        organizationId,
        grants: grants.length,
      });
    }
    return undefined;
  }
  const rewritten = rewriteAccountFiles(active.files, grants);
  if (rewritten.changed.length === 0) {
    input.logger.debug?.("channel audience migration skipped", { organizationId });
    return undefined;
  }
  const canonical = [...rewritten.files].sort((left, right) => left.path.localeCompare(right.path));
  const revision = await input.database.saveChannelConfiguration({
    organizationId,
    files: canonical,
    contentHash: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
    createdByUserId: null,
    expectedRevisionId: active.id,
  });
  await input.grants.retireChannelUse(rewritten.foldedGrantIds);
  const result = {
    organizationId,
    accounts: rewritten.changed.length,
    routes: rewritten.routes,
    grants: rewritten.foldedGrantIds.length,
    revisionId: revision.id,
  };
  input.logger.info?.("channel audience migration applied", result);
  return result;
}

interface RewrittenFiles {
  files: HubBundleFile[];
  changed: string[];
  routes: number;
  foldedGrantIds: string[];
}

function rewriteAccountFiles(
  files: readonly HubBundleFile[],
  grants: readonly ChannelUseGrant[],
): RewrittenFiles {
  const result: RewrittenFiles = { files: [], changed: [], routes: 0, foldedGrantIds: [] };
  for (const file of files) {
    if (!file.path.startsWith(`${CHANNELS_DIRECTORY}/`) || file.path === CHANNEL_POLICY_PATH) {
      result.files.push(file);
      continue;
    }
    const parsed = AccountFileSchema.safeParse(load(file.content));
    if (!parsed.success) {
      result.files.push(file);
      continue;
    }
    const own = grants.filter(
      (grant) => grant.channel === parsed.data.channel && grant.accountId === parsed.data.accountId,
    );
    const folded = foldAccount(parsed.data, own);
    if (!folded.changed) {
      result.files.push(file);
      continue;
    }
    result.files.push({
      path: file.path,
      content: MIGRATION_COMMENT + dump(folded.account, { lineWidth: -1 }),
    });
    result.changed.push(file.path);
    result.routes += folded.routes;
    result.foldedGrantIds.push(...folded.grantIds);
  }
  return result;
}

/** One account file in the new shape with every grant rule appended. */
export function foldAccount(
  account: AccountFile,
  grants: readonly ChannelUseGrant[],
): { account: AccountFile; changed: boolean; routes: number; grantIds: string[] } {
  const legacy = (account.routes ?? []).some((route) => migrateRouteAudience(route).legacy);
  const legacyFallback =
    account.fallback !== undefined &&
    !("deny" in account.fallback) &&
    !Array.isArray(account.fallback.audience) &&
    account.fallback.audience !== undefined;
  const rules: { id: string; rule: AudienceRule }[] = [];
  for (const grant of grants) {
    const where = whereFromChannelUseConstraint(grant.conversation);
    if (where === undefined) continue;
    rules.push({
      id: grant.id,
      rule: { who: whoFromChannelUseSubject(grant.subjectKind, grant.subjectId), where },
    });
  }
  if (!legacy && !legacyFallback && rules.length === 0) {
    return { account, changed: false, routes: 0, grantIds: [] };
  }
  let routes = (account.routes ?? []).map(routeInNewShape);
  let fallback = account.fallback === undefined ? undefined : fallbackInNewShape(account.fallback);
  for (const { rule } of rules) {
    routes = routes.map((route) => appendAudienceRule(route, rule));
    if (fallback !== undefined && !("deny" in fallback))
      fallback = appendAudienceRule(fallback, rule);
  }
  const touched =
    rules.length === 0
      ? 0
      : routes.length + (fallback !== undefined && !("deny" in fallback) ? 1 : 0);
  return {
    account: {
      ...account,
      ...(account.routes === undefined ? {} : { routes }),
      ...(fallback === undefined ? {} : { fallback }),
    },
    changed: true,
    routes: touched,
    grantIds: rules.map(({ id }) => id),
  };
}
