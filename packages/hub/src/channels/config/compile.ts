// The fork's channel pass over the Hub bundle (plan S8, implementation doc
// §4.3): compile `.paseo/channels/**` into the channel control-plane snapshot.
// Pure function — authored files + the upstream bundle's reference names in,
// a fully-effective snapshot out. Loaded only under CLISBOT_HUB_CHANNELS_ENABLED,
// so flag-off the module never enters the process (byte-equivalence).
//
// Inheritance (implementation doc §4.3.7): defaults fold org < account < route
// (first set layer wins per leaf; the org-layer floor is ORG_DEFAULTS when a
// leaf is unset everywhere); `approval` rules merge by prepending (route →
// account → org); `defaultRoles` and `assignments` inherit the same layers.
// Fail-closed: an unknown role name contributes nothing; a privilege pattern
// outside the closed catalog is a compile error.
//
// `compile-support.ts` owns the error type + the mechanical leaf compilers
// (yaml parse, roles, users, transport, assignment checks); this file is the
// orchestration — snapshot shape, account/route/fallback composition, the
// inheritance fold, and the approval merge.

import type { z } from "zod";
import {
  CHANNELS_DIRECTORY,
  CHANNEL_POLICY_PATH,
  type HubBundleFile,
} from "../../config/bundle-contract.js";
import {
  AccountFileSchema,
  OrgPolicySchema,
  type ApprovalRule,
  type ChannelDefaults,
  type Fallback,
  type RoleAssignment,
  type Route,
} from "./schema.js";

import type { CompiledRole } from "./privileges.js";
import {
  compileAudienceRule,
  deriveRouteWhere,
  isOpenAudience,
  type CompiledAudienceRule,
  type RouteWhere,
} from "./audience.js";
import { migrateFallbackAudience, migrateRouteAudience } from "./audience-migration.js";
import { foldDefaults, mergeApproval, requireStarFallback } from "./inheritance.js";
import {
  compileAccountLimits,
  compileRouteLimits,
  type CompiledAccountLimits,
  type ResolvedLimits,
} from "./limits.js";
import type { EffectiveDefaults } from "./inheritance.js";
import {
  compileRoles,
  compileAccountConfig,
  compileTransport,
  compileUsers,
  issue,
  parseYaml,
  validateAssignments,
  type CompiledUser,
} from "./compile-support.js";

// The error type and the compiled user record are owned by compile-support —
// re-exported so this module stays the single import for the control plane.
export {
  ChannelCompilationError,
  type ChannelCompilationIssue,
  type CompiledUser,
} from "./compile-support.js";

type AccountFile = z.infer<typeof AccountFileSchema>;
type OrgPolicy = z.infer<typeof OrgPolicySchema>;

// --- Compiled snapshot ---------------------------------------------------------

// The effective `defaults:` block is the fold's output, so it is declared with
// the fold and re-exported here: `config/compile.js` stays the one import for
// the compiled snapshot.
export type { EffectiveAccess, EffectiveDefaults } from "./inheritance.js";

/**
 * One route's folded `access:` block. Leaves stay optional: the ported
 * decision applies upstream's own per-leaf defaults (`dmPolicy: pairing`,
 * `groupPolicy: allowlist`) once the block exists at all, so authoring only
 * `allowFrom` behaves exactly as it does in OpenClaw.
 */
export type RouteTarget =
  | {
      kind: "agent";
      agent: string;
      environment: string;
      template: string | null;
    }
  | { kind: "workflow"; workflow: string };

export interface CompiledRoute {
  /** Who may talk, where — in authored order; any matching rule admits. */
  audienceRules: readonly CompiledAudienceRule[];
  /** The union of the rules' Where: the conversations this Route applies to. */
  where: RouteWhere;
  /** Case-sensitive literal substring; absent leaves text out of matching. */
  contains?: string;
  target: RouteTarget;
  defaultRoles: string[];
  assignments: readonly RoleAssignment[];
  defaults: EffectiveDefaults;
  /** Merged, most-specific-first (route → account → org). */
  approval: readonly ApprovalRule[];
  /** The Route scope's limits; absent = none apply. */
  limits?: ResolvedLimits;
  /** What `/agent <name>` and `/model <name>` may switch to. Omitted when the
   * route authored neither list — switching is then refused, not silent. */
  selectable?: RouteSelectable;
}

/** The alternatives a route offers its owners/admins (`agents:` / `models:`). */
export interface RouteSelectable {
  agents: readonly string[];
  models: readonly string[];
}

