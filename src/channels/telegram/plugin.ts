import type { AgentSessionTarget } from "../../agents/agent-service.ts";
import type { ChannelPlugin } from "../channel-plugin.ts";
import type { ParsedMessageCommand } from "../message-command.ts";
import {
  listTelegramAccounts,
  resolveTelegramAccountConfig,
  type TelegramAccountConfig,
} from "../../config/channel-accounts.ts";
import { TelegramPollingService } from "./service.ts";
import { deleteTelegramMessageAction, editTelegramMessage, listTelegramPins, pinTelegramMessage, reactTelegramMessage, sendTelegramMessage, sendTelegramPoll, unpinTelegramMessage, unsupportedTelegramHistoryAction } from "./message-actions.ts";
import { resolveTelegramConversationRoute } from "./route-config.ts";
import { resolveTelegramConversationTarget } from "./session-routing.ts";

function resolveTelegramReplyTarget(params: {
  loadedConfig: Parameters<ChannelPlugin["resolveMessageReplyTarget"]>[0]["loadedConfig"];
  command: ParsedMessageCommand;
  accountId: string;
}): AgentSessionTarget | null {
  if (!params.command.target) {
    return null;
  }

  const chatId = Number(params.command.target);
  if (!Number.isFinite(chatId)) {
    return null;
  }

  const topicId = params.command.threadId ? Number(params.command.threadId) : undefined;
  const resolved = resolveTelegramConversationRoute({
    loadedConfig: params.loadedConfig,
    chatType: chatId > 0 ? "private" : "supergroup",
    chatId,
    topicId: Number.isFinite(topicId) ? topicId : undefined,
    isForum: Number.isFinite(topicId),
    accountId: params.accountId,
  });
  if (!resolved.route) {
    return null;
  }

  return resolveTelegramConversationTarget({
    loadedConfig: params.loadedConfig,
    agentId: resolved.route.agentId,
    accountId: params.accountId,
    chatId,
    userId: chatId > 0 ? chatId : undefined,
    conversationKind:
      resolved.conversationKind === "topic"
        ? "topic"
        : resolved.conversationKind === "dm"
          ? "dm"
          : "group",
    topicId: Number.isFinite(topicId) ? topicId : undefined,
  });
}

export const telegramChannelPlugin: ChannelPlugin = {
  id: "telegram",
  isEnabled: (loadedConfig) => loadedConfig.raw.channels.telegram.enabled,
  listAccounts: (loadedConfig) =>
    listTelegramAccounts(loadedConfig.raw.channels.telegram).map(({ accountId, config }) => ({
      accountId,
      config,
    })),
  createRuntimeService: (context, account) =>
    new TelegramPollingService(
      context.loadedConfig,
      context.agentService,
      context.processedEventsStore,
      context.activityStore,
      account.accountId,
      account.config as TelegramAccountConfig,
      context.reportLifecycle,
    ),
  renderHealthSummary: (state) => {
    switch (state) {
      case "starting":
        return "Telegram channel is starting.";
      case "disabled":
        return "Telegram channel is disabled in config.";
      case "stopped":
        return "Telegram channel is stopped.";
    }
  },
  renderActiveHealthSummary: (serviceCount) =>
    `Telegram polling connected for ${serviceCount} account(s).`,
  markStartupFailure: (store, error) => store.markTelegramFailure(error),
  runMessageCommand: async (loadedConfig, command) => {
    const account = resolveTelegramAccountConfig(
      loadedConfig.raw.channels.telegram,
      command.account,
    );
    const shared = {
      botToken: account.config.botToken,
      target: command.target!,
      threadId: command.threadId,
      replyTo: command.replyTo,
      message: command.message,
      media: command.media,
      messageId: command.messageId,
      emoji: command.emoji,
      remove: command.remove,
      limit: command.limit,
      query: command.query,
      pollQuestion: command.pollQuestion,
      pollOptions: command.pollOptions,
      forceDocument: command.forceDocument,
      silent: command.silent,
    };

    switch (command.action) {
      case "send":
        return { accountId: account.accountId, result: await sendTelegramMessage(shared) };
      case "poll":
        return { accountId: account.accountId, result: await sendTelegramPoll(shared) };
      case "react":
        return { accountId: account.accountId, result: await reactTelegramMessage(shared) };
      case "reactions":
        return {
          accountId: account.accountId,
          result: await unsupportedTelegramHistoryAction("reactions"),
        };
      case "read":
        return {
          accountId: account.accountId,
          result: await unsupportedTelegramHistoryAction("read"),
        };
      case "edit":
        return { accountId: account.accountId, result: await editTelegramMessage(shared) };
      case "delete":
        return {
          accountId: account.accountId,
          result: await deleteTelegramMessageAction(shared),
        };
      case "pin":
        return { accountId: account.accountId, result: await pinTelegramMessage(shared) };
      case "unpin":
        return { accountId: account.accountId, result: await unpinTelegramMessage(shared) };
      case "pins":
        return { accountId: account.accountId, result: await listTelegramPins(shared) };
      case "search":
        return {
          accountId: account.accountId,
          result: await unsupportedTelegramHistoryAction("search"),
        };
    }
  },
  resolveMessageReplyTarget: resolveTelegramReplyTarget,
};
