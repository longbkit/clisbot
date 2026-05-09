import type { AgentSessionTarget } from "../../agents/agent-service.ts";
import type { ChannelPlugin } from "../channel-plugin.ts";
import type { ParsedMessageCommand } from "../message-command.ts";
import {
  listZaloBotBots,
  resolveZaloBotCredentials,
  type ZaloBotCredentialConfig,
} from "../../config/channel-bots.ts";
import { ZaloBotPollingService } from "./service.ts";
import {
  sendZaloBotMessageAction,
  unsupportedZaloBotHistoryAction,
} from "./message-actions.ts";
import { resolveZaloBotConversationRoute } from "./route-config.ts";
import { resolveZaloBotConversationTarget } from "./session-routing.ts";

function resolveZaloBotReplyTarget(params: {
  loadedConfig: Parameters<ChannelPlugin["resolveMessageReplyTarget"]>[0]["loadedConfig"];
  command: ParsedMessageCommand;
  botId: string;
}): AgentSessionTarget | null {
  if (!params.command.target) {
    return null;
  }

  const chatId = params.command.target.trim();
  if (!chatId) {
    return null;
  }

  const conversation = resolveZaloBotConversationRoute({
    loadedConfig: params.loadedConfig,
    chatType: chatId.startsWith("g") ? "GROUP" : "PRIVATE",
    chatId,
    senderId: chatId.startsWith("g") ? undefined : chatId,
    botId: params.botId,
  });
  if (!conversation.route) {
    return null;
  }

  return resolveZaloBotConversationTarget({
    loadedConfig: params.loadedConfig,
    agentId: conversation.route.agentId,
    botId: params.botId,
    chatId,
    userId: conversation.conversationKind === "dm" ? chatId : undefined,
    conversationKind: conversation.conversationKind,
  });
}

export const zaloBotChannelPlugin: ChannelPlugin = {
  id: "zalo-bot",
  isEnabled: (loadedConfig) => loadedConfig.raw.bots.zaloBot.defaults.enabled,
  listBots: (loadedConfig) =>
    listZaloBotBots(loadedConfig.raw.bots.zaloBot).map(({ botId, config }) => ({
      botId,
      config,
    })),
  createRuntimeService: (context, bot) =>
    new ZaloBotPollingService(
      context.loadedConfig,
      context.agentService,
      context.processedEventsStore,
      context.activityStore,
      bot.botId,
      bot.config as ZaloBotCredentialConfig,
      context.reportLifecycle,
    ),
  renderHealthSummary: (state) => {
    switch (state) {
      case "starting":
        return "Zalo Bot channel is starting.";
      case "disabled":
        return "Zalo Bot channel is disabled in config.";
      case "stopped":
        return "Zalo Bot channel is stopped.";
    }
  },
  renderActiveHealthSummary: (serviceCount) =>
    `Zalo Bot polling connected for ${serviceCount} bot(s).`,
  markStartupFailure: (store, error) => store.markZaloBotFailure(error),
  runMessageCommand: async (loadedConfig, command) => {
    const bot = resolveZaloBotCredentials(
      loadedConfig.raw.bots.zaloBot,
      command.account,
    );
    switch (command.action) {
      case "send":
        return {
          botId: bot.botId,
          result: await sendZaloBotMessageAction({
            botToken: bot.config.botToken,
            target: command.target!,
            message: command.message,
            media: command.media,
            inputFormat: command.inputFormat,
            renderMode: command.renderMode,
          }),
        };
      default:
        return {
          botId: bot.botId,
          result: await unsupportedZaloBotHistoryAction(command.action),
        };
    }
  },
  resolveMessageReplyTarget: resolveZaloBotReplyTarget,
};