export interface CompiledFallback {
  deny: boolean;
  /** Catch-all route when `deny` is false; inherits the account layers. */
  target?: RouteTarget;
  /** Who the catch-all admits; its Where is every conversation. */
  audienceRules?: readonly CompiledAudienceRule[];
  defaultRoles?: string[];
  assignments?: readonly RoleAssignment[];
  defaults?: EffectiveDefaults;
  approval?: readonly ApprovalRule[];
  limits?: ResolvedLimits;
  selectable?: RouteSelectable;
}

export interface CompiledChannelAccount {
  channel: string;
  accountId: string;
  /** Per-account kill switch (account `enabled`). */
  enabled: boolean;
  /** Org per-channel switch, resolved (omitted = true). */
  channelEnabled: boolean;
  connectionId: string;
  transport: Record<string, unknown>;
  /** Vertical-owned account settings (AccountFileSchema `config`), verbatim. */
  config: Record<string, unknown>;
  defaultRoles: string[];
  assignments: readonly RoleAssignment[];
  defaults: EffectiveDefaults;
  /** Merged, most-specific-first (account → org). */
  approval: readonly ApprovalRule[];
  routes: readonly CompiledRoute[];
  fallback: CompiledFallback;
  /** The Bot and per-Conversation scopes; absent = none apply. */
  limits?: CompiledAccountLimits;
}

export interface ChannelControlPlane {
  /** Org kill switch (policy.yml `enabled`). */
  enabled: boolean;
  /** Org per-channel switches resolved to booleans (omitted channel = enabled). */
  channelEnabled: Readonly<Record<string, boolean>>;
  /** Roles with precomputed `extends` closures; unknown names never appear. */
  roles: Readonly<Record<string, CompiledRole & { closure: readonly string[] }>>;
  users: Readonly<Record<string, CompiledUser>>;
  /** Each identity → the user that owns it. */
  identityOwners: Readonly<Record<string, string>>;
  assignments: readonly RoleAssignment[];
  defaults: EffectiveDefaults;
  approval: readonly ApprovalRule[];
  accounts: readonly CompiledChannelAccount[];
}

export interface ChannelCompileInput {
  files: readonly HubBundleFile[];
  /** Named agents defined in `hub.yml`. */
  agentNames: readonly string[];
  /** Named environments defined in `hub.yml`. */
  environmentNames: readonly string[];
  /** Enabled organization Trigger names. */
  workflowNames: readonly string[];
}

// --- Orchestration -------------------------------------------------------------

export function compileChannelControlPlane(input: ChannelCompileInput): ChannelControlPlane {
  const policyFile = input.files.find((file) => file.path === CHANNEL_POLICY_PATH);
  const org =
    policyFile === undefined ? OrgPolicySchema.parse({}) : parseYaml(policyFile, OrgPolicySchema);
  requireStarFallback([CHANNEL_POLICY_PATH, "defaults", "approval"], org.defaults?.approval ?? []);
  const roles = compileRoles(org.roles);
  const { users, identityOwners } = compileUsers(org.users);
  validateAssignments(org.assignments ?? [], users, CHANNEL_POLICY_PATH);
  const channelEnabled: Record<string, boolean> = {};
  for (const [channel, entry] of Object.entries(org.channels ?? {})) {
    channelEnabled[channel] = entry.enabled;
  }
  const accounts = input.files
    .filter(
      (file) => file.path.startsWith(`${CHANNELS_DIRECTORY}/`) && file.path !== CHANNEL_POLICY_PATH,
    )
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => compileAccount(file, org, users, input));
  validateUniqueConnections(accounts);
  return {
    enabled: org.enabled,
    channelEnabled,
    roles,
    users,
    identityOwners,
    assignments: org.assignments ?? [],
    defaults: foldDefaults([org.defaults]),
    approval: org.defaults?.approval ?? [],
    accounts,
  };
}

function validateUniqueConnections(accounts: readonly CompiledChannelAccount[]): void {
  const owners = new Map<string, string>();
  for (const account of accounts) {
    const key = `${account.channel}:${account.connectionId}`;
    const owner = owners.get(key);
    if (owner !== undefined) {
      issue(
        [CHANNELS_DIRECTORY, account.channel, account.accountId, "connectionId"],
        `connection ${account.connectionId} is already used by account ${owner}`,
      );
    }
    owners.set(key, account.accountId);
  }
}

// --- Accounts -------------------------------------------------------------------

interface ParsedAccountIdentity {
  account: AccountFile;
  channel: string;
  accountId: string;
}

/** Parse the account file and check its declared channel/accountId match the
 * bundle path (`.paseo/channels/<channel>/<accountId>.yml`). */
