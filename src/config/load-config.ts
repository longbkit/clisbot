import {
  getCredentialSkipPaths,
  materializeRuntimeChannelCredentials,
} from "./channel-credentials.ts";
import {
  expandHomePath,
  getDefaultConfigPath,
  getDefaultProcessedEventsPath,
  getDefaultSessionStorePath,
  getDefaultStateDir,
  getDefaultTmuxSocketPath,
  getDefaultWorkspaceTemplate,
} from "../shared/paths.ts";
import { readTextFile } from "../shared/fs.ts";
import { resolveConfigDurationMs } from "./duration.ts";
import { resolveConfigEnvVars } from "./env-substitution.ts";
import {
  type AgentEntry,
  type ClisbotConfig,
  clisbotConfigSchema,
} from "./schema.ts";
import { applyDynamicPathDefaults, assertNoLegacyPrivilegeCommands } from "./config-document.ts";
import { normalizeConfigDocumentShape } from "./config-migration.ts";
import { upgradeEditableConfigFileIfNeeded } from "./config-upgrade.ts";
import { normalizeConfigDirectMessageRoutes } from "./direct-message-routes.ts";
import { normalizeConfigGroupRoutes } from "./group-routes.ts";
import { normalizeRuntimeMonitorRestartBackoff } from "./runtime-monitor-backoff.ts";

export type RuntimeConfig = ClisbotConfig & {
  session: ClisbotConfig["app"]["session"] & {
    dmScope: ClisbotConfig["bots"]["defaults"]["dmScope"];
  };
  control: ClisbotConfig["app"]["control"];
  tmux: ClisbotConfig["agents"]["defaults"]["runner"]["defaults"]["tmux"];
};

export type ResolvedAgentRunnerConfig = {
  command: string;
  args: string[];
  trustWorkspace: boolean;
  startupDelayMs: number;
  startupRetryCount: number;
  startupRetryDelayMs: number;
  startupReadyPattern?: string;
  startupBlockers?: Array<{
    pattern: string;
    message: string;
  }>;
  promptSubmitDelayMs: number;
  sessionId: {
    create: {
      mode: "runner" | "explicit";
      args: string[];
    };
    capture: {
      mode: "off" | "status-command";
      statusCommand: string;
      pattern: string;
      timeoutMs: number;
      pollIntervalMs: number;
    };
    resume: {
      mode: "off" | "command";
      command?: string;
      args: string[];
    };
  };
};

export type ResolvedAgentConfig = {
  agentId: string;
  sessionName: string;
  workspacePath: string;
  runner: ResolvedAgentRunnerConfig;
  stream: {
    captureLines: number;
    updateIntervalMs: number;
    idleTimeoutMs: number;
    noOutputTimeoutMs: number;
    maxRuntimeSec?: number;
    maxRuntimeMin?: number;
    maxMessageChars: number;
    maxRuntimeLabel: string;
    maxRuntimeMs: number;
  };
  session: RuntimeConfig["agents"]["defaults"]["runner"]["defaults"]["session"];
};

export function resolveMaxRuntimeMs(stream: {
  maxRuntimeSec?: number;
  maxRuntimeMin?: number;
}) {
  return resolveConfigDurationMs({
    seconds: stream.maxRuntimeSec,
    minutes: stream.maxRuntimeMin,
    defaultMinutes: 30,
  });
}

export type LoadedConfig = {
  configPath: string;
  processedEventsPath: string;
  stateDir: string;
  raw: RuntimeConfig;
};

export type LoadConfigOptions = {
  materializeChannels?: Array<"slack" | "telegram">;
};

