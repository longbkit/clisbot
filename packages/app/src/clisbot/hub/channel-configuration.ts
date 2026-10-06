import { parse, stringify } from "yaml";
import {
  withChannelRouteConversation,
  type ChannelRouteConversation,
} from "./channel-route-conversation";
import {
  withChannelRouteToolActivity,
  type ChannelRouteToolActivity,
} from "./channel-route-tool-activity";
import {
  buildDirectAgentTarget,
  removeUnusedPreviousTargets,
  reusableResourceName,
  routeTargetKeys,
  type ChannelRouteTarget,
} from "./channel-route-target";
import type { HubAudienceRule } from "./contracts";

export type ChannelConfigurationRecord = Record<string, unknown>;
export type ChannelRouteMatchKind = "dm" | "channel" | "thread" | "group" | "topic";

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

/** The organization floor a Rule meets when no layer sets a follow-up window. */
export const DEFAULT_CHANNEL_FOLLOW_UP_TTL_MINUTES = 5;

/**
 * What a Route does once a message is in. When a message gets in (a mention,
 * the follow-up window, a text filter) is each Rule's
 * (docs/audits/2026-10-05-routes-and-rules.md, `channel-route-audience.ts`).
 */
export interface ChannelRouteBehavior {
  replyAnchor: "default" | "thread";
  /** Where a reply to a root message lands in a DM (`reply.dmAnchor`). Absent
   * when the Route never set it: the DM itself, and the save writes nothing. */
  dmReplyAnchor?: "default" | "thread";
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

/**
 * What a Rule that sets no condition meets: the last `defaults:` layer that
 * sets each leaf (organization, then the account), else the Hub's floor —
 * a mention required, follow-ups `mention-only`, a 5-minute window.
 */
export function inheritedRuleConditions(
  layers: readonly (ChannelConfigurationRecord | undefined)[],
): { requireMention: boolean; followUpMode: "auto" | "mention-only"; ttlMinutes: number } {
  let requireMention = true;
  let followUpMode: "auto" | "mention-only" = "mention-only";
  let ttlMinutes = DEFAULT_CHANNEL_FOLLOW_UP_TTL_MINUTES;
  for (const layer of layers) {
    const interaction = recordField(layer ?? {}, "interaction");
    const followUp = recordField(interaction, "followUp");
    if (typeof interaction["requireMention"] === "boolean") {
      requireMention = interaction["requireMention"];
    }
    if (followUp["mode"] === "auto" || followUp["mode"] === "mention-only") {
      followUpMode = followUp["mode"];
    }
    const ttl = followUp["ttlMinutes"];
    if (typeof ttl === "number" && Number.isInteger(ttl) && ttl > 0) ttlMinutes = ttl;
  }
  return { requireMention, followUpMode, ttlMinutes };
}

/** Mirrors the Hub's `questions:` defaults leaf. */
export type ChannelRouteQuestions = "ask" | "recommended" | "agent-decides";

export const DEFAULT_MEMBER_ROUTE_BEHAVIOR: ChannelRouteBehavior = {
  replyAnchor: "thread",
  outboundPath: "hybrid",
  finalAnswers: true,
  progressMessage: true,
  typingIndicator: true,
  approvalMode: "require",
};

/**
 * Where a new open-audience Route starts: final answers only, a mention in
 * groups. Like any new Route (decided 2026-10-05) its Reply method is Hybrid,
 * so its Agent can attach files from the Project, and a permission request is
 * put to authorized members: a sender let in as Anyone can never approve one.
 * Deny and Text forward are one click away for a room that should get neither.
 * Every setting stays editable; the Hub warns about wide choices instead of
 * refusing them.
 */
export const DEFAULT_OPEN_AUDIENCE_ROUTE_BEHAVIOR: ChannelRouteBehavior = {
  ...DEFAULT_MEMBER_ROUTE_BEHAVIOR,
  progressMessage: false,
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
  /** The Route's Rules: at least one (`channel-route-audience.ts` builds them). */
  audience: readonly HubAudienceRule[];
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
    ...(input.limits === undefined ? {} : { limits: input.limits }),
    ...(input.behavior === undefined ? {} : { behavior: input.behavior }),
    ...(input.conversation === undefined ? {} : { conversation: input.conversation }),
    ...(input.toolActivity === undefined ? {} : { toolActivity: input.toolActivity }),
    target: input.target,
    resource: input.resource,
  });
  return {
    account: channelAccountRecord(input.connection, accountId, [candidate.route]),
    resource: candidate.resource,
  };
}

