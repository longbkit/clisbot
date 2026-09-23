import { parse, stringify } from "yaml";
import {
  withChannelRouteConversation,
  type ChannelRouteConversation,
} from "./channel-route-conversation";
import {
  withChannelRouteToolActivity,
  type ChannelRouteToolActivity,
} from "./channel-route-tool-activity";
import type { HubAudienceRule } from "./contracts";
import type { WorktreeTarget } from "./workspace-configuration";

export type ChannelConfigurationRecord = Record<string, unknown>;
export type ChannelRouteMatchKind = "dm" | "channel" | "thread" | "group" | "topic";

export type ChannelRouteTarget =
  | { kind: "automation"; automationName: string }
  /** Keep the target the Route already has (`agent`/`environment`/`workflow`,
   * `agentControls`): what a Connection Admin saves, since the shared
   * resource file that defines an Agent is not theirs to change. */
  | { kind: "existing"; route: ChannelConfigurationRecord }
  | {
      kind: "agent";
      daemonId: string;
      projectId: string;
      cwd: string;
      worktree?: WorktreeTarget;
      provider: string;
      model?: string;
      mode?: string;
      thinkingOptionId?: string;
      featureValues?: Record<string, unknown>;
      options?: Record<string, unknown>;
    };

/** Mirrors `CHANNEL_LIMIT_NAMES` in packages/hub/src/channels/config/schema.ts. */
export const CHANNEL_LIMIT_NAMES = [
  "maxInputCharacters",
  "messagesPerMinutePerSender",
  "messagesPerMinute",
  "messagesSentPerMinute",
  "maxConcurrentRuns",
  "maxRuntimeSeconds",
] as const;
export type ChannelLimitName = (typeof CHANNEL_LIMIT_NAMES)[number];
/** A positive whole number, or `off` to turn a default off. Unset = the default. */
export type ChannelLimits = Partial<Record<ChannelLimitName, number | "off">>;
/** The account's `limits`: the whole bot's, plus what each Conversation gets. */
export type ChannelAccountLimits = ChannelLimits & { perConversation?: ChannelLimits };

/**
 * How a bound group thread continues after a mention. `mention-only` needs a
 * mention on every message; `auto` lets unmentioned messages continue for
 * `followUpTtlMinutes` after the last turn. Ignored for DMs and when
 * `requireMention` is off.
 */
export type ChannelRouteFollowUpMode = "auto" | "mention-only";

export const DEFAULT_CHANNEL_FOLLOW_UP_TTL_MINUTES = 5;

export interface ChannelRouteBehavior {
  requireMention: boolean;
  followUpMode: ChannelRouteFollowUpMode;
  followUpTtlMinutes: number;
  /**
   * The Route's own `interaction.followUp` as loaded. Absent means the Route
   * inherits the policy from its account or organization.
   */
  followUpAuthored?: ChannelConfigurationRecord;
  /** The user changed the follow-up switch or minutes in the form. */
  followUpEdited?: boolean;
  /** `followUpTtlMinutes` came from the Route or the user, not the default. */
  followUpTtlAuthored?: boolean;
  replyAnchor: "default" | "thread";
  /** Mirrors the Hub's `outbound.path`. `hybrid` relays text and attaches the
   * Channel tool for files and actions (the default for a member Route). */
  outboundPath: ChannelOutboundPath;
  /** A stored Route that authors no `outbound.path`: it inherits one from its
   * account or organization, and a save leaves the key out until the user
   * picks a Reply method. */
  outboundPathInherited?: boolean;
  finalAnswers: boolean;
  progressMessage: boolean;
  typingIndicator: boolean;
  approvalMode?: "auto-deny" | "require" | "auto-allow";
  /** How a question from the Agent is answered (the Route's `questions:` leaf);
   * absent leaves the Route's approval rules to decide. */
  questions?: ChannelRouteQuestions;
}

export type ChannelOutboundPath = "hybrid" | "relay" | "tool";

