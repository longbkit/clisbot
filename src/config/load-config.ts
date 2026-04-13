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
import { type AgentEntry, type ClisbotConfig, clisbotConfigSchema } from "./schema.ts";

export type ResolvedAgentConfig = {
  agentId: string;
  sessionName: string;
  workspacePath: string;
  runner: ClisbotConfig["agents"]["defaults"]["runner"];
  stream: Omit<ClisbotConfig["agents"]["defaults"]["stream"], "maxRuntimeSec" | "maxRuntimeMin"> & {
    maxRuntimeLabel: string;
    maxRuntimeMs: number;
  };
  session: ClisbotConfig["agents"]["defaults"]["session"];
};

export function resolveMaxRuntimeMs(stream: {
  maxRuntimeSec?: number;
  maxRuntimeMin?: number;
}) {
  return resolveConfigDurationMs({
    seconds: stream.maxRuntimeSec,
    minutes: stream.maxRuntimeMin,
    defaultMinutes: 15,
  });
}

export type LoadedConfig = {
  configPath: string;
  processedEventsPath: string;
  stateDir: string;
  raw: ClisbotConfig;
};

export async function loadConfig(configPath = getDefaultConfigPath()): Promise<LoadedConfig> {
  const expandedConfigPath = expandHomePath(configPath);
  const text = await readTextFile(expandedConfigPath);
  const parsed = JSON.parse(text);
  const withDynamicDefaults = clisbotConfigSchema.parse(applyDynamicPathDefaults(parsed));
  const substituted = resolveConfigEnvVars(withDynamicDefaults, process.env, {
    skipPaths: getCredentialSkipPaths(withDynamicDefaults),
  }) as unknown;
  const validated = clisbotConfigSchema.parse(substituted);
  const materialized = materializeRuntimeChannelCredentials(validated, {
    env: process.env,
  });

  return materializeLoadedConfig(expandedConfigPath, materialized);
}

export async function loadConfigWithoutEnvResolution(
  configPath = getDefaultConfigPath(),
): Promise<LoadedConfig> {
  const expandedConfigPath = expandHomePath(configPath);
  const text = await readTextFile(expandedConfigPath);
  const parsed = JSON.parse(text);
  const validated = clisbotConfigSchema.parse(applyDynamicPathDefaults(parsed));
  return materializeLoadedConfig(expandedConfigPath, validated);
}

function materializeLoadedConfig(
  expandedConfigPath: string,
  validated: ClisbotConfig,
): LoadedConfig {
  return {
    configPath: expandedConfigPath,
    processedEventsPath: getDefaultProcessedEventsPath(),
    stateDir: getDefaultStateDir(),
    raw: {
      ...validated,
      tmux: {
        ...validated.tmux,
        socketPath: expandHomePath(validated.tmux.socketPath || getDefaultTmuxSocketPath()),
      },
      session: {
        ...validated.session,
        storePath: expandHomePath(validated.session.storePath || getDefaultSessionStorePath()),
      },
      agents: {
        ...validated.agents,
        defaults: {
          ...validated.agents.defaults,
          workspace: expandHomePath(
            validated.agents.defaults.workspace || getDefaultWorkspaceTemplate(),
          ),
        },
        list: validated.agents.list.map((entry) => ({
          ...entry,
          workspace: entry.workspace ? expandHomePath(entry.workspace) : undefined,
        })),
      },
    },
  };
}

export function applyDynamicPathDefaults(
  parsed: unknown,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!isRecord(parsed)) {
    return parsed;
  }

  const tmux = isRecord(parsed.tmux) ? parsed.tmux : {};
  const session = isRecord(parsed.session) ? parsed.session : {};
  const agents = isRecord(parsed.agents) ? parsed.agents : {};
  const agentDefaults = isRecord(agents.defaults) ? agents.defaults : {};

  return {
    ...parsed,
    tmux: {
      ...tmux,
      socketPath: typeof tmux.socketPath === "string" && tmux.socketPath.trim()
        ? tmux.socketPath
        : collapseHomePath(getDefaultTmuxSocketPath(env)),
    },
    session: {
      ...session,
      storePath: typeof session.storePath === "string" && session.storePath.trim()
        ? session.storePath
        : collapseHomePath(getDefaultSessionStorePath(env)),
    },
    agents: {
      ...agents,
      defaults: {
        ...agentDefaults,
        workspace: typeof agentDefaults.workspace === "string" && agentDefaults.workspace.trim()
          ? agentDefaults.workspace
          : collapseHomePath(getDefaultWorkspaceTemplate(env)),
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getAgentEntry(config: LoadedConfig, agentId: string): AgentEntry | undefined {
  return config.raw.agents.list.find((entry) => entry.id === agentId);
}

export function resolveSessionStorePath(config: LoadedConfig) {
  return config.raw.session.storePath || getDefaultSessionStorePath();
}
