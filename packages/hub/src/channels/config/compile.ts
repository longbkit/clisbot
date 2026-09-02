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
  ORG_DEFAULTS,
  OrgPolicySchema,
  type ApprovalRule,
  type ChannelDefaults,
  type Fallback,
  type SyncProgress,
  type SyncProgressGroup,
  type RoleAssignment,
  type Route,
} from "./schema.js";
import type { CompiledRole } from "./privileges.js";
import {
  compileRoles,
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

export interface EffectiveDefaults {
  requireMention: boolean;
  followUp: { mode: "auto" | "mention-only"; ttlMinutes: number };
  bindingKey: "thread" | "channel" | "dm";
  replyAnchor: "default" | "thread";
  /** The reply-path toggle (E4/E6), folded like every other default leaf;
   * `template` stays null at the org floor (= the default injection block). */
  outbound: { path: "relay" | "tool"; template: string | null };
  sync: {
    finalAnswers: boolean;
    /** The "the bot is working" group: the relayed progress line, the
     * provider's native typing status, and a temporary reaction on the
     * inbound marker. Folded per leaf; an authored bare boolean normalizes to
     * `progressMessage` only. */
    progress: {
      progressMessage: boolean;
      typingIndicator: boolean;
      /** Resolved: the reserved `"off"`, or the emoji name to react with. */
      messageReaction: string;
    };
    toolCalls: boolean;
    threadLink: "full" | "final-only" | "none";
    /** The subagent (Task tool) relay knobs; off at the org floor. */
    subagents: {
      finalAnswers: boolean;
      progress: boolean;
      toolCalls: boolean;
    };
  };
}

export type RouteTarget =
  | {
      kind: "agent";
      agent: string;
      environment: string;
      template: string | null;
    }
  | { kind: "workflow"; workflow: string };

export interface CompiledRoute {
  match: {
    kind: "dm" | "channel" | "thread" | "group" | "topic";
    ids: string[];
  };
  target: RouteTarget;
  defaultRoles: string[];
  assignments: readonly RoleAssignment[];
  defaults: EffectiveDefaults;
  /** Merged, most-specific-first (route → account → org). */
  approval: readonly ApprovalRule[];
}

export interface CompiledFallback {
  deny: boolean;
  /** Catch-all route when `deny` is false; inherits the account layers. */
  target?: RouteTarget;
  defaultRoles?: string[];
  assignments?: readonly RoleAssignment[];
  defaults?: EffectiveDefaults;
  approval?: readonly ApprovalRule[];
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
}

export interface ChannelControlPlane {
  /** Org kill switch (policy.yml `enabled`). */
  enabled: boolean;
  /** Org per-channel switches resolved to booleans (omitted channel = enabled). */
  channelEnabled: Readonly<Record<string, boolean>>;
  /** Roles with precomputed `extends` closures; unknown names never appear. */
  roles: Readonly<
    Record<string, CompiledRole & { closure: readonly string[] }>
  >;
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

export function compileChannelControlPlane(
  input: ChannelCompileInput,
): ChannelControlPlane {
  const policyFile = input.files.find(
    (file) => file.path === CHANNEL_POLICY_PATH,
  );
  const org =
    policyFile === undefined
      ? OrgPolicySchema.parse({})
      : parseYaml(policyFile, OrgPolicySchema);
  requireStarFallback(
    [CHANNEL_POLICY_PATH, "defaults", "approval"],
    org.defaults?.approval ?? [],
  );
  const roles = compileRoles(org.roles);
  const { users, identityOwners } = compileUsers(org.users);
  validateAssignments(org.assignments ?? [], users, CHANNEL_POLICY_PATH);
  const channelEnabled: Record<string, boolean> = {};
  for (const [channel, entry] of Object.entries(org.channels ?? {})) {
    channelEnabled[channel] = entry.enabled;
  }
  const accounts = input.files
    .filter(
      (file) =>
        file.path.startsWith(`${CHANNELS_DIRECTORY}/`) &&
        file.path !== CHANNEL_POLICY_PATH,
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

function validateUniqueConnections(
  accounts: readonly CompiledChannelAccount[],
): void {
  const owners = new Map<string, string>();
  for (const account of accounts) {
    const key = `${account.channel}:${account.connectionId}`;
    const owner = owners.get(key);
    if (owner !== undefined) {
      issue(
        [
          CHANNELS_DIRECTORY,
          account.channel,
          account.accountId,
          "connectionId",
        ],
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
  const channel =
    file.path.slice(`${CHANNELS_DIRECTORY}/`.length).split("/")[0] ?? "";
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
  const defaultRoles =
    account.policy?.defaultRoles ?? org.defaults?.defaultRoles ?? [];
  const layers: readonly (ChannelDefaults | undefined)[] = [
    org.defaults,
    account.defaults,
  ];
  const approval = mergeApproval(
    org.defaults?.approval,
    account.defaults?.approval,
  );
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
      channel,
      input,
      users,
      defaultRoles: route.policy?.defaultRoles ?? layers.defaultRoles,
      assignments: [
        ...layers.orgAssignments,
        ...layers.accountAssignments,
        ...(route.policy?.assignments ?? []),
      ],
      defaults: foldDefaults([...layers.layers, route]),
      approval: mergeApproval(
        org.defaults?.approval,
        account.defaults?.approval,
        route.approval,
      ),
    }),
  );
  return {
    channel,
    accountId,
    enabled: account.enabled,
    channelEnabled: org.channels?.[channel]?.enabled ?? true,
    connectionId: account.connectionId,
    transport: compileTransport(file.path, channel, account.transport),
    config: account.config ?? {},
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
  };
}

// --- Routes ---------------------------------------------------------------------

function compileRoute(
  route: Route,
  context: {
    file: HubBundleFile;
    index: number;
    channel: string;
    input: ChannelCompileInput;
    users: Record<string, CompiledUser>;
    defaultRoles: string[];
    assignments: readonly RoleAssignment[];
    defaults: EffectiveDefaults;
    approval: readonly ApprovalRule[];
  },
): CompiledRoute {
  validateAssignments(context.assignments, context.users, context.file.path);
  requireStarFallback(
    [context.file.path, "routes", context.index],
    context.approval,
  );
  validateRouteKind(context.channel, route.match.kind, [
    context.file.path,
    "routes",
    context.index,
    "match",
    "kind",
  ]);
  return {
    match: { kind: route.match.kind, ids: (route.match.ids ?? []).map(String) },
    target: compileRouteTarget(route, context),
    defaultRoles: context.defaultRoles,
    assignments: context.assignments,
    defaults: context.defaults,
    approval: context.approval,
  };
}

function validateRouteKind(
  channel: string,
  kind: Route["match"]["kind"],
  path: readonly (string | number)[],
): void {
  const supported =
    channel === "slack"
      ? ["dm", "channel", "thread", "group"]
      : channel === "telegram"
        ? ["dm", "group", "topic"]
        : [];
  if (!supported.includes(kind)) {
    issue(path, `${channel} never emits a ${kind} conversation`);
  }
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
      issue(
        [...path, "agent"],
        `agent ${route.agent} is not defined in hub.yml`,
      );
    }
    if (!context.input.environmentNames.includes(route.environment)) {
      issue(
        [...path, "environment"],
        `environment ${route.environment} is not defined in hub.yml`,
      );
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
    issue(
      [...path, "workflow"],
      `workflow ${workflow} has no matching organization Trigger`,
    );
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
  return {
    deny: false,
    target: compileRouteTarget(fallback, {
      file: context.file,
      index: -1,
      input: context.input,
    }),
    defaultRoles: fallback.policy?.defaultRoles ?? context.accountDefaultRoles,
    assignments,
    defaults: foldDefaults([...context.accountLayers, fallback]),
    approval,
  };
}

// --- Inheritance fold + approval merge ------------------------------------------

/**
 * Fold the inheritance layers (`org < account < route`, most-specific last):
 * the most specific layer that sets a leaf wins — an account or route override
 * beats the layer below it — and `ORG_DEFAULTS` is the floor when no layer
 * sets the leaf (§4.3.7: "org defaults < account defaults < route
 * overrides").
 */
function foldDefaults(
  layers: readonly (ChannelDefaults | undefined)[],
): EffectiveDefaults {
  const pick = <T>(
    leaf: (layer: ChannelDefaults | undefined) => T | undefined,
  ): T | undefined => {
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const value = leaf(layers[index]);
      if (value !== undefined) return value;
    }
    return undefined;
  };
  const floor = ORG_DEFAULTS;
  const outbound = {
    path: pick((layer) => layer?.outbound?.path) ?? floor.outbound.path,
    template:
      pick((layer) => layer?.outbound?.template) ?? floor.outbound.template,
  };
  return {
    requireMention:
      pick((layer) => layer?.interaction?.requireMention) ??
      floor.interaction.requireMention,
    followUp: {
      mode:
        pick((layer) => layer?.interaction?.followUp?.mode) ??
        floor.interaction.followUp.mode,
      ttlMinutes:
        pick((layer) => layer?.interaction?.followUp?.ttlMinutes) ??
        floor.interaction.followUp.ttlMinutes,
    },
    bindingKey: pick((layer) => layer?.binding?.key) ?? floor.binding.key,
    replyAnchor: pick((layer) => layer?.reply?.anchor) ?? floor.reply.anchor,
    outbound,
    sync: toolPathSyncFold(outbound.path, foldSyncDefaults(pick, floor.sync)),
  };
}

/**
 * Normalize one authored `sync.progress` layer to leaves. A bare boolean is
 * the pre-group spelling and speaks about `progressMessage` ONLY — it never
 * mentioned the other two surfaces, so they stay unset and keep inheriting
 * from the layer below (an already-authored `progress: true` revision gains a
 * typing indicator from the floor, not from this leaf).
 */
function progressLeaf(layer: SyncProgress | undefined): SyncProgressGroup {
  if (layer === undefined) return {};
  if (typeof layer === "boolean") return { progressMessage: layer };
  return layer;
}

/** Fold the `sync` leaves (root + `subagents`) through the layer chain. */
function foldSyncDefaults(
  pick: <T>(
    leaf: (layer: ChannelDefaults | undefined) => T | undefined,
  ) => T | undefined,
  floor: (typeof ORG_DEFAULTS)["sync"],
) {
  return {
    finalAnswers:
      pick((layer) => layer?.sync?.finalAnswers) ?? floor.finalAnswers,
    progress: {
      progressMessage:
        pick((layer) => progressLeaf(layer?.sync?.progress).progressMessage) ??
        floor.progress.progressMessage,
      typingIndicator:
        pick((layer) => progressLeaf(layer?.sync?.progress).typingIndicator) ??
        floor.progress.typingIndicator,
      messageReaction:
        pick((layer) => progressLeaf(layer?.sync?.progress).messageReaction) ??
        floor.progress.messageReaction,
    },
    toolCalls: pick((layer) => layer?.sync?.toolCalls) ?? floor.toolCalls,
    threadLink: pick((layer) => layer?.sync?.threadLink) ?? floor.threadLink,
    subagents: {
      finalAnswers:
        pick((layer) => layer?.sync?.subagents?.finalAnswers) ??
        floor.subagents.finalAnswers,
      progress:
        pick((layer) => layer?.sync?.subagents?.progress) ??
        floor.subagents.progress,
      toolCalls:
        pick((layer) => layer?.sync?.subagents?.toolCalls) ??
        floor.subagents.toolCalls,
    },
  };
}

/**
 * The tool-path sync fold (E4/E6): when the effective `outbound.path` is
 * `tool`, the agent's user-visible answer leaves through the hub-attached
 * `message` MCP tool, so the route's relay knobs fold to all-off — the relay
 * must stay silent for tool-path turns (exactly-one outcome: the tool post is
 * the only user-visible answer). That includes `sync.subagents`: subagent
 * (Task tool) output relayed into the thread would be a second user-visible
 * answer on a tool turn. `threadLink` keeps its folded value — it has no
 * effect while the relay is silent and still applies if the path flips back
 * to `relay` on the next revision.
 */
function toolPathSyncFold(
  path: "relay" | "tool",
  sync: EffectiveDefaults["sync"],
): EffectiveDefaults["sync"] {
  if (path !== "tool") return sync;
  return {
    ...sync,
    finalAnswers: false,
    // Only the relayed TEXT leaf goes quiet. The typing indicator and the
    // reaction are not posts — they are the liveness signal, and a tool-path
    // turn has less visible text than a relay turn, so folding them off would
    // remove the only sign of work. The group shape is what makes this
    // distinction expressible; the old single boolean could not.
    progress: { ...sync.progress, progressMessage: false },
    toolCalls: false,
    subagents: { finalAnswers: false, progress: false, toolCalls: false },
  };
}

/** Approval rules merge by prepending: the most specific layer matches first.
 * An exact-duplicate rule (same match + mode + initiatorOnly) in a specific
 * layer shadows the identical rule below it and is not added again — the doc
 * examples restate org rules in the account file "so the file reads as a
 * full, reviewable config" without changing the decision (§4.3.3). */
function mergeApproval(
  ...layers: readonly (readonly ApprovalRule[] | undefined)[]
): readonly ApprovalRule[] {
  const merged: ApprovalRule[] = [];
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    for (const rule of layers[index] ?? []) {
      const duplicate = merged.some(
        (candidate) =>
          candidate.match === rule.match &&
          candidate.mode === rule.mode &&
          candidate.initiatorOnly === rule.initiatorOnly,
      );
      if (!duplicate) merged.push(rule);
    }
  }
  return merged;
}

/** §4.3.6: when approval rules exist, a `match: "*"` fallback rule is required. */
function requireStarFallback(
  path: readonly (string | number)[],
  rules: readonly ApprovalRule[],
): void {
  if (rules.length > 0 && !rules.some((rule) => rule.match === "*")) {
    issue(path, 'approval rules require a match: "*" fallback rule');
  }
}