const OUTBOUND_PATHS: readonly ChannelOutboundPath[] = ["hybrid", "relay", "tool"];

/** A stored `outbound.path`, or undefined when the value authors none. */
export function channelOutboundPath(value: unknown): ChannelOutboundPath | undefined {
  return OUTBOUND_PATHS.find((path) => path === value);
}

/** The path a Route that authors none runs: the last layer that sets one
 * (organization `defaults:`, then the account's), else the Hub's `relay` floor. */
export function inheritedChannelOutboundPath(
  layers: readonly (ChannelConfigurationRecord | undefined)[],
): ChannelOutboundPath {
  let path: ChannelOutboundPath = "relay";
  for (const layer of layers) {
    path = channelOutboundPath(recordField(layer ?? {}, "outbound")["path"]) ?? path;
  }
  return path;
}

/** Mirrors the Hub's `questions:` defaults leaf. */
export type ChannelRouteQuestions = "ask" | "recommended" | "agent-decides";

export const DEFAULT_MEMBER_ROUTE_BEHAVIOR: ChannelRouteBehavior = {
  requireMention: true,
  followUpMode: "mention-only",
  followUpTtlMinutes: DEFAULT_CHANNEL_FOLLOW_UP_TTL_MINUTES,
  replyAnchor: "thread",
  outboundPath: "hybrid",
  finalAnswers: true,
  progressMessage: true,
  typingIndicator: true,
  approvalMode: "require",
};

/**
 * Where a new open-audience Route starts: final answers only, a mention in
 * groups, tool requests denied. Every setting stays editable; the Hub warns
 * about wide choices instead of refusing them.
 */
export const DEFAULT_OPEN_AUDIENCE_ROUTE_BEHAVIOR: ChannelRouteBehavior = {
  ...DEFAULT_MEMBER_ROUTE_BEHAVIOR,
  outboundPath: "relay",
  progressMessage: false,
  approvalMode: "auto-deny",
};

/** Mirrors `OPEN_AUDIENCE_ROUTE_LIMITS` in the Hub: defaults, not ceilings. */
export const DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS: Partial<Record<ChannelLimitName, number>> = {
  maxInputCharacters: 8_000,
  messagesPerMinutePerSender: 10,
  messagesPerMinute: 60,
  maxConcurrentRuns: 8,
  maxRuntimeSeconds: 15 * 60,
};

interface ChannelRouteCandidateInput {
  accountId: string;
  /** Who may talk, where: at least one rule (`channel-route-audience.ts` builds them). */
  audience: readonly HubAudienceRule[];
  contains?: string;
  limits?: ChannelLimits;
  behavior?: ChannelRouteBehavior;
  /** The conversation leaves the Route authors (`channel-route-conversation.ts`). */
  conversation?: ChannelRouteConversation;
  /** The Route's own `sync.toolCalls`; absent keeps inheriting it. */
  toolActivity?: ChannelRouteToolActivity;
  target: ChannelRouteTarget;
  resource: ChannelConfigurationRecord;
  preferredResourceName?: string;
}

interface ChannelAccountCandidateInput extends ChannelRouteCandidateInput {
  connection: { id: string; provider: string };
}

export interface ChannelConfigurationCandidate {
  policy: ChannelConfigurationRecord;
  accounts: ChannelConfigurationRecord[];
  resource: ChannelConfigurationRecord;
}

export function formatChannelConfigurationYaml(candidate: ChannelConfigurationCandidate): string {
  return stringify(candidate, { lineWidth: 0 });
}

export function parseChannelConfigurationYaml(source: string): ChannelConfigurationCandidate {
  const value: unknown = parse(source);
  if (!isRecord(value)) {
    throw new Error("Advanced YAML must be a mapping.");
  }
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "resource" && key !== "policy" && key !== "accounts")) {
    throw new Error("Advanced YAML accepts only resource, policy, and accounts.");
  }
  if (!isRecord(value["policy"])) {
    throw new Error("policy must be a mapping.");
  }
  if (!Array.isArray(value["accounts"])) {
    throw new Error("accounts must be a list.");
  }
  const accounts = value["accounts"].map((account, index) => {
    if (!isRecord(account)) {
      throw new Error("accounts[" + String(index) + "] must be a mapping.");
    }
    return account;
  });
  if (!isRecord(value["resource"])) {
    throw new Error("resource must be a mapping.");
  }
  return { policy: value["policy"], accounts, resource: value["resource"] };
}

