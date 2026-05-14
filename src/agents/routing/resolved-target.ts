import { formatConfiguredRuntimeLimit } from "../session/run-observation.ts";
import {
  getAgentEntry,
  type LoadedConfig,
  resolveMaxRuntimeMs,
} from "../../config/core/load-config.ts";
import { clisbotConfigSchema } from "../../config/core/schema.ts";
import { applyTemplate } from "../../infra/paths.ts";
import { buildTmuxSessionName, normalizeMainKey } from "../session/session-key.ts";

export type AgentSessionTarget = {
  agentId: string;
  sessionKey: string;
  mainSessionKey?: string;
  parentSessionKey?: string;
};

export type ResolvedAgentTarget = {
  agentId: string;
  sessionKey: string;
  mainSessionKey: string;
  parentSessionKey?: string;
  sessionName: string;
  workspacePath: string;
  runner: ReturnType<typeof resolveAgentTargetInternal>["runner"];
  stream: ReturnType<typeof resolveAgentTargetInternal>["stream"];
  session: ReturnType<typeof resolveAgentTargetInternal>["session"];
};

export function resolveAgentTarget(
  loadedConfig: LoadedConfig,
  target: AgentSessionTarget,
) {
  return resolveAgentTargetInternal(loadedConfig, target);
}

const defaultRunnerConfig = clisbotConfigSchema.parse({
  app: {},
  bots: {},
  agents: {},
}).agents.defaults.runner;

function resolveAgentTargetInternal(
  loadedConfig: LoadedConfig,
  target: AgentSessionTarget,
) {
  const defaults = loadedConfig.raw.agents.defaults;
  const override = getAgentEntry(loadedConfig, target.agentId);
  const workspaceTemplate = override?.workspace ?? defaults.workspace;
  const resolvedCli = override?.cli ?? defaults.cli;
  const runnerDefaults = defaults.runner.defaults;
  const configuredRunnerFamily = defaults.runner[resolvedCli];
  const runnerFamily = {
    ...defaultRunnerConfig[resolvedCli],
    ...configuredRunnerFamily,
    sessionId:
      configuredRunnerFamily.sessionId ??
      defaultRunnerConfig[resolvedCli].sessionId,
  };
  const runnerSessionId = runnerFamily.sessionId!;

  const workspacePath = applyTemplate(workspaceTemplate, {
    agentId: target.agentId,
  });
  const sessionName = buildTmuxSessionName({
    template:
      override?.runner?.defaults?.session?.name ??
      runnerDefaults.session.name,
    agentId: target.agentId,
    workspacePath,
    sessionKey: target.sessionKey,
    mainKey: normalizeMainKey(loadedConfig.raw.session.mainKey),
  });
  const resolvedStream = {
    ...runnerDefaults.stream,
    ...(override?.runner?.defaults?.stream ?? {}),
  };

  return {
    agentId: target.agentId,
    sessionKey: target.sessionKey,
    mainSessionKey: target.mainSessionKey ?? target.sessionKey,
    parentSessionKey: target.parentSessionKey,
    sessionName,
    workspacePath,
    runner: {
      command: override?.runner?.command ?? runnerFamily.command,
      args: override?.runner?.args ?? runnerFamily.args,
      trustWorkspace:
        override?.runner?.defaults?.trustWorkspace ??
        runnerDefaults.trustWorkspace,
      startupDelayMs:
        override?.runner?.startupDelayMs ??
        runnerFamily.startupDelayMs ??
        runnerDefaults.startupDelayMs,
      startupRetryCount:
        override?.runner?.startupRetryCount ??
        runnerFamily.startupRetryCount ??
        runnerDefaults.startupRetryCount,
      startupRetryDelayMs:
        override?.runner?.startupRetryDelayMs ??
        runnerFamily.startupRetryDelayMs ??
        runnerDefaults.startupRetryDelayMs,
      startupReadyPattern:
        override?.runner?.startupReadyPattern ??
        runnerFamily.startupReadyPattern,
      startupBlockers:
        override?.runner?.startupBlockers ??
        runnerFamily.startupBlockers,
      promptSubmitDelayMs:
        override?.runner?.promptSubmitDelayMs ??
        runnerFamily.promptSubmitDelayMs ??
        runnerDefaults.promptSubmitDelayMs,
      sessionId: {
        ...runnerSessionId,
        create: {
          ...runnerSessionId.create,
          ...(override?.runner?.sessionId?.create ?? {}),
        },
        capture: {
          ...runnerSessionId.capture,
          ...(override?.runner?.sessionId?.capture ?? {}),
        },
        resume: {
          ...runnerSessionId.resume,
          ...(override?.runner?.sessionId?.resume ?? {}),
        },
      },
    },
    stream: {
      ...resolvedStream,
      maxRuntimeLabel: formatConfiguredRuntimeLimit({
        maxRuntimeSec: resolvedStream.maxRuntimeSec,
        maxRuntimeMin: resolvedStream.maxRuntimeMin,
      }),
      maxRuntimeMs: resolveMaxRuntimeMs(resolvedStream),
    },
    session: {
      ...runnerDefaults.session,
      ...(override?.runner?.defaults?.session ?? {}),
    },
  };
}