/**
 * The transport a new account starts on: each channel's first mode, as the
 * Hub's own `DEFAULT_TRANSPORT_MODE` (channels/http/operations.ts) picks it.
 * Each channel's schema accepts only its own modes; Discord has no `socket`.
 */
const DEFAULT_TRANSPORT_MODES: Readonly<Record<string, string>> = {
  slack: "socket",
  telegram: "polling",
  discord: "gateway",
  googlechat: "pubsub",
  feishu: "websocket",
  zalo: "polling",
  zalouser: "qr",
};

/** A new, enabled account on a Connection, with the Routes it starts with. */
export function channelAccountRecord(
  connection: { id: string; provider: string },
  accountId: string,
  routes: ChannelConfigurationRecord[],
): ChannelConfigurationRecord {
  return {
    channel: connection.provider,
    accountId,
    enabled: true,
    connectionId: connection.id,
    transport: { mode: DEFAULT_TRANSPORT_MODES[connection.provider] ?? "socket" },
    routes,
  };
}

export function buildChannelRouteCandidate(input: ChannelRouteCandidateInput): {
  route: ChannelConfigurationRecord;
  resource: ChannelConfigurationRecord;
} {
  const audience = input.audience.map(audienceRuleRecord);
  const openAudience = audience.some((rule) => rule.who.anyone === true);
  const limits = authoredLimits(input.limits);
  const behavior = withChannelRouteToolActivity(
    withChannelRouteConversation(
      input.behavior === undefined ? {} : routeBehaviorSettings(input.behavior),
      input.conversation,
    ),
    input.toolActivity,
  );
  const audiencePolicy = {
    audience,
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
      ...(input.target.workspaceOrganize === "off" ? { workspace: { organize: false } } : {}),
    };
  }
  return {
    route,
    resource,
  };
}

/** The wire shape of one rule: only the parts that are set, ids as strings. Its
 * conditions (`interaction`, `contains`) and any key the form does not show stay. */
