import { parse, stringify } from "yaml";
import type { HubAudienceRule } from "./contracts";
import type { WorktreeTarget } from "./workspace-configuration";

export type ChannelConfigurationRecord = Record<string, unknown>;
export type ChannelRouteMatchKind = "dm" | "channel" | "thread" | "group" | "topic";

export type ChannelRouteTarget =
  | { kind: "automation"; automationName: string }
  /** Keep the target the Route already has (`agent`/`environment`/`workflow`,
   * `agentControls`): what a Channel Route Admin saves, since the shared
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
  outboundPath: "relay" | "tool";
  finalAnswers: boolean;
  progressMessage: boolean;
  typingIndicator: boolean;
  toolCalls: boolean;
  approvalMode?: "auto-deny" | "require" | "auto-allow";
}

export const DEFAULT_MEMBER_ROUTE_BEHAVIOR: ChannelRouteBehavior = {
  requireMention: true,
  followUpMode: "mention-only",
  followUpTtlMinutes: DEFAULT_CHANNEL_FOLLOW_UP_TTL_MINUTES,
  replyAnchor: "thread",
  outboundPath: "tool",
  finalAnswers: true,
  progressMessage: true,
  typingIndicator: true,
  toolCalls: false,
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
  maxConcurrentRuns: 2,
  maxRuntimeSeconds: 15 * 60,
};

interface ChannelRouteCandidateInput {
  accountId: string;
  /** Who may talk, where: at least one rule (`channel-route-audience.ts` builds them). */
  audience: readonly HubAudienceRule[];
  contains?: string;
  limits?: ChannelLimits;
  behavior?: ChannelRouteBehavior;
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
  const behavior =
    input.behavior === undefined
      ? {}
      : routeBehaviorSettings(input.behavior, isDirectMessageOnly(input.audience));
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
  return {
    who: {
      ...(who.roles !== undefined && who.roles.length > 0 ? { roles: [...who.roles] } : {}),
      ...(who.teams !== undefined && who.teams.length > 0 ? { teams: [...who.teams] } : {}),
      ...(who.members !== undefined && who.members.length > 0 ? { members: [...who.members] } : {}),
      ...(who.anyone === true ? { anyone: true } : {}),
      ...(who.identities !== undefined && who.identities.length > 0
        ? { identities: [...who.identities] }
        : {}),
    },
    where: {
      ...(where.dm === true ? { dm: true } : {}),
      ...(where.groups !== undefined && where.groups !== "off" ? { groups: where.groups } : {}),
      ...(where.conversations !== undefined && where.conversations.length > 0
        ? { conversations: where.conversations.map(String) }
        : {}),
    },
  };
}

/** True when every rule covers DMs and nothing else: mention and thread settings do not apply. */
export function isDirectMessageOnly(rules: readonly HubAudienceRule[]): boolean {
  return (
    rules.length > 0 &&
    rules.every(
      ({ where }) =>
        where.dm === true &&
        (where.groups === undefined || where.groups === "off") &&
        (where.conversations === undefined || where.conversations.length === 0),
    )
  );
}

/** Whether a stored Route admits everyone somewhere. */
export function isOpenAudienceRoute(route: ChannelConfigurationRecord): boolean {
  const audience = route["audience"];
  return (
    Array.isArray(audience) &&
    audience.some((rule) => isRecord(rule) && recordField(rule, "who")["anyone"] === true)
  );
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
    outbound: { path: behavior.outboundPath },
    sync: {
      finalAnswers: behavior.finalAnswers,
      progress: {
        progressMessage: behavior.progressMessage,
        typingIndicator: behavior.typingIndicator,
      },
      toolCalls: behavior.toolCalls,
    },
    ...(behavior.approvalMode === undefined
      ? {}
      : { approval: [{ match: "*", mode: behavior.approvalMode }] }),
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
  const nextResource = removeUnusedPreviousTargets({
    resource: candidate.resource,
    accounts: input.accounts,
    currentRoute: input.currentRoute,
    nextRoute: route,
  });
  return { route, resource: nextResource };
}

function preserveRouteSettings(
  current: ChannelConfigurationRecord,
  replacement: ChannelConfigurationRecord,
): ChannelConfigurationRecord {
  // `limits` is not preserved: the form shows every leaf, so what it sends is complete.
  const preservedKeys = ["template", "policy", "binding", "reply", "outbound"];
  const preserved = Object.fromEntries(
    preservedKeys.flatMap((key) => (Object.hasOwn(current, key) ? [[key, current[key]]] : [])),
  );
  // Changing who can use the Route starts from that audience's defaults;
  // keeping it keeps the settings the form does not show.
  const sameAudience = isOpenAudienceRoute(current) === isOpenAudienceRoute(replacement);
  if (sameAudience) {
    for (const key of ["interaction", "sync", "approval"] as const) {
      if (Object.hasOwn(current, key)) preserved[key] = current[key];
    }
  }
  const merged = { ...preserved, ...replacement };
  if (!sameAudience) return merged;
  for (const key of ["interaction", "reply", "outbound"] as const) {
    if (isRecord(current[key]) && isRecord(replacement[key])) {
      merged[key] = { ...current[key], ...replacement[key] };
    }
  }
  if (isRecord(current["sync"]) && isRecord(replacement["sync"])) {
    const currentProgress = current["sync"]["progress"];
    const replacementProgress = replacement["sync"]["progress"];
    merged["sync"] = {
      ...current["sync"],
      ...replacement["sync"],
      ...(isRecord(currentProgress) && isRecord(replacementProgress)
        ? { progress: { ...currentProgress, ...replacementProgress } }
        : {}),
    };
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
