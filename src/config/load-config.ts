import {
  DEFAULT_CONFIG_PATH,
  DEFAULT_PROCESSED_EVENTS_PATH,
  DEFAULT_SESSION_STORE_PATH,
  DEFAULT_STATE_DIR,
  DEFAULT_TMUX_SOCKET_PATH,
  expandHomePath,
} from "../shared/paths.ts";
import { resolveConfigDurationMs } from "./duration.ts";
import { resolveConfigEnvVars } from "./env-substitution.ts";
import { type AgentEntry, type MuxbotConfig, muxbotConfigSchema } from "./schema.ts";

export type ResolvedAgentConfig = {
  agentId: string;
  sessionName: string;
  workspacePath: string;
  runner: MuxbotConfig["agents"]["defaults"]["runner"];
  stream: Omit<MuxbotConfig["agents"]["defaults"]["stream"], "maxRuntimeSec" | "maxRuntimeMin"> & {
    maxRuntimeMs: number;
  };
  session: MuxbotConfig["agents"]["defaults"]["session"];
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
  raw: MuxbotConfig;
};

export async function loadConfig(configPath = DEFAULT_CONFIG_PATH): Promise<LoadedConfig> {
  const expandedConfigPath = expandHomePath(configPath);
  const text = await Bun.file(expandedConfigPath).text();
  const parsed = JSON.parse(text);
  const substituted = resolveConfigEnvVars(parsed) as unknown;
  const validated = muxbotConfigSchema.parse(substituted);

  return {
    configPath: expandedConfigPath,
    processedEventsPath: DEFAULT_PROCESSED_EVENTS_PATH,
    stateDir: DEFAULT_STATE_DIR,
    raw: {
      ...validated,
      tmux: {
        ...validated.tmux,
        socketPath: expandHomePath(validated.tmux.socketPath || DEFAULT_TMUX_SOCKET_PATH),
      },
      session: {
        ...validated.session,
        storePath: expandHomePath(validated.session.storePath || DEFAULT_SESSION_STORE_PATH),
      },
      agents: {
        ...validated.agents,
        defaults: {
          ...validated.agents.defaults,
          workspace: expandHomePath(validated.agents.defaults.workspace),
        },
        list: validated.agents.list.map((entry) => ({
          ...entry,
          workspace: entry.workspace ? expandHomePath(entry.workspace) : undefined,
        })),
      },
    },
  };
}

export function getAgentEntry(config: LoadedConfig, agentId: string): AgentEntry | undefined {
  return config.raw.agents.list.find((entry) => entry.id === agentId);
}

export function resolveSessionStorePath(config: LoadedConfig) {
  return config.raw.session.storePath || DEFAULT_SESSION_STORE_PATH;
}
