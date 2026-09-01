import type { DatabaseRuntime, QueryRow } from "../../db/runtime/index.js";
import { linearConnectionRequiresReauthorization } from "../../providers/linear/client.js";
import { hasRequiredSlackScopes } from "../../providers/slack/client.js";
import type { Provider, ProviderApplicationInventory } from "../index.js";

interface ConnectionIdentityRow extends QueryRow {
  id: string;
  name: string;
  application_id: string | null;
  action_needed: boolean;
  scopes: unknown;
  refresh_token?: unknown;
  access_token_expires_at?: unknown;
}

/** @package */
export function createProviderApplicationInventory(
  database: DatabaseRuntime,
): ProviderApplicationInventory & { organizationSlug(id: string): Promise<string | undefined> } {
  return {
    async connectedIdentities(provider) {
      const result = await database.query<ConnectionIdentityRow>(connectionIdentityQuery(provider));
      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        applicationId: row.application_id,
        status:
          row.action_needed ||
          (provider === "slack" &&
            (!Array.isArray(row.scopes) || !hasRequiredSlackScopes(row.scopes))) ||
          (provider === "linear" && linearConnectionActionNeeded(row))
            ? "actionNeeded"
            : "connected",
      }));
    },
    async lastEventAt(provider, identity, configurationVersion) {
      if (provider === "discord") return null;
      const result = await database.query<{ received_at: Date | string | null }>(
        `select max(received_at) as received_at
         from provider_event_receipts
         where provider = $1 and signature_hash is not null
           and provider_application_id = $2
           and provider_configuration_version = $3`,
        [provider, identity.id, configurationVersion],
      );
      const value = result.rows[0]?.received_at;
      return value === null || value === undefined ? null : new Date(value);
    },
    async claimLegacyConnections(provider, identity) {
      const table = connectionTable(provider);
      return database.transaction(async (transaction) => {
        await transaction.query(
          `update ${table} set provider_application_id = $1
           where provider_application_id is null`,
          [identity.id],
        );
        const ownership = await transaction.query<{ owned: boolean }>(
          `select exists (select 1 from ${table})
              and not exists (
                select 1 from ${table}
                where provider_application_id is null or provider_application_id <> $1
              ) as owned`,
          [identity.id],
        );
        return ownership.rows[0]?.owned === true;
      });
    },
    async organizationSlug(id) {
      const result = await database.query<{ slug: string }>(
        `select slug from organization where id = $1`,
        [id],
      );
      return result.rows[0]?.slug;
    },
  };
}

function connectionTable(provider: Provider): string {
  if (provider === "github") return "github_connections";
  if (provider === "slack") return "slack_connections";
  if (provider === "linear") return "linear_connections";
  return "discord_connections";
}

function connectionIdentityQuery(provider: Provider): string {
  if (provider === "github") {
    return `select id::text as id, account_login as name,
                   provider_application_id as application_id,
                   status = 'suspended' as action_needed, null::jsonb as scopes
            from github_connections order by connected_at`;
  }
  if (provider === "slack") {
    return `select id::text as id, team_name as name,
                   provider_application_id as application_id,
                   false as action_needed, scopes
            from slack_connections order by connected_at`;
  }
  if (provider === "linear") {
    return `select id::text as id, linear_organization_name as name,
                   provider_application_id as application_id,
                   false as action_needed, scopes, refresh_token, access_token_expires_at
            from linear_connections order by connected_at`;
  }
  return `select id::text as id, guild_name as name,
                 provider_application_id as application_id,
                 false as action_needed, null::jsonb as scopes
          from discord_connections order by connected_at`;
}

function linearConnectionActionNeeded(row: ConnectionIdentityRow): boolean {
  if (!isStringArray(row.scopes)) return true;
  const refreshToken = row.refresh_token;
  if (refreshToken !== null && typeof refreshToken !== "string") return true;
  const accessTokenExpiresAt = optionalDate(row.access_token_expires_at);
  if (accessTokenExpiresAt === undefined) return true;
  return linearConnectionRequiresReauthorization({
    scopes: row.scopes,
    refreshToken,
    accessTokenExpiresAt,
  });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function optionalDate(value: unknown): Date | null | undefined {
  if (value === null) return null;
  if (!(value instanceof Date) && typeof value !== "string") return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