export function buildChannelAccountCandidate(input: ChannelAccountCandidateInput): {
  account: ChannelConfigurationRecord;
  resource: ChannelConfigurationRecord;
} {
  const accountId = input.accountId.trim();
  const candidate = buildChannelRouteCandidate({
    accountId,
    audience: input.audience,
    ...(input.contains === undefined ? {} : { contains: input.contains }),
    ...(input.limits === undefined ? {} : { limits: input.limits }),
    ...(input.behavior === undefined ? {} : { behavior: input.behavior }),
    ...(input.conversation === undefined ? {} : { conversation: input.conversation }),
    ...(input.toolActivity === undefined ? {} : { toolActivity: input.toolActivity }),
    target: input.target,
    resource: input.resource,
  });
  return {
    account: {
      channel: input.connection.provider,
      accountId,
      enabled: true,
      connectionId: input.connection.id,
      transport:
        input.connection.provider === "telegram" ? { mode: "polling" } : { mode: "socket" },
      routes: [candidate.route],
    },
    resource: candidate.resource,
  };
}

export function buildChannelRouteCandidate(input: ChannelRouteCandidateInput): {
  route: ChannelConfigurationRecord;
  resource: ChannelConfigurationRecord;
} {
  const contains = input.contains?.trim();
  const audience = input.audience.map(audienceRuleRecord);
  const openAudience = audience.some((rule) => rule.who.anyone === true);
  const limits = authoredLimits(input.limits);
  const behavior = withChannelRouteToolActivity(
    withChannelRouteConversation(
      input.behavior === undefined
        ? {}
        : routeBehaviorSettings(input.behavior, isDirectMessageOnly(input.audience)),
      input.conversation,
    ),
    input.toolActivity,
  );
  const audiencePolicy = {
    audience,
    ...(contains ? { contains } : {}),
    ...(openAudience ? withQuietSync(behavior) : behavior),
    ...(limits === undefined ? {} : { limits }),
  };
  let resource = input.resource;
  let route: ChannelConfigurationRecord;
  if (input.target.kind === "automation") {
    route = { ...audiencePolicy, workflow: input.target.automationName };
  } else if (input.target.kind === "existing") {
    route = { ...audiencePolicy, ...routeTargetKeys(input.target.route) };
  } else {
    const direct = buildDirectAgentTarget(input, input.target);
    resource = direct.resource;
    route = {
      ...audiencePolicy,
      agent: direct.resourceName,
      environment: direct.resourceName,
    };
  }
  return {
    route,
    resource,
  };
}

/** The wire shape of one rule: only the parts that are set, ids as strings. */
function audienceRuleRecord(rule: HubAudienceRule): HubAudienceRule {
  const { who, where } = rule;
  const allDms = where.dm === true;
  return {
    who: {
      ...listKey("roles", who.roles),
      ...listKey("teams", who.teams),
      ...listKey("members", who.members),
      ...(who.anyone === true ? { anyone: true } : {}),
      ...listKey("identities", who.identities),
    },
    where: {
      ...(allDms ? { dm: true } : {}),
      // Every DM is already open, so the lists that narrow DMs carry nothing.
      ...(allDms ? {} : listKey("dmMembers", where.dmMembers)),
      ...(allDms ? {} : listKey("dmTeams", where.dmTeams)),
      ...(allDms ? {} : listKey("dmIdentities", where.dmIdentities)),
      ...(where.groups !== undefined && where.groups !== "off" ? { groups: where.groups } : {}),
      ...listKey("conversations", where.conversations?.map(String)),
    },
  };
}

