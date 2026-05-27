import {
  buildRunnerFromToolTemplate,
  DEFAULT_AGENT_TOOL_TEMPLATES,
  inferAgentCliToolId,
  type AgentCliToolId,
} from "../runtime/agent-tool-presets.ts";
import {
  getDefaultRuntimeMonitorRestartBackoff,
  normalizeRuntimeMonitorRestartBackoff,
  type RuntimeMonitorRestartBackoff,
} from "../runtime/runtime-monitor-backoff.ts";

type MutableRecord = Record<string, unknown>;

const MIN_PERSISTED_AGENT_STARTUP_DELAY_MS = 30_000;

const defaultOwnedRunnerFields: Partial<Record<AgentCliToolId, string[]>> = {
  codex: ["startupDelayMs", "startupReadyPattern"],
  gemini: [
    "startupDelayMs",
    "startupRetryCount",
    "startupRetryDelayMs",
    "startupReadyPattern",
    "startupBlockers",
    "promptSubmitDelayMs",
  ],
};
const defaultOwnedRunnerDefaultFields: Record<string, unknown> = {
  startupDelayMs: 60000,
};

function isRecord(value: unknown): value is MutableRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneConfig(config: unknown) {
  return structuredClone(config) as MutableRecord;
}

function areJsonEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function nestedRecord(root: MutableRecord, path: string[]) {
  let current: unknown = root;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return isRecord(current) ? current : undefined;
}

function deleteIfEmpty(owner: MutableRecord, key: string) {
  const value = owner[key];
  if (isRecord(value) && Object.keys(value).length === 0) {
    delete owner[key];
  }
}

function defaultRunner(toolId: AgentCliToolId) {
  return buildRunnerFromToolTemplate(
    toolId,
    DEFAULT_AGENT_TOOL_TEMPLATES[toolId],
    undefined,
  );
}

export function isStaleStartupDelay(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value < MIN_PERSISTED_AGENT_STARTUP_DELAY_MS;
}

export function deleteStaleStartupDelay(owner: Record<string, unknown> | undefined) {
  if (!owner || !isStaleStartupDelay(owner.startupDelayMs)) {
    return false;
  }
  delete owner.startupDelayMs;
  return true;
}

function pruneDefaultOwnedFields(params: {
  target: MutableRecord;
  toolId: AgentCliToolId;
  force: boolean;
}) {
  const defaults = defaultRunner(params.toolId) as unknown as MutableRecord;
  for (const field of defaultOwnedRunnerFields[params.toolId] ?? []) {
    if (field === "startupDelayMs" && deleteStaleStartupDelay(params.target)) {
      continue;
    }
    if (
      params.force ||
      (Object.hasOwn(params.target, field) &&
        areJsonEqual(params.target[field], defaults[field]))
    ) {
      delete params.target[field];
    }
  }
}

function pruneAgentRunnerOverride(runner: MutableRecord, cli: AgentCliToolId | undefined) {
  const toolId = inferAgentCliToolId(
    typeof runner.command === "string" ? runner.command : cli,
  ) ?? cli;
  if (!toolId) {
    return;
  }
  const defaults = defaultRunner(toolId) as unknown as MutableRecord;
  deleteStaleStartupDelay(runner);
  for (const field of [
    "command",
    "args",
    "trustWorkspace",
    "startupDelayMs",
    "startupRetryCount",
    "startupRetryDelayMs",
    "startupReadyPattern",
    "startupBlockers",
    "promptSubmitDelayMs",
    "newSessionCommand",
    "sessionId",
  ]) {
    if (Object.hasOwn(runner, field) && areJsonEqual(runner[field], defaults[field])) {
      delete runner[field];
    }
  }
}

function pruneAgentRunnerDefaultOverride(runner: MutableRecord) {
  const defaults = runner.defaults;
  if (!isRecord(defaults)) {
    return;
  }
  deleteStaleStartupDelay(defaults);
  deleteIfEmpty(runner, "defaults");
}

function pruneRunnerDefaults(config: MutableRecord, forceRunnerStartupDefaults: boolean) {
  const runner = nestedRecord(config, ["agents", "defaults", "runner"]);
  if (!runner) {
    return;
  }
  const runnerDefaults = runner.defaults;
  if (isRecord(runnerDefaults)) {
    for (const [field, defaultValue] of Object.entries(defaultOwnedRunnerDefaultFields)) {
      if (field === "startupDelayMs" && deleteStaleStartupDelay(runnerDefaults)) {
        continue;
      }
      if (
        forceRunnerStartupDefaults ||
        (Object.hasOwn(runnerDefaults, field) &&
          areJsonEqual(runnerDefaults[field], defaultValue))
      ) {
        delete runnerDefaults[field];
      }
    }
  }
  for (const toolId of ["codex", "gemini"] as const) {
    const target = runner[toolId];
    if (isRecord(target)) {
      pruneDefaultOwnedFields({
        target,
        toolId,
        force: forceRunnerStartupDefaults,
      });
    }
  }
}

function pruneAgentOverrides(config: MutableRecord) {
  const agents = nestedRecord(config, ["agents"]);
  if (!Array.isArray(agents?.list)) {
    return;
  }
  for (const agent of agents.list) {
    if (!isRecord(agent) || !isRecord(agent.runner)) {
      continue;
    }
    pruneAgentRunnerDefaultOverride(agent.runner);
    const cli = typeof agent.cli === "string"
      ? inferAgentCliToolId(agent.cli) ?? undefined
      : undefined;
    pruneAgentRunnerOverride(agent.runner, cli);
    deleteIfEmpty(agent, "runner");
  }
}

function pruneRuntimeMonitorBackoff(config: MutableRecord) {
  const runtimeMonitor = nestedRecord(config, ["app", "control", "runtimeMonitor"]);
  if (!runtimeMonitor) {
    return;
  }
  const restartBackoff = runtimeMonitor?.restartBackoff;
  if (
    isRecord(restartBackoff) &&
    areJsonEqual(
      normalizeRuntimeMonitorRestartBackoff(
        restartBackoff as unknown as RuntimeMonitorRestartBackoff,
      ),
      getDefaultRuntimeMonitorRestartBackoff(),
    )
  ) {
    delete runtimeMonitor.restartBackoff;
  }
}

export function pruneConfigForPersistence(
  config: unknown,
  options: { forceRunnerStartupDefaults?: boolean } = {},
) {
  const nextConfig = cloneConfig(config);
  pruneRuntimeMonitorBackoff(nextConfig);
  pruneRunnerDefaults(nextConfig, options.forceRunnerStartupDefaults === true);
  pruneAgentOverrides(nextConfig);
  return nextConfig;
}
