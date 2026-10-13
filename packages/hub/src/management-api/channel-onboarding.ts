import type { OperationAuthorization } from "../auth/api-keys.js";
import type { OnboardingAuthority } from "../channels/http/onboarding.js";
import { z } from "zod";
import type { Database } from "../db/types.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import type { BrowserOrganizationAccess } from "../auth/browser-organization-access.js";
import type { OperationAuthenticator } from "../auth/operation-auth.js";
import { capabilitiesFor, parseOrganizationRole } from "../auth/organization-policy.js";
import { ProductRequestError } from "../auth/organization-access.js";
import { isChannelsEnabled } from "../channels/loader/channel-gate.js";
import { loadChannelControlPlane } from "../channels/control-plane.js";
import {
  handleAddChannel,
  handleChannelStatus,
  type ChannelControlPlaneOpsOptions,
} from "../channels/http/operations.js";

/** Authenticated counterpart of OS-local onboarding. A credential retains only its
 * approving Member's current organization authority; it never becomes an instance secret. */
export async function accountChannelOnboarding(
  options: {
    database: Database;
    runtime: DatabaseRuntime;
    auth: BrowserOrganizationAccess;
    credentials?: OperationAuthenticator;
    operations: ChannelControlPlaneOpsOptions;
  },
  request: Request,
  organizationId: string,
  suffix?: string,
): Promise<Response> {
  if (!isChannelsEnabled()) return Response.json({ error: "not_found" }, { status: 404 });
  const authority = await authorizeOnboarding(options, request, organizationId);
  if (authority instanceof Response) return authority;
  if (request.method === "GET" && suffix === "status") {
    const snapshot = await loadChannelControlPlane(options.database, organizationId);
    const allowed = new Set(
      snapshot.controlPlane.accounts.map((account) => `${account.channel}:${account.accountId}`),
    );
    const raw: unknown = await (await handleChannelStatus(options.operations.supervisor)).json();
    const body = z
      .object({
        accounts: z.array(z.object({ channel: z.string(), account: z.string() }).passthrough()),
      })
      .parse(raw);
    return Response.json({
      accounts: body.accounts.filter((account: { channel: string; account: string }) =>
        allowed.has(`${account.channel}:${account.account}`),
      ),
    });
  }
  if ((request.method === "POST" || request.method === "PUT") && suffix === undefined)
    return handleAddChannel(
      options.database,
      request,
      {
        ...options.operations,
        ...(options.operations.onboarding
          ? { onboarding: { ...options.operations.onboarding, authority } }
          : {}),
      },
      organizationId,
    );
  return Response.json({ error: "not_found" }, { status: 404 });
}

async function authorizeOnboarding(
  options: Parameters<typeof accountChannelOnboarding>[0],
  request: Request,
  organizationId: string,
): Promise<Response | OnboardingAuthority> {
  if (!request.headers.has("authorization"))
    return browserOnboardingAuthority(options, request, organizationId);
  const credential = await options.credentials?.authorize(request, "configuration:install");
  if (credential?.status === "forbidden") throw new ProductRequestError(403, "forbidden");
  if (credential?.status !== "authorized")
    throw new ProductRequestError(401, "invalid_credentials");
  return credentialOnboardingAuthority(options, credential.access, organizationId);
}

async function credentialOnboardingAuthority(
  options: Parameters<typeof accountChannelOnboarding>[0],
  credential: OperationAuthorization,
  organizationId: string,
): Promise<OnboardingAuthority> {
  if (credential.organizationId !== organizationId)
    throw new ProductRequestError(403, "organization_required");
  const table =
    credential.kind === "cliCredential" ? "organization_cli_credentials" : "organization_api_keys";
  const rows = await options.runtime.query<{ role: string; user_id: string; member_id: string }>(
    `select m.role, m.user_id, m.id as member_id from ${table} c join member m on m.user_id = c.created_by_user_id and m.organization_id = c.organization_id
     where c.id = $1 and c.organization_id = $2 and c.revoked_at is null`,
    [credential.credentialId, organizationId],
  );
  const role = parseOrganizationRole(rows.rows[0]?.role ?? "");
  const actor = rows.rows[0];
  if (!role || !actor || !capabilitiesFor(role).manageResources)
    throw new ProductRequestError(403, "forbidden");
  return {
    kind: "account",
    userId: actor.user_id,
    membershipId: actor.member_id,
    isInstanceOperator: false,
    source: credential.kind,
  };
}

async function browserOnboardingAuthority(
  options: Parameters<typeof accountChannelOnboarding>[0],
  request: Request,
  organizationId: string,
): Promise<Response | OnboardingAuthority> {
  const access = await options.auth.resolveOrganizationAccess(request);
  if (access.organization.id !== organizationId)
    throw new ProductRequestError(404, "organization_unavailable");
  if (!access.capabilities.manageResources) throw new ProductRequestError(403, "forbidden");
  const account = await options.auth.resolveAccount(request);
  if (account.account.id !== access.account.id) throw new ProductRequestError(403, "forbidden");
  if (request.method !== "GET") {
    const rejected = options.auth.rejectCookieMutation(request);
    if (rejected) return rejected;
  }
  return {
    kind: "account",
    userId: access.account.id,
    membershipId: access.membership.id,
    isInstanceOperator: account.isInstanceOperator,
    source: "browser",
  };
}
