// COMPAT(clisbot-control-plane): the channel control-plane's HTTP ops — the seven
// thin operations the CLI's `channels` and `users` verbs target (implementation
// doc §1.4, §3.2, §4-S4): channel add/list/status and user list/show/add/edit.
//
// Every op honors the same precedence: kill-switch off → the exact 404 problem
// body the public API gives unknown routes (byte-equivalence — a flag-off Hub
// is indistinguishable from a Hub without these routes); database unavailable
// → the shared 503; unauthenticated → 401; otherwise the handler. Self-auth:
// a present `Authorization: Bearer <token>` must equal the instance auth
// secret (constant-time compare, no loopback fallback); without one, the
// caller's address — stamped by the node server from the socket peer — must
// be loopback.
//
// Mutations (channel add, user add/edit) edit the active revision's authored
// files, pre-compile the channel control plane (fail the request before any
// write when the result would not compile), then insert + activate a new
// revision through the app's standard store — one mutation path, no fork of
// the activation semantics. Account files contain only connection ids; no token
// appears in a revision or on disk.

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { dump, load } from "js-yaml";
import { z } from "zod";
import { CHANNEL_POLICY_PATH } from "../../config/bundle-contract.js";
import { compileHubBundle, HubBundleError, type HubBundleFile } from "../../config/bundle.js";
import type { Database } from "../../db/types.js";
import { INTERNAL_CLIENT_ADDRESS_HEADER } from "../../http/client-address.js";
import {
  channelAgentNames,
  channelEnvironmentNames,
  assertOpenAudienceTargetSafety,
  loadChannelControlPlane,
  type ChannelControlPlaneSnapshot,
  ChannelControlPlaneError,
} from "../control-plane.js";
import {
  ChannelCompilationError,
  compileChannelControlPlane,
  type ChannelControlPlane,
} from "../config/compile.js";
import { isChannelsEnabled } from "../loader/channel-gate.js";
import type { ChannelReplyServer } from "../channel-reply.js";
import { assignmentCoversPrincipal } from "../policy.js";
import type { ChannelSupervisor } from "../supervisor/types.js";

/** The eight ops: one per CLI verb plus the tool-path channel-reply MCP
 * endpoint (E4). Responses are JSON, RFC 7807 problems, or MCP payloads. */
export interface ChannelControlPlaneOps {
  addChannel(request: Request): Promise<Response>;
  listChannels(request: Request): Promise<Response>;
  channelStatus(request: Request): Promise<Response>;
  listUsers(request: Request): Promise<Response>;
  showUser(request: Request, username: string): Promise<Response>;
  addUser(request: Request): Promise<Response>;
  editUser(request: Request, username: string): Promise<Response>;
  handleChannelReplyMcp(request: Request, token: string): Promise<Response>;
}

export interface ChannelControlPlaneOpsOptions {
  database: Database | null;
  completionTokenSecret: string | undefined;
  /** The per-account lifecycle driver; null degrades the transport step. */
  supervisor: ChannelSupervisor | null;
  /** The tool-path channel-reply MCP endpoint (E4); null degrades the
   * `/mcp/channel/<opaque-capability>` route to the shared 503. */
  channelReplyServer: ChannelReplyServer | null;
}

/** The P0 channels the control plane drives, and each one's default mode. */
const P0_TRANSPORT_MODE: Record<string, string> = {
  slack: "socket",
  telegram: "polling",
};

const channelAddBodySchema = z.discriminatedUnion("channel", [
  z
    .object({
      channel: z.literal("slack"),
      account: z.string().min(1).max(128),
      connectionId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      channel: z.literal("telegram"),
      account: z.string().min(1).max(128),
      botToken: z.string().min(1),
    })
    .strict(),
]);

const userAddBodySchema = z
  .object({
    username: z.string().min(1).max(64),
    name: z.string().min(1).optional(),
    identities: z.array(z.string().min(1)),
  })
  .strict();

const userEditBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    identities: z.array(z.string().min(1)).optional(),
  })
  .strict();

export function createChannelControlPlaneOps(
  options: ChannelControlPlaneOpsOptions,
): ChannelControlPlaneOps {
  return {
    addChannel: (request) =>
      gate(options, request, (database) => handleAddChannel(database, request, options)),
    listChannels: (request) =>
      gate(options, request, (database) => handleListChannels(database, options.supervisor)),
    channelStatus: (request) =>
      gate(options, request, () => handleChannelStatus(options.supervisor)),
    listUsers: (request) => gate(options, request, (database) => handleListUsers(database)),
    showUser: (request, username) =>
      gate(options, request, (database) => handleShowUser(database, request, username)),
    addUser: (request) =>
      gate(options, request, (database) => handleAddUser(database, request, options.supervisor)),
    editUser: (request, username) =>
      gate(options, request, (database) =>
        handleEditUser(database, request, username, options.supervisor),
      ),
    handleChannelReplyMcp: (request, token) => gateChannelReplyMcp(options, request, token),
  };
}

