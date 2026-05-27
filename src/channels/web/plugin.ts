import type { ChannelPlugin } from "../channel-plugin.ts";
import type { WebBotConfig } from "./service.ts";
import { WebRuntimeService } from "./service.ts";

function getWebConfig(loadedConfig: Parameters<ChannelPlugin["isEnabled"]>[0]): WebBotConfig | null {
  const raw = loadedConfig.raw as { bots?: { web?: { apiKey?: string; port?: number; agentId?: string; ownerId?: string } } };
  const web = raw.bots?.web;
  if (!web?.apiKey) return null;
  return {
    port: web.port ?? 3099,
    apiKey: web.apiKey,
    agentId: web.agentId ?? loadedConfig.raw.agents.defaults.defaultAgentId ?? "default",
    ownerId: web.ownerId,
  };
}

export const webChannelPlugin: ChannelPlugin = {
  id: "web",
  isEnabled: (loadedConfig) => !!getWebConfig(loadedConfig),
  listBots: (loadedConfig) => {
    const config = getWebConfig(loadedConfig);
    if (!config) return [];
    return [{ botId: "default", config }];
  },
  createRuntimeService: (context, bot) =>
    new WebRuntimeService(
      context.loadedConfig,
      context.agentService,
      bot.config as WebBotConfig,
      context.reportLifecycle,
    ),
  renderHealthSummary: (state) => {
    switch (state) {
      case "starting": return "Web channel is starting.";
      case "disabled": return "Web channel is disabled (no apiKey configured).";
      case "stopped": return "Web channel is stopped.";
    }
  },
  renderActiveHealthSummary: () => "Web channel WebSocket server active.",
  markStartupFailure: async (store, error) => {
    await store.markWebFailure(error);
  },
  runMessageCommand: async (_loadedConfig, _command) => {
    return { botId: "default", result: { ok: false, error: "Web channel does not support CLI message commands." } };
  },
  resolveMessageReplyTarget: () => null,
};
