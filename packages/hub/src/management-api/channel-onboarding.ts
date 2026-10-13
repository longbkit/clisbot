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
  const rejected = await authorizeOnboarding(options, request, organizationId);
  if (rejected) return rejected;
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
    return handleAddChannel(options.database, request, options.operations, organizationId);
  return Response.json({ error: "not_found" }, { status: 404 });
}

async function authorizeOnboarding(
  options: Parameters<typeof accountChannelOnboarding>[0],
  request: Request,
  organizationId: string,
): Promise<Response | undefined> {
  const credential = request.headers.has("authorization")
    ? await options.credentials?.authorize(request, "configuration:install")
    : undefined;
  if (credential?.status === "forbidden") throw new ProductRequestError(403, "forbidden");
  if (credential?.status === "authorized") {
    if (credential.access.organizationId !== organizationId)
      throw new ProductRequestError(403, "organization_required");
    const table =
      credential.access.kind === "cliCredential"
        ? "organization_cli_credentials"
        : "organization_api_keys";
    const rows = await options.runtime.query<{ role: string }>(
      `select m.role from ${table} c join member m on m.user_id = c.created_by_user_id and m.organization_id = c.organization_id
       where c.id = $1 and c.organization_id = $2 and c.revoked_at is null`,
      [credential.access.credentialId, organizationId],
    );
    const role = parseOrganizationRole(rows.rows[0]?.role ?? "");
    if (!role || !capabilitiesFor(role).manageResources)
      throw new ProductRequestError(403, "forbidden");
  } else {
    const access = await options.auth.resolveOrganizationAccess(request);
    if (access.organization.id !== organizationId)
      throw new ProductRequestError(404, "organization_unavailable");
    if (!access.capabilities.manageResources) throw new ProductRequestError(403, "forbidden");
    if (request.method !== "GET") {
      const rejected = options.auth.rejectCookieMutation(request);
      if (rejected) return rejected;
    }
  }
  return undefined;
}