/** The channel-reply MCP gate (E4): the same precedence as `gate`, except the
 * endpoint itself — not a `Database` — carries the request. The ledger and
 * the post path were resolved at composition (application-runtime.ts), so the
 * only per-request unknown is whether the server exists (null → shared 503). */
function gateChannelReplyMcp(
  options: ChannelControlPlaneOpsOptions,
  request: Request,
  token: string,
): Promise<Response> {
  if (!isChannelsEnabled()) {
    return Promise.resolve(controlPlaneAbsent(request));
  }
  if (options.channelReplyServer === null) {
    return Promise.resolve(Response.json({ error: "database_unavailable" }, { status: 503 }));
  }
  const server = options.channelReplyServer;
  if (!authorized(request, options.completionTokenSecret) && server.accepts?.(token) !== true) {
    return Promise.resolve(
      problem(
        request,
        401,
        "invalid_credentials",
        "Invalid credentials",
        "provide the instance auth secret as a Bearer token, or call from loopback",
      ),
    );
  }
  return server
    .handle(request, token)
    .catch((error: unknown) => Promise.resolve(errorResponse(request, error)));
}

/** The per-op precedence: flag off → absent 404; database null → shared 503;
 * unauthenticated → 401; then the handler, with its failures mapped. */
function gate(
  options: ChannelControlPlaneOpsOptions,
  request: Request,
  handle: (database: Database) => Promise<Response>,
): Promise<Response> {
  if (!isChannelsEnabled()) {
    return Promise.resolve(controlPlaneAbsent(request));
  }
  if (options.database === null) {
    return Promise.resolve(Response.json({ error: "database_unavailable" }, { status: 503 }));
  }
  if (!authorized(request, options.completionTokenSecret)) {
    return Promise.resolve(
      problem(
        request,
        401,
        "invalid_credentials",
        "Invalid credentials",
        "provide the instance auth secret as a Bearer token, or call from loopback",
      ),
    );
  }
  const database = options.database;
  return handle(database).catch((error: unknown) => Promise.resolve(errorResponse(request, error)));
}

/** The exact 404 the public API gives unknown canonical routes — byte-equivalent. */
function controlPlaneAbsent(request: Request): Response {
  return problem(
    request,
    404,
    "not_found",
    "Not found",
    "No canonical API route matches this path.",
  );
}

/** A Bearer token must equal the instance auth secret (no loopback fallback);
 * without one, the caller's address must be loopback. */
function authorized(request: Request, completionTokenSecret: string | undefined): boolean {
  const header = request.headers.get("authorization");
  if (header !== null) {
    const token = /^Bearer\s+(.+)$/u.exec(header.trim())?.[1];
    if (token === undefined || completionTokenSecret === undefined) return false;
    const expected = Buffer.from(completionTokenSecret, "utf8");
    const presented = Buffer.from(token, "utf8");
    return expected.length === presented.length && timingSafeEqual(expected, presented);
  }
  const address = request.headers.get(INTERNAL_CLIENT_ADDRESS_HEADER);
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "localhost" ||
    address === "::ffff:127.0.0.1"
  );
}

/** Map a handler failure to its status + problem body. */
function errorResponse(request: Request, error: unknown): Response {
  if (error instanceof ControlPlaneHttpError) {
    return problem(request, error.status, error.code, error.title, error.detail);
  }
  return problem(
    request,
    500,
    "internal_error",
    "Internal error",
    "an unexpected failure occurred",
  );
}

/** A typed 4xx/5xx the handlers throw for their own failure classes. */
export class ControlPlaneHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "ControlPlaneHttpError";
  }
}

function invalidRequest(detail: string): ControlPlaneHttpError {
  return new ControlPlaneHttpError(400, "invalid_request", "Invalid request", detail);
}

function conflict(detail: string): ControlPlaneHttpError {
  return new ControlPlaneHttpError(409, "control_plane_conflict", "Conflict", detail);
}

function invalidConfiguration(detail: string): ControlPlaneHttpError {
  return new ControlPlaneHttpError(422, "invalid_configuration", "Invalid configuration", detail);
}