/** `{ key: list }` for a list that names something; an empty list is left out of the file. */
function listKey<Key extends string, Item>(
  key: Key,
  list: readonly Item[] | undefined,
): { [K in Key]?: Item[] } {
  if (list === undefined || list.length === 0) return {};
  return { [key]: [...list] } as { [K in Key]?: Item[] };
}

/** True when every rule covers DMs and nothing else: mention and thread settings do not apply. */
export function isDirectMessageOnly(rules: readonly HubAudienceRule[]): boolean {
  const coversDms = (where: HubAudienceRule["where"]) =>
    where.dm === true ||
    [where.dmMembers, where.dmTeams, where.dmIdentities].some((list) => (list ?? []).length > 0);
  return (
    rules.length > 0 &&
    rules.every(
      ({ where }) =>
        coversDms(where) &&
        (where.groups === undefined || where.groups === "off") &&
        (where.conversations === undefined || where.conversations.length === 0),
    )
  );
}

/**
 * The agent a Route starts: its named `hub.yml` agent with the Route's
 * `agentControls` applied. Mirrors the Hub's `applyAgentControls`: controls
 * that name a provider are a whole configuration (the agent's provider
 * `options` survive only under the same provider); controls without one
 * override the named agent field by field.
 */
export function routeEffectiveAgent(
  agent: ChannelConfigurationRecord | null,
  route: ChannelConfigurationRecord | undefined,
): ChannelConfigurationRecord | null {
  const controls = route?.["agentControls"];
  if (!isRecord(controls)) return agent;
  const named = agent ?? {};
  const provider = stringValue(controls["provider"]);
  if (provider === null) return { ...named, ...controls, provider: named["provider"] };
  return {
    ...controls,
    provider,
    ...(provider === named["provider"] && named["options"] !== undefined
      ? { options: named["options"] }
      : {}),
  };
}

/**
 * Anyone gets in somewhere un-narrowed. DMs limited to named senders admit those
 * senders alone, so they do not make a rule open (the Hub's `isOpenAudience`).
 */
function isOpenRule(rule: ChannelConfigurationRecord): boolean {
  if (recordField(rule, "who")["anyone"] !== true) return false;
  const where = recordField(rule, "where");
  const groups = where["groups"];
  const conversations = where["conversations"];
  return (
    where["dm"] === true ||
    (typeof groups === "string" && groups !== "off") ||
    (Array.isArray(conversations) && conversations.length > 0)
  );
}

/** Whether a stored Route admits everyone somewhere. */
export function isOpenAudienceRoute(route: ChannelConfigurationRecord): boolean {
  const audience = route["audience"];
  return Array.isArray(audience) && audience.some((rule) => isRecord(rule) && isOpenRule(rule));
}

/** What names a Route's target, kept verbatim when the target is not rebuilt. */
function routeTargetKeys(route: ChannelConfigurationRecord): ChannelConfigurationRecord {
  const keys = ["agent", "environment", "workflow", "agents", "models", "agentControls"];
  return Object.fromEntries(
    keys.flatMap((key) => (Object.hasOwn(route, key) ? [[key, route[key]]] : [])),
  );
}

function buildDirectAgentTarget(
  input: ChannelRouteCandidateInput,
  target: Extract<ChannelRouteTarget, { kind: "agent" }>,
): { resourceName: string; resource: ChannelConfigurationRecord } {
  const featureValues = { ...target.featureValues };
  const resourceName =
    input.preferredResourceName?.trim() ||
    uniqueResourceName(input.accountId.trim(), input.resource);
  return {
    resourceName,
    resource: {
      ...input.resource,
      agents: {
        ...recordField(input.resource, "agents"),
        [resourceName]: {
          provider: target.provider.trim(),
          ...(target.model?.trim() ? { model: target.model.trim() } : {}),
          ...(target.mode?.trim() ? { mode: target.mode.trim() } : {}),
          ...(target.thinkingOptionId?.trim()
            ? { thinkingOptionId: target.thinkingOptionId.trim() }
            : {}),
          ...(Object.keys(featureValues).length > 0 ? { featureValues } : {}),
          ...(target.options !== undefined && Object.keys(target.options).length > 0
            ? { options: target.options }
            : {}),
        },
      },
      environments: {
        ...recordField(input.resource, "environments"),
        [resourceName]: {
          kind: "daemon",
          daemon: target.daemonId,
          projectId: target.projectId,
          cwd: target.cwd.trim(),
          ...(target.worktree === undefined ? {} : { worktree: target.worktree }),
        },
      },
    },
  };
}