function audienceRuleRecord(rule: HubAudienceRule): HubAudienceRule {
  const { who, where } = rule;
  const allDms = where.dm === true;
  return {
    ...rule,
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

function routeBehaviorSettings(behavior: ChannelRouteBehavior): ChannelConfigurationRecord {
  // A mention and the follow-up window are each Rule's now (`audienceRuleRecord`).
  return {
    reply: {
      anchor: behavior.replyAnchor,
      ...(behavior.dmReplyAnchor === undefined ? {} : { dmAnchor: behavior.dmReplyAnchor }),
    },
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
  const reusableName = reusableResourceName({
    target: input.target,
    currentRoute: input.currentRoute,
    accounts: input.accounts,
  });
  const candidate = buildChannelRouteCandidate({
    ...input,
    ...(reusableName === undefined ? {} : { preferredResourceName: reusableName }),
  });
  const route = preserveRouteSettings(input.currentRoute, candidate.route);
  // The form opens an agent Route with its `/promoteroutedefault` layer applied
  // (`routeEffectiveAgent`), so a rebuilt agent target already carries it.
  // Kept, the layer would override whatever the form just saved.
  if (input.target.kind === "agent") delete route["agentControls"];
  if (input.target.kind === "agent" && input.target.workspaceOrganize === "inherit")
    delete route["workspace"];
  const nextResource = removeUnusedPreviousTargets({
    resource: candidate.resource,
    accounts: input.accounts,
    currentRoute: input.currentRoute,
    nextRoute: route,
  });
  return { route, resource: nextResource };
}

/** What a Route no longer holds: each Rule's conditions (the Hub refuses them on a Route). */
const RULE_CONDITION_KEYS = ["requireMention", "followUp"] as const;

/**
 * COMPAT(route-rule-conditions): added in v0.10.3, remove after 2027-01-31.
 * A Hub from before 2026-10-05 keeps `contains`, `interaction.requireMention`
 * and `interaction.followUp` on the Route; a current Hub moves them onto its
 * Rules at start and refuses them on a Route. This form saves them only on
 * Rules, so editing such a Route would silently drop them and widen who gets
 * in: the form refuses to save it and asks for a Hub update.
 */
export function routeCarriesRuleConditions(route: ChannelConfigurationRecord): boolean {
  if (route["contains"] !== undefined) return true;
  const interaction = route["interaction"];
  return isRecord(interaction) && RULE_CONDITION_KEYS.some((key) => interaction[key] !== undefined);
}

/**
 * The Route keys the form writes whole and may leave out on purpose: a limit
 * set back to default, the target it switched away from. Every other key
 * starts from the stored Route, so a key the form does not show
 * (`agentControls`, `agents`, `workspace`, a key added to the schema later)
 * survives a save.
 */
const FORM_CLEARABLE_ROUTE_KEYS = ["limits", "agent", "environment", "workflow"];
/** Defaults a change of audience restarts from (`buildChannelRouteCandidate`). */
const AUDIENCE_DEFAULT_ROUTE_KEYS = ["interaction", "sync", "approval"] as const;

function preserveRouteSettings(
  current: ChannelConfigurationRecord,
  replacement: ChannelConfigurationRecord,
): ChannelConfigurationRecord {
  return withoutRouteConditions(mergeRouteSettings(current, replacement));
}

function withoutRouteConditions(route: ChannelConfigurationRecord): ChannelConfigurationRecord {
  const next = { ...route };
  delete next["contains"];
  if (!isRecord(next["interaction"])) return next;
  const interaction = { ...next["interaction"] };
  for (const key of RULE_CONDITION_KEYS) delete interaction[key];
  if (Object.keys(interaction).length === 0) delete next["interaction"];
  else next["interaction"] = interaction;
  return next;
}

function mergeRouteSettings(
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

function isRecord(value: unknown): value is ChannelConfigurationRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Routes that take only filtered messages stay ahead of Routes that take any. */
export function insertChannelRoute(
  routes: readonly ChannelConfigurationRecord[],
  route: ChannelConfigurationRecord,
): ChannelConfigurationRecord[] {
  if (!routeTakesOnlyFilteredText(route)) return [...routes, route];
  const firstUnfiltered = routes.findIndex((candidate) => !routeTakesOnlyFilteredText(candidate));
  return firstUnfiltered < 0
    ? [...routes, route]
    : [...routes.slice(0, firstUnfiltered), route, ...routes.slice(firstUnfiltered)];
}

/** Every Rule of the Route asks for text (`contains`): an unmatched message passes it by. */
export function routeTakesOnlyFilteredText(route: ChannelConfigurationRecord): boolean {
  const audience = Array.isArray(route["audience"]) ? route["audience"] : [];
  return (
    audience.length > 0 &&
    audience.every((rule) => isRecord(rule) && typeof rule["contains"] === "string")
  );
}

function recordField(record: ChannelConfigurationRecord, key: string): ChannelConfigurationRecord {
  const value = record[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as ChannelConfigurationRecord)
    : {};
}

export function channelAccountResourceId(channel: string, accountId: string): string {
  return `${encodeURIComponent(channel)}/${encodeURIComponent(accountId)}`;
}