async function handleAddChannel(
  database: Database,
  request: Request,
  options: ChannelControlPlaneOpsOptions,
): Promise<Response> {
  const body = await parseJsonBody(request, channelAddBodySchema);
  if (body.account.includes("/") || body.account.includes("\0")) {
    throw invalidRequest("the account id must not contain '/'");
  }
  const snapshot = await loadSnapshot(database);
  const connectionId =
    body.channel === "telegram"
      ? (
          await database.configureTelegramConnection({
            organizationId: snapshot.organizationId,
            accountId: body.account,
            botToken: body.botToken,
          })
        ).connectionId
      : body.connectionId;
  const connection = await database.resolveChannelConnection({
    organizationId: snapshot.organizationId,
    channel: body.channel,
    connectionId,
  });
  if (connection === undefined) throw invalidRequest("the channel connection does not exist");
  const files = upsertAccountFile(snapshot, body.channel, body.account, connectionId);
  await deployRevision(database, snapshot, files);
  const start = await startAccount(options.supervisor, body.channel, body.account);
  return Response.json(
    {
      channel: body.channel,
      account: body.account,
      installed: start.installed,
      revision: true,
      transport: start.transport,
      ...(start.detail === undefined ? {} : { detail: start.detail }),
    },
    { status: 200 },
  );
}

async function handleListChannels(
  database: Database,
  supervisor: ChannelSupervisor | null,
): Promise<Response> {
  const snapshot = await loadSnapshot(database);
  const transports = new Map(
    (supervisor?.status() ?? []).map((entry) => [
      `${entry.channel}\0${entry.account}`,
      entry.transport,
    ]),
  );
  const accounts = snapshot.controlPlane.accounts.map((account) => {
    // The effective switch: org kill-switch AND channel switch AND account flag.
    const enabled = snapshot.controlPlane.enabled && account.channelEnabled && account.enabled;
    const transport =
      transports.get(`${account.channel}\0${account.accountId}`) ??
      (enabled ? "stopped" : "disabled");
    return {
      channel: account.channel,
      account: account.accountId,
      enabled,
      transport,
    };
  });
  return Response.json({ accounts }, { status: 200 });
}

function handleChannelStatus(supervisor: ChannelSupervisor | null): Promise<Response> {
  if (supervisor === null) {
    return Promise.resolve(Response.json({ accounts: [] }, { status: 200 }));
  }
  const accounts = supervisor.status().map((entry) =>
    Object.assign(
      {
        channel: entry.channel,
        account: entry.account,
        integrity: entry.integrity,
        loadTrace: entry.loadTrace,
        transport: entry.transport,
      },
      entry.pin === undefined ? {} : { pin: entry.pin },
      entry.detail === undefined ? {} : { detail: entry.detail },
    ),
  );
  return Promise.resolve(Response.json({ accounts }, { status: 200 }));
}

async function handleListUsers(database: Database): Promise<Response> {
  const snapshot = await loadSnapshot(database);
  const users = Object.entries(snapshot.controlPlane.users).map(([username, user]) =>
    userView(username, user, snapshot.controlPlane),
  );
  return Response.json({ users }, { status: 200 });
}

async function handleShowUser(
  database: Database,
  request: Request,
  username: string,
): Promise<Response> {
  const snapshot = await loadSnapshot(database);
  const user = snapshot.controlPlane.users[username];
  if (user === undefined) {
    return problem(
      request,
      404,
      "not_found",
      "Not found",
      `user "${username}" is not defined in the channel control plane`,
    );
  }
  return Response.json(userView(username, user, snapshot.controlPlane), {
    status: 200,
  });
}

async function handleAddUser(
  database: Database,
  request: Request,
  supervisor: ChannelSupervisor | null,
): Promise<Response> {
  const body = await parseJsonBody(request, userAddBodySchema);
  if (body.username.includes("/")) {
    throw invalidRequest("the username must not contain '/'");
  }
  const snapshot = await loadSnapshot(database);
  if (snapshot.controlPlane.users[body.username] !== undefined) {
    throw conflict(`user "${body.username}" already exists; use user edit`);
  }
  const files = upsertPolicyUser(snapshot, body.username, {
    identities: body.identities,
    ...(body.name === undefined ? {} : { name: body.name }),
  });
  await deployRevision(database, snapshot, files);
  const reconciliation = await supervisor?.reconcile();
  return Response.json(
    {
      username: body.username,
      deployed: true,
      ...(reconciliation === undefined ? {} : { reconciliation }),
    },
    { status: 200 },
  );
}