function routeBehaviorSettings(
  behavior: ChannelRouteBehavior,
  dmOnly: boolean,
): ChannelConfigurationRecord {
  const followUp = routeFollowUpSetting(behavior, dmOnly);
  return {
    interaction: {
      requireMention: behavior.requireMention,
      ...(followUp === undefined ? {} : { followUp }),
    },
    reply: { anchor: behavior.replyAnchor },
    ...(behavior.outboundPathInherited === true
      ? {}
      : { outbound: { path: behavior.outboundPath } }),
    sync: {
      finalAnswers: behavior.finalAnswers,
      progress: {
        progressMessage: behavior.progressMessage,
        typingIndicator: behavior.typingIndicator,
      },
    },
    ...(behavior.approvalMode === undefined
      ? {}
      : { approval: [{ match: "*", mode: behavior.approvalMode }] }),
    ...(behavior.questions === undefined ? {} : { questions: behavior.questions }),
  };
}

/**
 * The `interaction.followUp` to write. Untouched controls keep what the Route
 * authored, or leave the key out so the account or organization policy still
 * applies. DMs ignore follow-up, so they never gain one.
 */
function routeFollowUpSetting(
  behavior: ChannelRouteBehavior,
  dmOnly: boolean,
): ChannelConfigurationRecord | undefined {
  if (!behavior.followUpEdited || dmOnly) return behavior.followUpAuthored;
  if (behavior.followUpMode === "auto") {
    return { mode: "auto", ttlMinutes: behavior.followUpTtlMinutes };
  }
  return behavior.followUpTtlAuthored
    ? { mode: "mention-only", ttlMinutes: behavior.followUpTtlMinutes }
    : { mode: "mention-only" };
}

/** Reads an authored `interaction.followUp`; anything unrecognized falls back to the defaults. */
export function channelRouteFollowUp(
  interaction: ChannelConfigurationRecord,
): Pick<
  ChannelRouteBehavior,
  "followUpMode" | "followUpTtlMinutes" | "followUpAuthored" | "followUpTtlAuthored"
> {
  const authored = interaction["followUp"];
  const followUp = recordField(interaction, "followUp");
  const ttlMinutes = followUp["ttlMinutes"];
  const ttlValid = typeof ttlMinutes === "number" && Number.isInteger(ttlMinutes) && ttlMinutes > 0;
  return {
    followUpMode: followUp["mode"] === "auto" ? "auto" : DEFAULT_MEMBER_ROUTE_BEHAVIOR.followUpMode,
    followUpTtlMinutes: ttlValid ? ttlMinutes : DEFAULT_CHANNEL_FOLLOW_UP_TTL_MINUTES,
    followUpTtlAuthored: ttlValid,
    ...(isRecord(authored) ? { followUpAuthored: authored } : {}),
  };
}

/** A follow-up window typed as text: a positive whole number of minutes, or null. */
export function parseChannelFollowUpTtlMinutes(draft: string): number | null {
  const trimmed = draft.trim();
  if (!/^\d+$/u.test(trimmed)) return null;
  const minutes = Number(trimmed);
  return Number.isSafeInteger(minutes) && minutes > 0 ? minutes : null;
}

/**
 * Replaces one authored Route without changing the Channel configuration
 * contract. A direct Agent's named resource is updated in place only when the
 * Route is its sole consumer; otherwise the edit uses copy-on-write.
 */
