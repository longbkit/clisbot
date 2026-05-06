import type { AgentSessionTarget } from "../../agents/agent-service.ts";
import type { ChannelPlugin } from "../channel-plugin.ts";
import type { ParsedMessageCommand } from "../message-command.ts";
import {
  listTeamsBots,
  resolveTeamsBotCredentials,
  type TeamsBotCredentialConfig,
} from "../../config/channel-bots.ts";
import { TeamsWebhookService } from "./service.ts";
import {
  sendTeamsMessage,
  editTeamsMessage,
  deleteTeamsMessage,
  unsupportedTeamsAction,
} from "./message-actions.ts";
import { resolveTeamsConversationRoute } from "./route-config.ts";
import { resolveTeamsConversationTarget } from "./session-routing.ts";

function resolveTeamsReplyTarget(params: {
  loadedConfig: Parameters<ChannelPlugin["resolveMessageReplyTarget"]>[0]["loadedConfig"];
  command: ParsedMessageCommand;
  botId: string;
}): AgentSessionTarget | null {
  if (!params.command.target) {
    return null;
  }

  const conversationId = params.command.target.trim();
  if (!conversationId) {
    return null;
  }

  // For Teams we need a serviceUrl to resolve a reply target.
  // We resolve based on conversationId for channel/group; for DM we use target as userId.
  const resolved = resolveTeamsConversationRoute({
    loadedConfig: params.loadedConfig,
    conversationType: "personal",
    conversationId,
    userId: conversationId,
    botId: params.botId,
  });

  if (!resolved.route) {
    // Try as a channel
    const channelResolved = resolveTeamsConversationRoute({
      loadedConfig: params.loadedConfig,
      conversationType: "channel",
      conversationId,
      botId: params.botId,
    });
    if (!channelResolved.route) {
      // Try as a group chat
      const groupResolved = resolveTeamsConversationRoute({
        loadedConfig: params.loadedConfig,
        conversationType: "groupChat",
        conversationId,
        botId: params.botId,
      });
      if (!groupResolved.route) {
        return null;
      }
      return resolveTeamsConversationTarget({
        loadedConfig: params.loadedConfig,
        agentId: groupResolved.route.agentId,
        botId: params.botId,
        conversationId,
        userId: null,
        conversationKind: "group",
      });
    }
    return resolveTeamsConversationTarget({
      loadedConfig: params.loadedConfig,
      agentId: channelResolved.route.agentId,
      botId: params.botId,
      conversationId,
      userId: null,
      conversationKind: "channel",
    });
  }

  return resolveTeamsConversationTarget({
    loadedConfig: params.loadedConfig,
    agentId: resolved.route.agentId,
    botId: params.botId,
    conversationId,
    userId: conversationId,
    conversationKind: "dm",
  });
}

export const teamsChannelPlugin: ChannelPlugin = {
  id: "teams",
  isEnabled: (loadedConfig) => loadedConfig.raw.bots.teams.defaults.enabled,
  listBots: (loadedConfig) =>
    listTeamsBots(loadedConfig.raw.bots.teams).map(({ botId, config }) => ({
      botId,
      config,
    })),
  createRuntimeService: (context, bot) =>
    new TeamsWebhookService(
      context.loadedConfig,
      context.agentService,
      context.processedEventsStore,
      context.activityStore,
      bot.botId,
      bot.config as TeamsBotCredentialConfig,
      context.reportLifecycle,
    ),
  renderHealthSummary: (state) => {
    switch (state) {
      case "starting":
        return "Teams channel is starting.";
      case "disabled":
        return "Teams channel is disabled in config.";
      case "stopped":
        return "Teams channel is stopped.";
    }
  },
  renderActiveHealthSummary: (serviceCount) =>
    `Teams webhook listening for ${serviceCount} bot(s).`,
  markStartupFailure: (store, error) => store.markTeamsFailure(error),
  runMessageCommand: async (loadedConfig, command) => {
    const bot = resolveTeamsBotCredentials(
      loadedConfig.raw.bots.teams,
      command.account,
    );
    // Teams message actions need a serviceUrl, which is obtained at runtime.
    // For CLI commands we use target as conversationId and require --reply-to for serviceUrl.
    const serviceUrl = command.replyTo ?? "";
    const shared = {
      appId: bot.config.appId,
      appPassword: bot.config.appPassword,
      target: command.target!,
      serviceUrl,
      messageId: command.messageId,
      message: command.message,
      inputFormat: command.inputFormat,
      renderMode: command.renderMode,
    };

    switch (command.action) {
      case "send":
        return { botId: bot.botId, result: await sendTeamsMessage(shared) };
      case "edit":
        return { botId: bot.botId, result: await editTeamsMessage(shared) };
      case "delete":
        return { botId: bot.botId, result: await deleteTeamsMessage(shared) };
      case "poll":
        return { botId: bot.botId, result: await unsupportedTeamsAction("poll") };
      case "react":
        return { botId: bot.botId, result: await unsupportedTeamsAction("react") };
      case "reactions":
        return { botId: bot.botId, result: await unsupportedTeamsAction("reactions") };
      case "read":
        return { botId: bot.botId, result: await unsupportedTeamsAction("read") };
      case "pin":
        return { botId: bot.botId, result: await unsupportedTeamsAction("pin") };
      case "unpin":
        return { botId: bot.botId, result: await unsupportedTeamsAction("unpin") };
      case "pins":
        return { botId: bot.botId, result: await unsupportedTeamsAction("pins") };
      case "search":
        return { botId: bot.botId, result: await unsupportedTeamsAction("search") };
    }
  },
  resolveMessageReplyTarget: resolveTeamsReplyTarget,
};