async function handleEditUser(
  database: Database,
  request: Request,
  username: string,
  supervisor: ChannelSupervisor | null,
): Promise<Response> {
  const body = await parseJsonBody(request, userEditBodySchema);
  if (body.name === undefined && body.identities === undefined) {
    throw invalidRequest("provide a name and/or identities to update");
  }
  const snapshot = await loadSnapshot(database);
  const existing = snapshot.controlPlane.users[username];
  if (existing === undefined) {
    return problem(
      request,
      404,
      "not_found",
      "Not found",
      `user "${username}" is not defined in the channel control plane`,
    );
  }
  // An omitted field keeps the existing value; `null` name is not editable.
  const name = body.name !== undefined ? body.name : existing.name;
  const files = upsertPolicyUser(snapshot, username, {
    ...(name === null ? {} : { name }),
    identities: body.identities !== undefined ? body.identities : [...existing.identities],
  });
  await deployRevision(database, snapshot, files);
  const reconciliation = await supervisor?.reconcile();
  return Response.json(
    {
      username,
      deployed: true,
      ...(reconciliation === undefined ? {} : { reconciliation }),
    },
    { status: 200 },
  );
}

async function loadSnapshot(database: Database): Promise<ChannelControlPlaneSnapshot> {
  try {
    return await loadChannelControlPlane(database);
  } catch (error) {
    if (error instanceof ChannelControlPlaneError) {
      throw new ControlPlaneHttpError(
        409,
        "control_plane_unavailable",
        "Control plane unavailable",
        error.message,
      );
    }
    throw error;
  }
}

async function parseJsonBody<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.infer<Schema>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw invalidRequest("the request body is not valid JSON");
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 5)
      .map((entry) => `${entry.path.join(".")}: ${entry.message}`)
      .join("; ");
    throw invalidRequest(`invalid request body${detail.length > 0 ? `: ${detail}` : ""}`);
  }
  return result.data;
}

/** Write/replace the account file into a copy of the active revision's files. */
function upsertAccountFile(
  snapshot: ChannelControlPlaneSnapshot,
  channel: string,
  account: string,
  connectionId: string,
): HubBundleFile[] {
  const path = `.paseo/channels/${channel}/${account}.yml`;
  const content = dump(
    {
      channel,
      accountId: account,
      enabled: true,
      connectionId,
      transport: { mode: P0_TRANSPORT_MODE[channel] },
      fallback: { deny: true },
    },
    { lineWidth: -1 },
  );
  const next = snapshot.files.filter((file) => file.path !== path);
  next.push({ path, content });
  return next;
}

/** Replace-or-add the policy file's `users[username]` record in a copy of the files. */
function upsertPolicyUser(
  snapshot: ChannelControlPlaneSnapshot,
  username: string,
  record: { identities: string[]; name?: string },
): HubBundleFile[] {
  const existing = snapshot.files.find((file) => file.path === CHANNEL_POLICY_PATH);
  const parsed: unknown = existing === undefined ? {} : load(existing.content);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw invalidRequest("the active channel policy is not a mapping");
  }
  const policy: Record<string, unknown> = { ...parsed };
  const existingUsers = policy["users"];
  const users: Record<string, unknown> =
    typeof existingUsers === "object" && existingUsers !== null && !Array.isArray(existingUsers)
      ? { ...(existingUsers as Record<string, unknown>) }
      : {};
  users[username] = record;
  policy["users"] = users;
  const next = snapshot.files.filter((file) => file.path !== CHANNEL_POLICY_PATH);
  next.push({
    path: CHANNEL_POLICY_PATH,
    content: dump(policy, { lineWidth: -1 }),
  });
  return next;
}

/**
 * Pre-compile the channel control plane from the candidate files, then insert
 * + activate a new revision. The pre-compile is the guard: `activate`
 * validates the hub bundle + daemon agents, but the channel compile only runs
 * at load time — a broken channel revision would poison every later load.
 */
export async function deployRevision(
  database: Database,
  snapshot: ChannelControlPlaneSnapshot,
  files: readonly HubBundleFile[],
  options: {
    createdByUserId?: string | null;
    expectedRevisionId?: string | null;
    authorize?: (candidate: ChannelConfigurationCandidate) => Promise<void>;
  } = {},
): Promise<void> {
  const candidate = await prepareChannelConfigurationCandidate(database, snapshot, files);
  await options.authorize?.(candidate);
  const canonical = [...files].sort((left, right) => left.path.localeCompare(right.path));
  await database.saveChannelConfiguration({
    organizationId: snapshot.organizationId,
    files: canonical,
    contentHash: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
    createdByUserId: options.createdByUserId ?? null,
    ...(options.expectedRevisionId === undefined
      ? {}
      : { expectedRevisionId: options.expectedRevisionId }),
  });
}