function parseAccountIdentity(file: HubBundleFile): ParsedAccountIdentity {
  const account = parseYaml(file, AccountFileSchema);
  const channel = file.path.slice(`${CHANNELS_DIRECTORY}/`.length).split("/")[0] ?? "";
  const accountId = file.path
    .split("/")
    .pop()!
    .replace(/\.yml$/u, "");
  if (account.channel !== channel) {
    issue(
      [file.path, "channel"],
      `channel ${account.channel} must match the directory name ${channel}`,
    );
  }
  if (account.accountId !== accountId) {
    issue(
      [file.path, "accountId"],
      `accountId ${account.accountId} must match the file name ${accountId}`,
    );
  }
  return { account, channel, accountId };
}

interface AccountPolicyLayers {
  orgAssignments: readonly RoleAssignment[];
  accountAssignments: readonly RoleAssignment[];
  defaultRoles: string[];
  layers: readonly (ChannelDefaults | undefined)[];
  approval: readonly ApprovalRule[];
}

/** The account-level policy layers (org ⊕ account), with the account's own
 * assignment layer validated even when the account has no routes or catch-all
 * fallback (they would otherwise never reach `validateAssignments`). */
function accountPolicyLayers(
  file: HubBundleFile,
  org: OrgPolicy,
  account: AccountFile,
  users: Record<string, CompiledUser>,
): AccountPolicyLayers {
  validateAssignments(account.policy?.assignments ?? [], users, file.path);
  const orgAssignments = org.assignments ?? [];
  const accountAssignments = account.policy?.assignments ?? [];
  const defaultRoles = account.policy?.defaultRoles ?? org.defaults?.defaultRoles ?? [];
  const layers: readonly (ChannelDefaults | undefined)[] = [org.defaults, account.defaults];
  const approval = mergeApproval(org.defaults?.approval, account.defaults?.approval);
  requireStarFallback([file.path, "defaults", "approval"], approval);
  return { orgAssignments, accountAssignments, defaultRoles, layers, approval };
}

function compileAccount(
  file: HubBundleFile,
  org: OrgPolicy,
  users: Record<string, CompiledUser>,
  input: ChannelCompileInput,
): CompiledChannelAccount {
  const { account, channel, accountId } = parseAccountIdentity(file);
  const layers = accountPolicyLayers(file, org, account, users);
  const routes = (account.routes ?? []).map((route, index) =>
    compileRoute(route, {
      file,
      index,
      input,
      users,
      defaultRoles: route.policy?.defaultRoles ?? layers.defaultRoles,
      assignments: [
        ...layers.orgAssignments,
        ...layers.accountAssignments,
        ...(route.policy?.assignments ?? []),
      ],
      defaults: foldDefaults([...layers.layers, route]),
      approval: mergeApproval(org.defaults?.approval, account.defaults?.approval, route.approval),
    }),
  );
  return {
    channel,
    accountId,
    enabled: account.enabled,
    channelEnabled: org.channels?.[channel]?.enabled ?? true,
    connectionId: account.connectionId,
    transport: compileTransport(file.path, channel, account.transport),
    config: compileAccountConfig(file.path, channel, account.config),
    defaultRoles: layers.defaultRoles,
    assignments: layers.accountAssignments,
    defaults: foldDefaults(layers.layers),
    approval: layers.approval,
    routes,
    fallback: compileFallback(account.fallback, {
      file,
      input,
      users,
      orgAssignments: layers.orgAssignments,
      accountAssignments: layers.accountAssignments,
      accountLayers: layers.layers,
      accountApproval: layers.approval,
      accountDefaultRoles: layers.defaultRoles,
    }),
    ...compileAccountLimits(account.limits),
  };
}

// --- Routes ---------------------------------------------------------------------

function compileRoute(
  route: Route,
  context: {
    file: HubBundleFile;
    index: number;
    input: ChannelCompileInput;
    users: Record<string, CompiledUser>;
    defaultRoles: string[];
    assignments: readonly RoleAssignment[];
    defaults: EffectiveDefaults;
    approval: readonly ApprovalRule[];
  },
): CompiledRoute {
  validateAssignments(context.assignments, context.users, context.file.path);
  requireStarFallback([context.file.path, "routes", context.index], context.approval);
  const migrated = migrateRouteAudience(route);
  if (migrated.rules.length === 0) {
    issue(
      [context.file.path, "routes", context.index, "audience"],
      "a route needs at least one audience rule",
    );
  }
  const audienceRules = migrated.rules.map(compileAudienceRule);
  return {
    audienceRules,
    where: deriveRouteWhere(audienceRules),
    ...(migrated.contains === undefined ? {} : { contains: migrated.contains }),
    target: compileRouteTarget(route, context),
    defaultRoles: context.defaultRoles,
    assignments: context.assignments,
    defaults: context.defaults,
    approval: context.approval,
    ...compileRouteLimits(route.limits, isOpenAudience(audienceRules)),
    ...compileRouteSelectable(route, context),
  };
}

