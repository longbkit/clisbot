import {
  getCredentialSkipPaths,
  materializeRuntimeChannelCredentials,
} from "./channel-credentials.ts";
import {
  collapseHomePath,
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
import { normalizeConfigDirectMessageRoutes } from "./direct-message-routes.ts";

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
  const text = await readTextFile(expandedConfigPath);
  const parsed = JSON.parse(text);
  assertNoLegacyPrivilegeCommands(parsed);
  const withDynamicDefaults = normalizeConfigDirectMessageRoutes(
    clisbotConfigSchema.parse(applyDynamicPathDefaults(parsed)),
  );
  const substituted = resolveConfigEnvVars(withDynamicDefaults, process.env, {
    skipPaths: getCredentialSkipPaths(withDynamicDefaults),
  }) as unknown;
  const validated = normalizeConfigDirectMessageRoutes(
    clisbotConfigSchema.parse(substituted),
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
  const text = await readTextFile(expandedConfigPath);
  const parsed = JSON.parse(text);
  assertNoLegacyPrivilegeCommands(parsed);
  const validated = normalizeConfigDirectMessageRoutes(
    clisbotConfigSchema.parse(applyDynamicPathDefaults(parsed)),
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

  return {
    configPath: expandedConfigPath,
    processedEventsPath: getDefaultProcessedEventsPath(),
    stateDir: getDefaultStateDir(),
    raw: runtimeRaw,
  };
}

export function applyDynamicPathDefaults(
  parsed: unknown,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!isRecord(parsed)) {
    return parsed;
  }

  const app = isRecord(parsed.app) ? parsed.app : {};
  const appSession = isRecord(app.session) ? app.session : {};
  const agents = isRecord(parsed.agents) ? parsed.agents : {};
  const agentDefaults = isRecord(agents.defaults) ? agents.defaults : {};
  const runner = isRecord(agentDefaults.runner) ? agentDefaults.runner : {};
  const runnerDefaults = isRecord(runner.defaults) ? runner.defaults : {};
  const tmux = isRecord(runnerDefaults.tmux) ? runnerDefaults.tmux : {};

  return {
    ...parsed,
    app: {
      ...app,
      session: {
        ...appSession,
        storePath: typeof appSession.storePath === "string" && appSession.storePath.trim()
          ? appSession.storePath
          : collapseHomePath(getDefaultSessionStorePath(env)),
      },
    },
    agents: {
      ...agents,
      defaults: {
        ...agentDefaults,
        workspace: typeof agentDefaults.workspace === "string" && agentDefaults.workspace.trim()
          ? agentDefaults.workspace
          : collapseHomePath(getDefaultWorkspaceTemplate(env)),
        runner: {
          ...runner,
          defaults: {
            ...runnerDefaults,
            tmux: {
              ...tmux,
              socketPath: typeof tmux.socketPath === "string" && tmux.socketPath.trim()
                ? tmux.socketPath
                : collapseHomePath(getDefaultTmuxSocketPath(env)),
            },
          },
        },
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertNoLegacyPrivilegeCommands(value: unknown, path = "root"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoLegacyPrivilegeCommands(entry, `${path}[${index}]`));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(value, "privilegeCommands")) {
    throw new Error(
      `Unsupported config key at ${path}.privilegeCommands. Move routed permissions to app.auth and agents.<id>.auth.`,
    );
  }

  for (const [key, entry] of Object.entries(value)) {
    assertNoLegacyPrivilegeCommands(entry, `${path}.${key}`);
  }
}

export function getAgentEntry(config: LoadedConfig, agentId: string): AgentEntry | undefined {
  return config.raw.agents.list.find((entry) => entry.id === agentId);
}

export function resolveSessionStorePath(config: LoadedConfig) {
  return config.raw.session.storePath || getDefaultSessionStorePath();
}
