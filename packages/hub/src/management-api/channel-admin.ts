// Channel Route Admin: what a Member holding `channel.manage` on ONE Channel
// account may do through the management API (docs/features/access/scoped-admins.md,
// delegation-implementation.md row B). The organization capability keeps the
// full `channel-configuration` / `channel-accounts` surface in `index.ts`; this
// file is the narrowed one — that account's file, its activity and ingress,
// its status and QR relink. The Connection (bot token), the policy file and
// every other account stay out of reach: an account file saved here must keep
// its `connectionId`, `transport` and `config` exactly as stored.

import { dump, load } from "js-yaml";
import { z } from "zod";
import { assertChannelConfigurationDelegation } from "../access/delegation.js";
import type { AccessStore } from "../access/store.js";
import { ProductRequestError, type OrganizationAccessValue } from "../auth/organization-access.js";
import { holdsChannelAccountManagement } from "../channels/access-grants.js";
import type { CompiledChannelAccount } from "../channels/config/compile.js";
import { SupportedChannelNameSchema } from "../channels/config/enums.js";
import { AccountFileSchema, type AccountFile } from "../channels/config/schema.js";
import { channelConfigurationWarnings } from "../channels/configuration-warnings.js";
import type { ChannelControlPlaneSnapshot } from "../channels/control-plane.js";
import { deployRevision } from "../channels/http/configuration.js";
import { channelIngressAccountKey } from "../channels/ingress/health.js";
import { qrLoginVerb, QrLoginUnavailableError } from "../channels/supervisor/qr-login.js";
import type { ChannelSupervisor } from "../channels/supervisor/types.js";
import { CHANNELS_DIRECTORY, type HubBundleFile } from "../config/bundle-contract.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import type { Database } from "../db/types.js";
import { channelActivityPage, parseChannelActivityQuery } from "./channel-activity.js";
import {
  channelIngressListPage,
  channelIngressStatusView,
  parseChannelIngressListQuery,
  withChannelIngressHealth,
} from "./channel-ingress.js";
import { channelControlPlaneView } from "./channel-plane-gate.js";

/** Whether the management dispatch hands this request to the Route Admin
 * handler: an account-scoped path under the three channel resources, or any
 * `channel-accounts` path for a caller without the organization capability. */
export function channelAdminHandles(
  resource: string | undefined,
  segments: readonly string[],
  access: OrganizationAccessValue,
): boolean {
  const accountScoped =
    resource === "channel-configuration" ||
    resource === "channel-activity" ||
    resource === "channel-ingress";
  if (accountScoped) return segments[3] === "accounts";
  return resource === "channel-accounts" && !access.capabilities.manageChannels;
}

export interface ChannelAdminDeps {
  database: Database;
  runtime: DatabaseRuntime;
  access: AccessStore;
  channelSupervisor: ChannelSupervisor | null;
  /** The management API's cookie-mutation guard, run on every non-GET. */
  requireMutation: (request: Request) => void;
}

const accountFileRequestSchema = z
  .object({
    account: AccountFileSchema,
    expectedRevisionId: z.string().uuid().nullable(),
  })
  .strict();

/**
 * Route one request. `segments` is the whole management path
 * (`organizations/<id>/<resource>/...`). Handled shapes:
 *   channel-configuration/accounts/<channel>/<accountId>   GET | PUT
 *   channel-activity/accounts/<channel>/<accountId>        GET
 *   channel-ingress/accounts/<channel>/<accountId>         GET
 *   channel-accounts/<channel>/<accountId>/status          GET
 *   channel-accounts/<channel>/<accountId>/qr/<verb>       POST
 */
export async function handleChannelAccountAdmin(
  deps: ChannelAdminDeps,
  input: {
    request: Request;
    requestId: string;
    access: OrganizationAccessValue;
    segments: readonly string[];
  },
): Promise<Response> {
  const { request, requestId, access, segments } = input;
  const resource = segments[2];
  const targetAt = resource === "channel-accounts" ? 3 : 4;
  const target = accountTarget(segments.slice(targetAt));
  if (target === undefined) {
    // Without an account there is nothing a Route Admin may hold; the
    // organization-wide paths under `channel-accounts` are forbidden, not missing.
    if (!access.capabilities.manageChannels) throw new ProductRequestError(403, "forbidden");
    return notFound(requestId);
  }
  await authorizeChannelAccountAdmin(deps, access, target);
  if (request.method !== "GET") deps.requireMutation(request);
  const snapshot = await channelControlPlaneView(deps.database, access.organization.id);
  const account = snapshot.controlPlane.accounts.find(
    (candidate) => candidate.channel === target.channel && candidate.accountId === target.accountId,
  );
  if (account === undefined) return notFound(requestId, "channel_account_unavailable");
  const response = await accountOperation(deps, {
    request,
    requestId,
    access,
    resource,
    tail: segments.slice(targetAt + 2),
    target,
    snapshot,
    account,
  });
  return response ?? notFound(requestId);
}