/**
 * The `/agent` and `/model` menus. An agent name must exist in `hub.yml` — a
 * typo here would otherwise fail at the next turn, in a channel, with the
 * session already reset. Model names stay open vocabulary: they are the
 * provider's, and the daemon owns that catalog.
 */
function compileRouteSelectable(
  route: Route,
  context: { file: HubBundleFile; index: number; input: ChannelCompileInput },
): { selectable?: RouteSelectable } {
  if (route.agents === undefined && route.models === undefined) return {};
  for (const [position, agent] of (route.agents ?? []).entries()) {
    if (!context.input.agentNames.includes(agent)) {
      issue(
        [context.file.path, "routes", context.index, "agents", position],
        `agent ${agent} is not defined in hub.yml`,
      );
    }
  }
  return { selectable: { agents: [...(route.agents ?? [])], models: [...(route.models ?? [])] } };
}

interface RouteTargetRef {
  agent?: string | undefined;
  environment?: string | undefined;
  workflow?: string | undefined;
  template?: string | undefined;
}

function compileRouteTarget(
  route: RouteTargetRef,
  context: { file: HubBundleFile; index: number; input: ChannelCompileInput },
): RouteTarget {
  const path = [context.file.path, "routes", context.index];
  const hasAgent = route.agent !== undefined || route.environment !== undefined;
  const hasWorkflow = route.workflow !== undefined;
  if (hasAgent === hasWorkflow) {
    issue(
      path,
      hasAgent
        ? "route targets both an agent session and a workflow; exactly one is allowed"
        : "route must target either agent + environment or workflow",
    );
  }
  if (hasAgent) {
    if (route.agent === undefined || route.environment === undefined) {
      issue(path, "an agent route needs both agent and environment");
    }
    if (!context.input.agentNames.includes(route.agent)) {
      issue([...path, "agent"], `agent ${route.agent} is not defined in hub.yml`);
    }
    if (!context.input.environmentNames.includes(route.environment)) {
      issue([...path, "environment"], `environment ${route.environment} is not defined in hub.yml`);
    }
    return {
      kind: "agent",
      agent: route.agent,
      environment: route.environment,
      // `template` is open vocabulary at compile: the built-in catalog plus
      // $CLISBOT_HOME/templates/<id> (implementation doc §4.3.7); the local
      // half is checked at mint time, not here.
      template: route.template ?? null,
    };
  }
  const workflow = route.workflow;
  if (workflow === undefined)
    issue(path, "route must target either agent + environment or workflow");
  if (!context.input.workflowNames.includes(workflow)) {
    issue([...path, "workflow"], `workflow ${workflow} has no matching organization Trigger`);
  }
  return { kind: "workflow", workflow };
}

function compileFallback(
  fallback: Fallback | undefined,
  context: {
    file: HubBundleFile;
    input: ChannelCompileInput;
    users: Record<string, CompiledUser>;
    orgAssignments: readonly RoleAssignment[];
    accountAssignments: readonly RoleAssignment[];
    accountLayers: readonly (ChannelDefaults | undefined)[];
    accountApproval: readonly ApprovalRule[];
    accountDefaultRoles: string[];
  },
): CompiledFallback {
  if (fallback === undefined || "deny" in fallback) {
    return { deny: true };
  }
  // The catch-all is a route: it inherits every layer above it (§4.3.7).
  const assignments = [
    ...context.orgAssignments,
    ...context.accountAssignments,
    ...(fallback.policy?.assignments ?? []),
  ];
  validateAssignments(assignments, context.users, context.file.path);
  const approval = mergeApproval(context.accountApproval, fallback.approval);
  requireStarFallback([context.file.path, "fallback"], approval);
  const audienceRules = migrateFallbackAudience(fallback).rules.map(compileAudienceRule);
  return {
    deny: false,
    target: compileRouteTarget(fallback, {
      file: context.file,
      index: -1,
      input: context.input,
    }),
    audienceRules,
    defaultRoles: fallback.policy?.defaultRoles ?? context.accountDefaultRoles,
    assignments,
    defaults: foldDefaults([...context.accountLayers, fallback]),
    approval,
    ...compileRouteLimits(fallback.limits, isOpenAudience(audienceRules)),
    ...compileRouteSelectable(fallback as Route, {
      file: context.file,
      index: -1,
      input: context.input,
    }),
  };
}