export async function loadConfig(
  configPath = getDefaultConfigPath(),
  options: LoadConfigOptions = {},
): Promise<LoadedConfig> {
  const expandedConfigPath = expandHomePath(configPath);
  await upgradeEditableConfigFileIfNeeded(expandedConfigPath);
  const text = await readTextFile(expandedConfigPath);
  const parsed = normalizeConfigDocumentShape(JSON.parse(text));
  assertNoLegacyPrivilegeCommands(parsed);
  const withDynamicDefaults = normalizeConfigGroupRoutes(
    normalizeConfigDirectMessageRoutes(
      clisbotConfigSchema.parse(applyDynamicPathDefaults(parsed)),
      {
        exactAdmissionMode: "explicit",
      },
    ),
  );
  const substituted = resolveConfigEnvVars(withDynamicDefaults, process.env, {
    skipPaths: getCredentialSkipPaths(withDynamicDefaults),
  }) as unknown;
  const validated = normalizeConfigGroupRoutes(
    normalizeConfigDirectMessageRoutes(
      clisbotConfigSchema.parse(normalizeConfigDocumentShape(substituted)),
      {
        exactAdmissionMode: "explicit",
      },
    ),
  );
  const materialized = materializeRuntimeChannelCredentials(validated, {
    env: process.env,
    materializeChannels: options.materializeChannels,
  });

  return materializeLoadedConfig(expandedConfigPath, materialized);
}

export async function loadConfigWithoutEnvResolution(
  configPath = getDefaultConfigPath(),
): Promise<LoadedConfig> {
  const expandedConfigPath = expandHomePath(configPath);
  await upgradeEditableConfigFileIfNeeded(expandedConfigPath);
  const text = await readTextFile(expandedConfigPath);
  const parsed = normalizeConfigDocumentShape(JSON.parse(text));
  assertNoLegacyPrivilegeCommands(parsed);
  const validated = normalizeConfigGroupRoutes(
    normalizeConfigDirectMessageRoutes(
      clisbotConfigSchema.parse(applyDynamicPathDefaults(parsed)),
      {
        exactAdmissionMode: "explicit",
      },
    ),
  );
  return materializeLoadedConfig(expandedConfigPath, validated);
}

function materializeLoadedConfig(
  expandedConfigPath: string,
  validated: ClisbotConfig,
): LoadedConfig {
  const runtimeRaw: RuntimeConfig = {
    ...validated,
    app: {
      ...validated.app,
      session: {
        ...validated.app.session,
        storePath: expandHomePath(
          validated.app.session.storePath || getDefaultSessionStorePath(),
        ),
      },
    },
    agents: {
      ...validated.agents,
      defaults: {
        ...validated.agents.defaults,
        workspace: expandHomePath(
          validated.agents.defaults.workspace || getDefaultWorkspaceTemplate(),
        ),
        runner: {
          ...validated.agents.defaults.runner,
          defaults: {
            ...validated.agents.defaults.runner.defaults,
            tmux: {
              ...validated.agents.defaults.runner.defaults.tmux,
              socketPath: expandHomePath(
                validated.agents.defaults.runner.defaults.tmux.socketPath ||
                  getDefaultTmuxSocketPath(),
              ),
            },
          },
        },
      },
      list: validated.agents.list.map((entry) => ({
        ...entry,
        workspace: entry.workspace ? expandHomePath(entry.workspace) : undefined,
      })),
    },
    session: {
      ...validated.app.session,
      dmScope: validated.bots.defaults.dmScope,
      storePath: expandHomePath(
        validated.app.session.storePath || getDefaultSessionStorePath(),
      ),
    },
    control: validated.app.control,
    tmux: {
      ...validated.agents.defaults.runner.defaults.tmux,
      socketPath: expandHomePath(
        validated.agents.defaults.runner.defaults.tmux.socketPath ||
          getDefaultTmuxSocketPath(),
      ),
    },
  };

  runtimeRaw.app.control.runtimeMonitor.restartBackoff = normalizeRuntimeMonitorRestartBackoff(
    runtimeRaw.app.control.runtimeMonitor.restartBackoff,
  );
  runtimeRaw.control.runtimeMonitor.restartBackoff = normalizeRuntimeMonitorRestartBackoff(
    runtimeRaw.control.runtimeMonitor.restartBackoff,
  );

  return {
    configPath: expandedConfigPath,
    processedEventsPath: getDefaultProcessedEventsPath(),
    stateDir: getDefaultStateDir(),
    raw: runtimeRaw,
  };
}

export function getAgentEntry(config: LoadedConfig, agentId: string): AgentEntry | undefined {
  return config.raw.agents.list.find((entry) => entry.id === agentId);
}

export function resolveSessionStorePath(config: LoadedConfig) {
  return config.raw.session.storePath || getDefaultSessionStorePath();
}
