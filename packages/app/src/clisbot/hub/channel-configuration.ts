import { parse, stringify } from "yaml";
import { splitConversationIds } from "./conversation-picker";
import type { WorktreeTarget } from "./workspace-configuration";

export type ChannelConfigurationRecord = Record<string, unknown>;
export type ChannelRouteMatchKind = "dm" | "channel" | "thread" | "group" | "topic";

export type ChannelRouteTarget =
  | { kind: "automation"; automationName: string }
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

export interface ChannelRouteLimits {
  maxInputCharacters: number;
  messagesPerMinutePerSender: number;
  messagesPerMinute: number;
  maxConcurrentRuns: number;
  maxRuntimeSeconds: number;
}

export interface ChannelRouteBehavior {
  requireMention: boolean;
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
  replyAnchor: "thread",
  outboundPath: "relay",
  finalAnswers: true,
  progressMessage: true,
  typingIndicator: true,
  toolCalls: false,
  approvalMode: "require",
};

export const DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS: ChannelRouteLimits = {
  maxInputCharacters: 8_000,
  messagesPerMinutePerSender: 10,
  messagesPerMinute: 60,
  maxConcurrentRuns: 2,
  maxRuntimeSeconds: 15 * 60,
};

/** Public access is always bounded to an explicit provider Conversation. */
export function hasRequiredChannelConversationIds(
  audience: "members" | "conversationParticipants",
  conversationIds: string,
): boolean {
  return audience === "members" || splitConversationIds(conversationIds).length > 0;
}

interface ChannelRouteCandidateInput {
  accountId: string;
  matchKind: ChannelRouteMatchKind;
  conversationIds: string;
  contains?: string;
  audience?: "members" | "conversationParticipants";
  limits?: ChannelRouteLimits;
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
    matchKind: input.matchKind,
    conversationIds: input.conversationIds,
    ...(input.contains === undefined ? {} : { contains: input.contains }),
    ...(input.audience === undefined ? {} : { audience: input.audience }),
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
      fallback: { deny: true },
    },
    resource: candidate.resource,
  };
}

export function buildChannelRouteCandidate(input: ChannelRouteCandidateInput): {
  route: ChannelConfigurationRecord;
  resource: ChannelConfigurationRecord;
} {
  const ids = splitConversationIds(input.conversationIds);
  const contains = input.contains?.trim();
  const match = {
    kind: input.matchKind,
    ...(ids.length > 0 ? { ids } : {}),
    ...(contains ? { contains } : {}),
  };
  const openAudience = input.audience === "conversationParticipants";
  const audiencePolicy = openAudience
    ? {
        audience: { kind: "conversationParticipants" },
        interaction: { requireMention: input.matchKind !== "dm" },
        outbound: { path: "relay" },
        sync: {
          finalAnswers: true,
          progress: {
            progressMessage: false,
            typingIndicator: false,
            messageReaction: "off",
          },
          toolCalls: false,
          threadLink: "none",
          subagents: { finalAnswers: false, progress: false, toolCalls: false },
        },
        approval: [{ match: "*", mode: "auto-deny" }],
        limits: {
          ...DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS,
          ...input.limits,
        },
      }
    : {
        audience: { kind: "members" },
        ...(input.behavior === undefined ? {} : routeBehaviorSettings(input.behavior)),
      };
  let resource = input.resource;
  let route: ChannelConfigurationRecord;
  if (input.target.kind === "automation") {
    route = { match, ...audiencePolicy, workflow: input.target.automationName };
  } else {
    const direct = buildDirectAgentTarget(input, input.target, openAudience);
    resource = direct.resource;
    route = {
      match,
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

function buildDirectAgentTarget(
  input: ChannelRouteCandidateInput,
  target: Extract<ChannelRouteTarget, { kind: "agent" }>,
  openAudience: boolean,
): { resourceName: string; resource: ChannelConfigurationRecord } {
  const featureValues = { ...target.featureValues };
  if (openAudience) delete featureValues["fast_mode"];
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

function routeBehaviorSettings(behavior: ChannelRouteBehavior): ChannelConfigurationRecord {
  return {
    interaction: { requireMention: behavior.requireMention },
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
  const preservedKeys = ["template", "policy", "binding", "reply", "outbound", "limits"];
  const preserved = Object.fromEntries(
    preservedKeys.flatMap((key) => (Object.hasOwn(current, key) ? [[key, current[key]]] : [])),
  );
  const currentAudience = recordField(current, "audience")["kind"];
  const replacementAudience = recordField(replacement, "audience")["kind"];
  if (currentAudience === "members" && replacementAudience === "members") {
    for (const key of ["interaction", "sync", "approval"] as const) {
      if (Object.hasOwn(current, key)) preserved[key] = current[key];
    }
  }
  const merged = { ...preserved, ...replacement };
  if (currentAudience !== "members" || replacementAudience !== "members") return merged;
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
    const fallback = account["fallback"];
    for (const candidate of [...routes, fallback]) {
      if (
        typeof candidate === "object" &&
        candidate !== null &&
        !Array.isArray(candidate) &&
        (candidate as ChannelConfigurationRecord)[key] === name
      ) {
        count += 1;
      }
    }
  }
  return count;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is ChannelConfigurationRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Specific text Routes must stay ahead of catch-all Routes. */
export function insertChannelRoute(
  routes: readonly ChannelConfigurationRecord[],
  route: ChannelConfigurationRecord,
): ChannelConfigurationRecord[] {
  if (!routeContainsText(route)) return [...routes, route];
  const catchAll = routes.findIndex((candidate) => !routeContainsText(candidate));
  return catchAll < 0
    ? [...routes, route]
    : [...routes.slice(0, catchAll), route, ...routes.slice(catchAll)];
}

function routeContainsText(route: ChannelConfigurationRecord): boolean {
  const match = recordField(route, "match");
  return typeof match["contains"] === "string" && match["contains"].length > 0;
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