/** The per-account operations, once the caller and the account are settled.
 * Undefined = no operation matches the path. */
async function accountOperation(
  deps: ChannelAdminDeps,
  input: {
    request: Request;
    requestId: string;
    access: OrganizationAccessValue;
    resource: string | undefined;
    tail: readonly string[];
    target: AccountTarget;
    snapshot: ChannelControlPlaneSnapshot;
    account: CompiledChannelAccount;
  },
): Promise<Response | undefined> {
  const { request, access, resource, tail, target, snapshot, account } = input;
  const organizationId = access.organization.id;
  const method = request.method;
  if (resource === "channel-configuration" && tail.length === 0) {
    if (method === "GET") return accountConfigurationView(deps, snapshot, account);
    if (method === "PUT") return saveAccountFile(deps, access, snapshot, account, request);
    return undefined;
  }
  if (tail.length === 0 && method === "GET" && resource === "channel-activity") {
    const query = scopedActivityQuery(request, target);
    return Response.json(await channelActivityPage(deps.runtime, organizationId, query));
  }
  if (tail.length === 0 && method === "GET" && resource === "channel-ingress") {
    const query = scopedIngressQuery(request, target);
    return Response.json(await channelIngressListPage(deps.runtime, organizationId, query));
  }
  if (resource !== "channel-accounts") return undefined;
  if (tail[0] === "status" && method === "GET") {
    return accountStatusView(deps, organizationId, target);
  }
  if (tail[0] === "qr" && method === "POST") {
    return accountQrLogin(deps, input.requestId, organizationId, { target, account }, tail[1]);
  }
  return undefined;
}

interface AccountTarget {
  channel: z.infer<typeof SupportedChannelNameSchema>;
  accountId: string;
}

function accountTarget(segments: readonly string[]): AccountTarget | undefined {
  const channel = SupportedChannelNameSchema.safeParse(segments[0]);
  const accountId = segments[1];
  if (!channel.success || accountId === undefined || accountId === "") return undefined;
  return { channel: channel.data, accountId };
}

/** The organization capability, or `channel.manage` on this one account. */
async function authorizeChannelAccountAdmin(
  deps: ChannelAdminDeps,
  access: OrganizationAccessValue,
  target: AccountTarget,
): Promise<void> {
  if (access.capabilities.manageChannels) return;
  const held = await holdsChannelAccountManagement(deps.runtime, {
    organizationId: access.organization.id,
    membershipId: access.membership.id,
    userId: access.account.id,
    ...target,
  });
  if (!held) throw new ProductRequestError(403, "forbidden");
}

function accountPath(account: { channel: string; accountId: string }): string {
  return `${CHANNELS_DIRECTORY}/${account.channel}/${account.accountId}.yml`;
}

/** The stored account file. */
function storedAccountFile(
  snapshot: ChannelControlPlaneSnapshot,
  account: CompiledChannelAccount,
): AccountFile | undefined {
  const file = snapshot.files.find(({ path }) => path === accountPath(account));
  return file === undefined ? undefined : AccountFileSchema.parse(load(file.content));
}

async function accountWarnings(
  deps: ChannelAdminDeps,
  snapshot: ChannelControlPlaneSnapshot,
  account: { channel: string; accountId: string },
) {
  const warnings = await channelConfigurationWarnings({
    database: deps.database,
    organizationId: snapshot.organizationId,
    bundle: snapshot.bundle,
    controlPlane: snapshot.controlPlane,
    triggers: await deps.database.listOrganizationTriggers(snapshot.organizationId),
  });
  return warnings.filter(
    (warning) => warning.channel === account.channel && warning.accountId === account.accountId,
  );
}

async function accountConfigurationView(
  deps: ChannelAdminDeps,
  snapshot: ChannelControlPlaneSnapshot,
  account: CompiledChannelAccount,
): Promise<Response> {
  return Response.json({
    revision:
      snapshot.revision === null
        ? null
        : { id: snapshot.revision.id, version: snapshot.revision.version },
    account: storedAccountFile(snapshot, account) ?? null,
    effective: account,
    warnings: await accountWarnings(deps, snapshot, account),
  });
}

/** Save one account file: same identity, same Connection/transport/config,
 * every Route re-checked against what the saver may delegate. */