export function replaceChannelRouteCandidate(
  input: ChannelRouteCandidateInput & {
    currentRoute: ChannelConfigurationRecord;
    accounts: readonly ChannelConfigurationRecord[];
  },
): {
  route: ChannelConfigurationRecord;
  resource: ChannelConfigurationRecord;
} {
  const currentAgent = stringValue(input.currentRoute["agent"]);
  const currentEnvironment = stringValue(input.currentRoute["environment"]);
  const reusableName =
    input.target.kind === "agent" &&
    currentAgent !== null &&
    currentAgent === currentEnvironment &&
    countTargetReferences(input.accounts, "agent", currentAgent) === 1 &&
    countTargetReferences(input.accounts, "environment", currentAgent) === 1
      ? currentAgent
      : undefined;
  const candidate = buildChannelRouteCandidate({
    ...input,
    ...(reusableName === undefined ? {} : { preferredResourceName: reusableName }),
  });
  const route = preserveRouteSettings(input.currentRoute, candidate.route);
  // The form opens an agent Route with its `/promoteroutedefault` layer applied
  // (`routeEffectiveAgent`), so a rebuilt agent target already carries it.
  // Kept, the layer would override whatever the form just saved.
  if (input.target.kind === "agent") delete route["agentControls"];
  const nextResource = removeUnusedPreviousTargets({
    resource: candidate.resource,
    accounts: input.accounts,
    currentRoute: input.currentRoute,
    nextRoute: route,
  });
  return { route, resource: nextResource };
}

/**
 * The Route keys the form writes whole and may leave out on purpose: a cleared
 * text filter, a limit set back to default, the target it switched away from.
 * Every other key starts from the stored Route, so a key the form does not show
 * (`agentControls`, `agents`, `workspace`, a key added to the schema later)
 * survives a save.
 */
const FORM_CLEARABLE_ROUTE_KEYS = ["contains", "limits", "agent", "environment", "workflow"];
/** Defaults a change of audience restarts from (`buildChannelRouteCandidate`). */
const AUDIENCE_DEFAULT_ROUTE_KEYS = ["interaction", "sync", "approval"] as const;

function preserveRouteSettings(
  current: ChannelConfigurationRecord,
  replacement: ChannelConfigurationRecord,
): ChannelConfigurationRecord {
  const merged: ChannelConfigurationRecord = { ...current, ...replacement };
  for (const key of FORM_CLEARABLE_ROUTE_KEYS) {
    if (!Object.hasOwn(replacement, key)) delete merged[key];
  }
  // Changing who can use the Route starts from that audience's defaults;
  // keeping it keeps the settings the form does not show.
  if (isOpenAudienceRoute(current) !== isOpenAudienceRoute(replacement)) {
    for (const key of AUDIENCE_DEFAULT_ROUTE_KEYS) {
      if (!Object.hasOwn(replacement, key)) delete merged[key];
    }
    return merged;
  }
  for (const key of ["interaction", "reply", "outbound", "context", "batching"] as const) {
    if (isRecord(current[key]) && isRecord(replacement[key])) {
      merged[key] = { ...current[key], ...replacement[key] };
    }
  }
  if (isRecord(current["sync"]) && isRecord(replacement["sync"])) {
    merged["sync"] = mergedSync(current["sync"], replacement["sync"]);
  }
  return merged;
}

/** `sync` leaves the form writes as a record of their own keep the stored keys under them. */
const NESTED_SYNC_KEYS = ["progress", "toolCalls"] as const;

function mergedSync(
  current: ChannelConfigurationRecord,
  replacement: ChannelConfigurationRecord,
): ChannelConfigurationRecord {
  const merged: ChannelConfigurationRecord = { ...current, ...replacement };
  for (const key of NESTED_SYNC_KEYS) {
    if (isRecord(current[key]) && isRecord(replacement[key])) {
      merged[key] = { ...current[key], ...replacement[key] };
    }
  }
  return merged;
}

