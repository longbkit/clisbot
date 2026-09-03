import type { DatabaseRuntime, QueryRow } from "../db/runtime/index.js";

/** Stable OAuth identity shared by the Paseo native and desktop applications. */
export const PASEO_CLIENT_ID = "paseo-client";
export const HUB_ACCESS_SCOPE = "hub:access";
export const HUB_AUTHORIZATION_SCOPES = [HUB_ACCESS_SCOPE, "offline_access"] as const;
export const HUB_ORGANIZATION_CLAIM = "https://paseo.sh/organization_id";

export const PASEO_CLIENT_REDIRECT_URIS = [
  "paseo://hub-auth/callback",
  "http://127.0.0.1/hub-auth/callback",
  "http://[::1]/hub-auth/callback",
] as const;

interface AccountMembershipRow extends QueryRow {
  user_id: string;
  member_id: string;
  name: string;
  email: string;
  must_change_password: boolean;
  is_instance_operator: boolean;
}

/**
 * Owns the first-party OAuth registration and resolves live account membership.
 * Resource privileges deliberately remain outside OAuth tokens and are evaluated by AccessStore.
 */
export class ClientAuthorization {
  constructor(private readonly database: DatabaseRuntime) {}

  async initialize(): Promise<void> {
    await this.database.query(
      `insert into oauth_client (
         id, client_id, disabled, skip_consent, scopes, name, redirect_uris,
         token_endpoint_auth_method, grant_types, response_types, public, type,
         require_pkce, created_at, updated_at
       ) values (
         $1, $1, false, true, $2::text[], $3, $4::text[], 'none',
         $5::text[], $6::text[], true, 'native', true, now(), now()
       )
       on conflict (client_id) do update set
         disabled = false,
         skip_consent = true,
         scopes = excluded.scopes,
         name = excluded.name,
         redirect_uris = excluded.redirect_uris,
         token_endpoint_auth_method = excluded.token_endpoint_auth_method,
         grant_types = excluded.grant_types,
         response_types = excluded.response_types,
         public = excluded.public,
         type = excluded.type,
         require_pkce = excluded.require_pkce,
         updated_at = now()`,
      [
        PASEO_CLIENT_ID,
        [...HUB_AUTHORIZATION_SCOPES],
        "Paseo client",
        [...PASEO_CLIENT_REDIRECT_URIS],
        ["authorization_code", "refresh_token"],
        ["code"],
      ],
    );
  }

  async membership(userId: string, organizationId: string): Promise<AccountMembershipRow | null> {
    const result = await this.database.query<AccountMembershipRow>(
      `select
         u.id as user_id,
         m.id as member_id,
         u.name,
         u.email,
         u.must_change_password,
         u.is_instance_operator
       from "user" u
       join member m on m.user_id = u.id
       where u.id = $1 and m.organization_id = $2
       limit 1`,
      [userId, organizationId],
    );
    return result.rows[0] ?? null;
  }
}
