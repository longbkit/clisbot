import type { LoadedConfig } from "./load-config.ts";
import type { MuxbotConfig } from "./schema.ts";

export type BindingMatch = {
  channel: "slack" | "telegram";
  accountId?: string;
};

export function formatBinding(match: BindingMatch) {
  return match.accountId ? `${match.channel}:${match.accountId}` : match.channel;
}

export function resolveBoundAgentId(
  config: LoadedConfig | MuxbotConfig,
  match: BindingMatch,
): string | null {
  const raw = "raw" in config ? config.raw : config;
  const binding = raw.bindings.find((entry) => {
    if (entry.match.channel !== match.channel) {
      return false;
    }

    return (entry.match.accountId ?? "") === (match.accountId ?? "");
  });

  return binding?.agentId ?? null;
}

export function resolveTopLevelBoundAgentId(
  config: LoadedConfig | MuxbotConfig,
  match: BindingMatch,
): string | null {
  if (match.accountId) {
    const accountAgentId = resolveBoundAgentId(config, match);
    if (accountAgentId) {
      return accountAgentId;
    }
  }

  return resolveBoundAgentId(config, {
    channel: match.channel,
  });
}