/**
 * An open-audience Route posts nothing the form does not show: no session
 * link, no sub-agent output, no reaction. These would otherwise come from the
 * account or organization defaults.
 */
function withQuietSync(settings: ChannelConfigurationRecord): ChannelConfigurationRecord {
  const sync = recordField(settings, "sync");
  return {
    ...settings,
    sync: {
      ...sync,
      progress: { ...recordField(sync, "progress"), messageReaction: "off" },
      threadLink: "none",
      subagents: { finalAnswers: false, progress: false, toolCalls: false },
    },
  };
}

/** Only the leaves the user set; an empty set writes no `limits` at all. */
export function authoredLimits(limits: ChannelLimits | undefined): ChannelLimits | undefined {
  const authored: ChannelLimits = {};
  for (const name of CHANNEL_LIMIT_NAMES) {
    const value = limits?.[name];
    if (value !== undefined) authored[name] = value;
  }
  return Object.keys(authored).length === 0 ? undefined : authored;
}

function removeUnusedPreviousTargets(input: {
  resource: ChannelConfigurationRecord;
  accounts: readonly ChannelConfigurationRecord[];
  currentRoute: ChannelConfigurationRecord;
  nextRoute: ChannelConfigurationRecord;
}): ChannelConfigurationRecord {
  const resource = { ...input.resource };
  for (const key of ["agent", "environment"] as const) {
    const previousName = stringValue(input.currentRoute[key]);
    const nextName = stringValue(input.nextRoute[key]);
    if (
      previousName === null ||
      previousName === nextName ||
      countTargetReferences(input.accounts, key, previousName) !== 1
    ) {
      continue;
    }
    const collectionKey = key === "agent" ? "agents" : "environments";
    const collection = { ...recordField(resource, collectionKey) };
    delete collection[previousName];
    resource[collectionKey] = collection;
  }
  return resource;
}

function countTargetReferences(
  accounts: readonly ChannelConfigurationRecord[],
  key: "agent" | "environment",
  name: string,
): number {
  let count = 0;
  for (const account of accounts) {
    const routes = Array.isArray(account["routes"]) ? (account["routes"] as unknown[]) : [];
    count += routes.filter((route) => isRecord(route) && route[key] === name).length;
  }
  return count;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is ChannelConfigurationRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Routes with a `contains` filter stay ahead of Routes without one. */
export function insertChannelRoute(
  routes: readonly ChannelConfigurationRecord[],
  route: ChannelConfigurationRecord,
): ChannelConfigurationRecord[] {
  if (routeContainsText(route) === null) return [...routes, route];
  const firstUnfiltered = routes.findIndex((candidate) => routeContainsText(candidate) === null);
  return firstUnfiltered < 0
    ? [...routes, route]
    : [...routes.slice(0, firstUnfiltered), route, ...routes.slice(firstUnfiltered)];
}

/** The Route-level `contains` text filter, when set. */
export function routeContainsText(route: ChannelConfigurationRecord): string | null {
  const contains = route["contains"];
  return typeof contains === "string" && contains.length > 0 ? contains : null;
}

function recordField(record: ChannelConfigurationRecord, key: string): ChannelConfigurationRecord {
  const value = record[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as ChannelConfigurationRecord)
    : {};
}

function uniqueResourceName(accountId: string, resource: ChannelConfigurationRecord): string {
  const normalized = accountId
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  const base = `channel-${normalized || "account"}`;
  const agents = recordField(resource, "agents");
  const environments = recordField(resource, "environments");
  if (!(base in agents) && !(base in environments)) return base;
  let ordinal = 2;
  while (`${base}-${String(ordinal)}` in agents || `${base}-${String(ordinal)}` in environments) {
    ordinal += 1;
  }
  return `${base}-${String(ordinal)}`;
}

export function channelAccountResourceId(channel: string, accountId: string): string {
  return `${encodeURIComponent(channel)}/${encodeURIComponent(accountId)}`;
}