async function saveAccountFile(
  deps: ChannelAdminDeps,
  access: OrganizationAccessValue,
  snapshot: ChannelControlPlaneSnapshot,
  account: CompiledChannelAccount,
  request: Request,
): Promise<Response> {
  const body = accountFileRequestSchema.safeParse(await request.json().catch(() => undefined));
  if (!body.success) throw new ProductRequestError(400, "invalid_request_body");
  const next = body.data.account;
  if (next.channel !== account.channel || next.accountId !== account.accountId) {
    throw new ProductRequestError(400, "invalid_channel_account_identity");
  }
  const stored = storedAccountFile(snapshot, account);
  if (stored === undefined) throw new ProductRequestError(404, "channel_account_unavailable");
  if (!access.capabilities.manageChannels && !keepsConnection(stored, next)) {
    throw new ProductRequestError(403, "channel_connection_change_forbidden");
  }
  const path = accountPath(account);
  const files: HubBundleFile[] = [
    ...snapshot.files.filter((file) => file.path !== path),
    { path, content: dump(next, { lineWidth: -1 }) },
  ];
  const warnings = await deployRevision(deps.database, snapshot, files, {
    createdByUserId: access.account.id,
    expectedRevisionId: body.data.expectedRevisionId,
    authorize: ({ bundle, controlPlane }) =>
      assertChannelConfigurationDelegation({
        access: deps.access,
        database: deps.database,
        principal: {
          organizationId: access.organization.id,
          userId: access.account.id,
          membershipId: access.membership.id,
        },
        bundle,
        controlPlane,
        routes: delegatedRoutes(account, next),
      }),
  });
  const reconciliation = await deps.channelSupervisor?.reconcile();
  const active = await channelControlPlaneView(deps.database, access.organization.id);
  const effective = active.controlPlane.accounts.find(
    (candidate) =>
      candidate.channel === account.channel && candidate.accountId === account.accountId,
  );
  return Response.json({
    revision:
      active.revision === null
        ? null
        : { id: active.revision.id, version: active.revision.version },
    account: effective === undefined ? null : storedAccountFile(active, effective),
    effective: effective ?? null,
    warnings: warnings.filter(
      (warning) => warning.channel === account.channel && warning.accountId === account.accountId,
    ),
    reconciliation: reconciliation ?? null,
  });
}

/** Every Route of this account: what the save re-checks. */
function delegatedRoutes(
  account: { channel: string; accountId: string },
  next: AccountFile,
): { channel: string; accountId: string; position: number }[] {
  return (next.routes ?? []).map((_, position) => ({
    channel: account.channel,
    accountId: account.accountId,
    position,
  }));
}

/** The parts of an account file only the organization may change. */
function keepsConnection(stored: AccountFile, next: AccountFile): boolean {
  return (
    stored.connectionId === next.connectionId &&
    JSON.stringify(stored.transport ?? null) === JSON.stringify(next.transport ?? null) &&
    JSON.stringify(stored.config ?? null) === JSON.stringify(next.config ?? null)
  );
}

function scopedActivityQuery(request: Request, target: AccountTarget) {
  const params = new URL(request.url).searchParams;
  params.set("channel", target.channel);
  params.set("accountId", target.accountId);
  return parseChannelActivityQuery(params);
}

function scopedIngressQuery(request: Request, target: AccountTarget) {
  const params = new URL(request.url).searchParams;
  params.set("channel", target.channel);
  params.set("accountId", target.accountId);
  return parseChannelIngressListQuery(params);
}

async function accountStatusView(
  deps: ChannelAdminDeps,
  organizationId: string,
  target: AccountTarget,
): Promise<Response> {
  const ingress = await channelIngressStatusView(deps.runtime, organizationId);
  const running =
    deps.channelSupervisor
      ?.status()
      .filter(
        ({ channel, account }) =>
          channelIngressAccountKey(channel, account) ===
          channelIngressAccountKey(target.channel, target.accountId),
      ) ?? [];
  return Response.json({
    runtimeAvailable: deps.channelSupervisor !== null,
    accounts: withChannelIngressHealth(running, ingress),
  });
}

async function accountQrLogin(
  deps: ChannelAdminDeps,
  requestId: string,
  organizationId: string,
  input: { target: AccountTarget; account: CompiledChannelAccount },
  segment: string | undefined,
): Promise<Response> {
  const verb = qrLoginVerb(segment);
  if (verb === undefined) return notFound(requestId);
  const supervisor = deps.channelSupervisor;
  if (supervisor === null || supervisor.qrLogin === undefined) {
    return problem(requestId, 503, "channel_runtime_unavailable", "Channel runtime is offline.");
  }
  try {
    return Response.json(
      await supervisor.qrLogin({
        organizationId,
        channel: input.target.channel,
        accountId: input.target.accountId,
        compiled: input.account,
        verb,
      }),
    );
  } catch (error) {
    if (error instanceof QrLoginUnavailableError) {
      return problem(requestId, 422, "qr_login_unsupported", error.message);
    }
    throw error;
  }
}

function notFound(requestId: string, error = "not_found"): Response {
  return problem(requestId, 404, error, "No management resource matches this path.");
}

/** Same problem shape `index.ts` renders, so the app parses one format. */
function problem(requestId: string, status: number, error: string, message: string): Response {
  return Response.json({ error, message, requestId }, { status });
}
