// Config-layer view over the CLI provider catalog. Provider data (launch
// templates, quirks, ACP presets) lives in src/runners/catalog/; this module
// keeps the config-facing names and the runner-config assembly used by the
// schema, bootstrap, and control surfaces.

import { CLI_PROVIDERS, inferAgentCliToolId } from "../../runners/catalog/index.ts";
import type { AgentCliToolId, AgentToolTemplate } from "../../runners/catalog/provider.ts";

export {
  INTERACTIVE_CLI_STARTUP_DELAY_MS,
  SUPPORTED_AGENT_CLI_TOOLS,
  type AgentCliToolId,
  type AgentToolTemplate,
} from "../../runners/catalog/provider.ts";
export { inferAgentCliToolId };

export const SUPPORTED_BOOTSTRAP_MODES = ["personal-assistant", "team-assistant"] as const;
export type AgentBootstrapMode = (typeof SUPPORTED_BOOTSTRAP_MODES)[number];

export const DEFAULT_AGENT_TOOL_TEMPLATES: Record<AgentCliToolId, AgentToolTemplate> =
  Object.fromEntries(
    Object.entries(CLI_PROVIDERS).map(([id, provider]) => [id, provider.tmux]),
  ) as Record<AgentCliToolId, AgentToolTemplate>;

export type ResolvedRunnerTemplate = {
  command: string;
  args: string[];
  trustWorkspace: boolean;
  startupDelayMs: number;
  startupRetryCount: number;
  startupRetryDelayMs: number;
  startupReadyPattern?: string;
  startupBlockers?: AgentToolTemplate["startupBlockers"];
  promptSubmitDelayMs: number;
  sessionId: AgentToolTemplate["sessionId"];
};

export function buildRunnerFromToolTemplate(
  toolId: AgentCliToolId,
  template: AgentToolTemplate,
  startupOptions: string[] | undefined,
): ResolvedRunnerTemplate {
  const options = startupOptions?.length ? startupOptions : template.startupOptions;

  if (toolId === "codex") {
    return {
      command: template.command,
      args: [...options, "-C", "{workspace}"],
      trustWorkspace: template.trustWorkspace,
      startupDelayMs: template.startupDelayMs,
      startupRetryCount: template.startupRetryCount,
      startupRetryDelayMs: template.startupRetryDelayMs,
      startupReadyPattern: template.startupReadyPattern,
      startupBlockers: template.startupBlockers?.map((entry) => ({ ...entry })),
      promptSubmitDelayMs: template.promptSubmitDelayMs,
      sessionId: {
        ...template.sessionId,
        create: {
          ...template.sessionId.create,
          args: [...template.sessionId.create.args],
        },
        capture: {
          ...template.sessionId.capture,
        },
        resume: {
          ...template.sessionId.resume,
          args: ["resume", "{sessionId}", ...options, "-C", "{workspace}"],
        },
      },
    };
  }

  return {
    command: template.command,
    args: [...options],
    trustWorkspace: template.trustWorkspace,
    startupDelayMs: template.startupDelayMs,
    startupRetryCount: template.startupRetryCount,
    startupRetryDelayMs: template.startupRetryDelayMs,
    startupReadyPattern: template.startupReadyPattern,
    startupBlockers: template.startupBlockers?.map((entry) => ({ ...entry })),
    promptSubmitDelayMs: template.promptSubmitDelayMs,
    sessionId: {
      ...template.sessionId,
      create: {
        ...template.sessionId.create,
        args: [...template.sessionId.create.args],
      },
      capture: {
        ...template.sessionId.capture,
      },
      resume: {
        ...template.sessionId.resume,
        args: ["--resume", "{sessionId}", ...options],
      },
    },
  };
}