/** Compile a complete candidate with the same rules as deployment, without writing a revision. */
export async function validateChannelConfigurationCandidate(
  database: Database,
  snapshot: ChannelControlPlaneSnapshot,
  files: readonly HubBundleFile[],
): Promise<ChannelControlPlane> {
  return (await prepareChannelConfigurationCandidate(database, snapshot, files)).controlPlane;
}

export interface ChannelConfigurationCandidate {
  bundle: ReturnType<typeof compileHubBundle>;
  controlPlane: ChannelControlPlane;
}

/** Compiles the authored bundle and effective Channel policy used by activation authorization. */
export async function prepareChannelConfigurationCandidate(
  database: Database,
  snapshot: ChannelControlPlaneSnapshot,
  files: readonly HubBundleFile[],
): Promise<ChannelConfigurationCandidate> {
  try {
    const candidateResourceFiles = [...files];
    if (!candidateResourceFiles.some(({ path }) => path === ".paseo/hub.yml")) {
      candidateResourceFiles.push({
        path: ".paseo/hub.yml",
        content: "environments: {}\nagents: {}\n",
      });
    }
    const candidateBundle = compileHubBundle(candidateResourceFiles, {
      requireWorkflow: false,
    });
    const workflowNames = (await database.listOrganizationTriggers(snapshot.organizationId))
      .filter(({ enabled }) => enabled)
      .map(({ name }) => name);
    const controlPlane = compileChannelControlPlane({
      files,
      agentNames: channelAgentNames(candidateBundle),
      environmentNames: channelEnvironmentNames(candidateBundle),
      workflowNames,
    });
    await assertOpenAudienceTargetSafety(
      database,
      snapshot.organizationId,
      candidateBundle,
      controlPlane,
    );
    return { bundle: candidateBundle, controlPlane };
  } catch (error) {
    if (error instanceof ChannelCompilationError || error instanceof HubBundleError) {
      throw invalidConfiguration(error.message);
    }
    throw error;
  }
}

/** The supervisor's start step, degraded when the supervisor is unavailable. */
async function startAccount(
  supervisor: ChannelSupervisor | null,
  channel: string,
  account: string,
): Promise<{
  installed: boolean;
  transport: "started" | "deferred";
  detail?: string;
}> {
  if (supervisor === null) {
    return {
      installed: false,
      transport: "deferred",
      detail: "channel supervisor unavailable",
    };
  }
  try {
    const result = await supervisor.startAccount(channel, account);
    return {
      installed: result.installed,
      transport: result.transport,
      ...(result.detail === undefined ? {} : { detail: result.detail }),
    };
  } catch (error) {
    // P13: a per-account start fault degrades this request; it never crashes the Hub.
    return {
      installed: false,
      transport: "deferred",
      detail: error instanceof Error ? error.message : "the channel start failed",
    };
  }
}

/** One user's public view: name, identities, and the roles assigned to the user. */
function userView(
  username: string,
  user: { name: string | null; identities: readonly string[] },
  controlPlane: ChannelControlPlane,
): {
  username: string;
  name: string | null;
  identities: string[];
  roles: string[];
} {
  return {
    username,
    name: user.name,
    identities: [...user.identities],
    roles: userRoles(username, controlPlane),
  };
}

/** The roles covering the user: every org/account assignment whose identities
 * cover the user (the canonical cover check in `../policy.js`), restricted to
 * known role names — `[]` when none. */
function userRoles(username: string, controlPlane: ChannelControlPlane): string[] {
  const owners = controlPlane.identityOwners;
  const names = new Set<string>();
  const assignments = [
    ...controlPlane.assignments,
    ...controlPlane.accounts.flatMap((account) => account.assignments),
  ];
  for (const assignment of assignments) {
    if (!assignmentCoversPrincipal(assignment, username, owners)) continue;
    for (const role of assignment.roles) {
      if (controlPlane.roles[role] !== undefined) names.add(role);
    }
  }
  return [...names].sort();
}

/** The RFC 7807 problem body — the public API's `problem()` shape, byte-for-byte. */
function problem(
  request: Request,
  status: number,
  code: string,
  title: string,
  detail: string,
): Response {
  const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
  return Response.json(
    {
      type: `https://paseo.sh/problems/${code.replaceAll("_", "-")}`,
      title,
      status,
      detail,
      code,
      requestId,
    },
    {
      status,
      headers: {
        "content-type": "application/problem+json",
        "x-request-id": requestId,
        ...(status === 401 ? { "www-authenticate": "Bearer" } : {}),
      },
    },
  );
}
