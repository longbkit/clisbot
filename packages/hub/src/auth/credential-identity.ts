import type { DatabaseRuntime, QueryRow } from "../db/runtime/index.js";
import type { OperationAuthenticator } from "./operation-auth.js";
import { parseOrganizationRole } from "./organization-policy.js";

export const CREDENTIAL_IDENTITY_PATH = "/api/auth/paseo/credential";

interface IdentityRow extends QueryRow {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  role: string | null;
}

/**
 * Describes the organization-scoped bearer credential a CLI holds: which organization it acts in,
 * which account approved or created it, and that account's current role. The CLI shows this
 * before enrolling a daemon, so the operator sees exactly where the daemon will land.
 */
export class CredentialIdentity {
  constructor(
    private readonly pool: DatabaseRuntime,
    private readonly credentials: OperationAuthenticator,
    private readonly baseURL: string,
  ) {}

  async handle(request: Request): Promise<Response> {
    if (request.method !== "GET") return Response.json({ error: "not_found" }, { status: 404 });
    const authorization = await this.credentials.authorize(request, "daemons:enroll");
    if (authorization.status !== "authorized") {
      return Response.json(
        { error: authorization.status },
        { status: authorization.status === "forbidden" ? 403 : 401 },
      );
    }
    const { kind, credentialId, organizationId } = authorization.access;
    const table =
      kind === "cliCredential" ? "organization_cli_credentials" : "organization_api_keys";
    const result = await this.pool.query<IdentityRow>(
      `select o.id as organization_id, o.name as organization_name, o.slug as organization_slug,
              u.id as user_id, u.name as user_name, u.email as user_email, m.role
       from ${table} c
       join organization o on o.id = c.organization_id
       left join "user" u on u.id = c.created_by_user_id
       left join member m on m.organization_id = o.id and m.user_id = u.id
       where c.id = $1 and c.organization_id = $2`,
      [credentialId, organizationId],
    );
    const row = result.rows[0];
    if (row === undefined) return Response.json({ error: "unauthorized" }, { status: 401 });
    return Response.json({
      hub: new URL(this.baseURL).origin,
      credential: kind,
      organization: {
        id: row.organization_id,
        name: row.organization_name,
        slug: row.organization_slug,
      },
      account:
        row.user_id === null
          ? null
          : { id: row.user_id, name: row.user_name ?? "", email: row.user_email ?? "" },
      role: parseOrganizationRole(row.role ?? "") ?? null,
    });
  }
}
