// A Route's target and the named `hub.yml` resources it owns: the agent a
// Route starts, the resource pair a direct Agent target writes, and the
// cleanup when a Route moves off one. The Route's audience, behavior and
// limits stay in channel-configuration.ts.

import type { WorktreeTarget } from "./workspace-configuration";

type ConfigurationRecord = Record<string, unknown>;

export type ChannelRouteTarget =
  | { kind: "automation"; automationName: string }
  /** Keep the target the Route already has (`agent`/`environment`/`workflow`,
   * `agentControls`): what a Connection Admin saves, since the shared
   * resource file that defines an Agent is not theirs to change. */
  | { kind: "existing"; route: ConfigurationRecord }
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

/**
 * The agent a Route starts: its named `hub.yml` agent with the Route's
 * `agentControls` applied. Mirrors the Hub's `applyAgentControls`: controls
 * that name a provider are a whole configuration (the agent's provider
 * `options` survive only under the same provider); controls without one
 * override the named agent field by field.
 */
export function routeEffectiveAgent(
  agent: ConfigurationRecord | null,
  route: ConfigurationRecord | undefined,
): ConfigurationRecord | null {
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

/** What names a Route's target, kept verbatim when the target is not rebuilt. */
export function routeTargetKeys(route: ConfigurationRecord): ConfigurationRecord {
  const keys = ["agent", "environment", "workflow", "agents", "models", "agentControls"];
  return Object.fromEntries(
    keys.flatMap((key) => (Object.hasOwn(route, key) ? [[key, route[key]]] : [])),
  );
}

export function buildDirectAgentTarget(
  input: { accountId: string; preferredResourceName?: string; resource: ConfigurationRecord },
  target: Extract<ChannelRouteTarget, { kind: "agent" }>,
): { resourceName: string; resource: ConfigurationRecord } {
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

export function removeUnusedPreviousTargets(input: {
  resource: ConfigurationRecord;
  accounts: readonly ConfigurationRecord[];
  currentRoute: ConfigurationRecord;
  nextRoute: ConfigurationRecord;
}): ConfigurationRecord {
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
  accounts: readonly ConfigurationRecord[],
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

/**
 * The name a Route's own agent and environment share when no other Route uses
 * them: the edit updates that resource pair in place, instead of copying it.
 */
export function reusableResourceName(input: {
  target: ChannelRouteTarget;
  currentRoute: ConfigurationRecord;
  accounts: readonly ConfigurationRecord[];
}): string | undefined {
  if (input.target.kind !== "agent") return undefined;
  const name = stringValue(input.currentRoute["agent"]);
  if (name === null || name !== stringValue(input.currentRoute["environment"])) return undefined;
  const used = (key: "agent" | "environment") => countTargetReferences(input.accounts, key, name);
  return used("agent") === 1 && used("environment") === 1 ? name : undefined;
}

function uniqueResourceName(accountId: string, resource: ConfigurationRecord): string {
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

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is ConfigurationRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordField(record: ConfigurationRecord, key: string): ConfigurationRecord {
  const value = record[key];
  return isRecord(value) ? value : {};
}
