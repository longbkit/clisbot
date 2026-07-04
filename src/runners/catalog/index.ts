// CLI provider registry: the single lookup point for provider definitions.
// Adding a provider = one definition file beside this one plus one entry in
// CLI_PROVIDERS.

import { claudeProvider } from "./claude.ts";
import { codexProvider } from "./codex.ts";
import { geminiProvider } from "./gemini.ts";
import type { AgentCliToolId, CliProviderDefinition } from "./provider.ts";

export const CLI_PROVIDERS: Record<AgentCliToolId, CliProviderDefinition> = {
  codex: codexProvider,
  claude: claudeProvider,
  gemini: geminiProvider,
};

export function getCliProvider(id: AgentCliToolId): CliProviderDefinition {
  return CLI_PROVIDERS[id];
}

export function inferAgentCliToolId(command: string | undefined): AgentCliToolId | null {
  const trimmed = command?.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  return (
    (Object.keys(CLI_PROVIDERS) as AgentCliToolId[]).find(
      (id) => CLI_PROVIDERS[id].tmux.command === trimmed,
    ) ?? null
  );
}

export {
  INTERACTIVE_CLI_STARTUP_DELAY_MS,
  SUPPORTED_AGENT_CLI_TOOLS,
  type AgentCliToolId,
  type AgentToolTemplate,
  type CliProviderDefinition,
  type ProviderAcpPreset,
} from "./provider.ts";
