import { AgentService } from "../../agents/agent-service.ts";
import {
  isImplicitFollowUpAllowed,
  resolveFollowUpMode,
} from "../../agents/follow-up-policy.ts";
import { parseAgentCommand } from "../../agents/commands.ts";
import { prependAttachmentMentions } from "../../agents/attachments/prompt.ts";
import { processChannelInteraction } from "../interaction-processing.ts";
import { getAgentEntry, type LoadedConfig } from "../../config/load-config.ts";
import { isTelegramSenderAllowed } from "../pairing/access.ts";
import { buildPairingReplyFromRequest } from "../pairing/messages.ts";
import {
  readChannelAllowFromStore,
  upsertChannelPairingRequest,
} from "../pairing/store.ts";
import { ProcessedEventsStore } from "../processed-events-store.ts";
import { ActivityStore } from "../../control/activity-store.ts";
import {
  callTelegramApi,
  isTelegramPollingConflict,
  retryTelegramPollingConflict,
} from "./api.ts";
import {
  getTelegramUpdateSkipReason,
  hasForeignTelegramMention,
  hasTelegramBotMention,
  isReplyToTelegramBot,
  isTelegramBotOriginatedMessage,
  stripTelegramBotMention,
  type TelegramMessage,
  type TelegramUpdate,
} from "./message.ts";
import {
  resolveTelegramConversationTarget,
  type TelegramConversationKind,
} from "./session-routing.ts";
import { resolveTelegramConversationRoute } from "./route-config.ts";
import {
  getTelegramMaxChars,
  postTelegramText,
  reconcileTelegramText,
  shouldOmitTelegramThreadId,
  type TelegramPostedMessageChunk,
} from "./transport.ts";
import { resolveTelegramMessageContent } from "./content.ts";
import { resolveTelegramAttachmentPaths } from "./attachments.ts";
import { sleep } from "../../shared/process.ts";
import type { TelegramAccountConfig } from "../../config/channel-accounts.ts";
import { buildAgentPromptText } from "../agent-prompt.ts";
import { buildMentionOnlyFollowUpPrompt } from "../mention-follow-up.ts";
import { prependRecentConversationContext } from "../../shared/recent-message-context.ts";
import { DEFAULT_PROTECTED_CONTROL_RULE } from "../../auth/defaults.ts";
import { resolveChannelAuth } from "../../auth/resolve.ts";
import {
  claimFirstOwnerFromDirectMessage,
  renderFirstOwnerClaimMessage,
} from "../../auth/owner-claim.ts";
import { logLatencyDebug } from "../../control/latency-debug.ts";
import { renderTelegramRouteChoiceMessage } from "./route-guidance.ts";
import { beginTelegramTypingHeartbeat } from "./typing.ts";
import { buildTokenHint } from "../runtime-identity.ts";
import { ConversationProcessingIndicatorCoordinator } from "../processing-indicator.ts";
import type { ChannelRuntimeLifecycleEvent } from "../channel-plugin.ts";

type TelegramGetMeResult = {
  id: number;
  username?: string;
};

type TelegramGetUpdatesResult = TelegramUpdate[];

type TelegramRegisteredCommand = {
  command: string;
  description: string;
};

type TelegramCommandScope =
  | {
      type: "default";
    }
  | {
      type: "all_private_chats";
    }
  | {
      type: "chat";
      chat_id: number;
    };

type TelegramCommandRegistration = {
  commands: TelegramRegisteredCommand[];
  scope?: TelegramCommandScope;
};

const TELEGRAM_MINIMAL_COMMANDS: TelegramRegisteredCommand[] = [
  { command: "start", description: "Show onboarding help for this chat" },
  { command: "status", description: "Show route status for this chat" },
  { command: "help", description: "Show available control commands" },
  { command: "whoami", description: "Show current route identity" },
];

const TELEGRAM_FULL_COMMANDS: TelegramRegisteredCommand[] = [
  ...TELEGRAM_MINIMAL_COMMANDS,
  { command: "transcript", description: "Show current transcript" },
  { command: "attach", description: "Attach to the active run" },
  { command: "detach", description: "Stop live updates for this thread" },
  { command: "watch", description: "Watch the active run on an interval" },
  { command: "stop", description: "Interrupt current run" },
  { command: "nudge", description: "Send one extra Enter to the session" },
  { command: "followup", description: "Show or change follow-up mode" },
  { command: "streaming", description: "Show or change streaming mode" },
  { command: "responsemode", description: "Show or change response mode" },
  { command: "additionalmessagemode", description: "Show or change later-message mode" },
  { command: "queue", description: "Queue a later message behind the active run" },
  { command: "steer", description: "Steer the active run immediately" },
  { command: "loop", description: "Show or manage loops for this route" },
  { command: "bash", description: "Run bash in the agent workspace" },
];

const TELEGRAM_STARTUP_CONFLICT_MAX_WAIT_MS = 6_000;

export function renderTelegramUnroutedRouteMessage(params: {
  mode: "start" | "help" | "status" | "whoami";
  chatId: number;
  chatType: TelegramMessage["chat"]["type"];
  topicId?: number;
  isForum: boolean;
}) {
  const lines = params.mode === "whoami"
    ? [
        "Who am I",
        "",
        "platform: `telegram`",
        `chatType: \`${params.chatType}\``,
        `chatId: \`${params.chatId}\``,
      ]
    : [];

  if (params.mode === "whoami" && params.topicId != null) {
    lines.push(`topicId: \`${params.topicId}\``);
  }

  if (params.mode === "whoami" && params.isForum) {
    lines.push("isForum: `true`");
  }

  if (params.mode === "whoami") {
    lines.push("routed: `no`");
    lines.push("");
    lines.push(
      renderTelegramRouteChoiceMessage({
        chatId: params.chatId,
        topicId: params.topicId,
        includeConfigPath: true,
      }),
    );
    return lines.join("\n");
  }

  return renderTelegramRouteChoiceMessage({
    chatId: params.chatId,
    topicId: params.topicId,
  });
}

export function buildTelegramCommandRegistrations(
  telegramConfig: LoadedConfig["raw"]["channels"]["telegram"],
): TelegramCommandRegistration[] {
  const groupChatScopes = Object.keys(telegramConfig.groups)
    .map((chatId) => Number(chatId))
    .filter((chatId) => Number.isSafeInteger(chatId))
    .map((chat_id) => ({
      commands: TELEGRAM_FULL_COMMANDS,
      scope: {
        type: "chat" as const,
        chat_id,
      },
    }));

  return [
    {
      commands: TELEGRAM_MINIMAL_COMMANDS,
    },
    {
      commands: TELEGRAM_FULL_COMMANDS,
      scope: {
        type: "all_private_chats",
      },
    },
    ...groupChatScopes,
  ];
}

export function dispatchTelegramUpdates(params: {
  updates: TelegramUpdate[];
  handleUpdate: (update: TelegramUpdate) => Promise<void>;
  onUnhandledError?: (error: unknown, update: TelegramUpdate) => void;
}) {
  const tasks: Promise<void>[] = [];
  let nextUpdateId: number | undefined;

  for (const update of params.updates) {
    nextUpdateId = update.update_id + 1;
    const task = params.handleUpdate(update).catch((error) => {
      params.onUnhandledError?.(error, update);
    });
    tasks.push(task);
  }

  return {
    nextUpdateId,
    tasks,
  };
}

export class TelegramPollingService {
  private botUserId = 0;
  private botUsername = "";
  private running = false;
  private nextUpdateId?: number;
  private loopPromise?: Promise<void>;
  private activePollController?: AbortController;
  private readonly inFlightUpdates = new Set<Promise<void>>();
  private readonly processingIndicators = new ConversationProcessingIndicatorCoordinator();

  constructor(
    private readonly loadedConfig: LoadedConfig,
    private readonly agentService: AgentService,
    private readonly processedEventsStore: ProcessedEventsStore,
    private readonly activityStore: ActivityStore,
    private readonly accountId = "default",
    private readonly accountConfig: TelegramAccountConfig,
    private readonly reportLifecycle?: (event: ChannelRuntimeLifecycleEvent) => Promise<void>,
  ) {
    this.agentService.registerSurfaceNotificationHandler({
      platform: "telegram",
      accountId: this.accountId,
      handler: async ({ binding, text }) => {
        if (!binding.chatId) {
          return;
        }
        const chatId = Number(binding.chatId);
        if (!Number.isFinite(chatId)) {
          return;
        }
        const topicId = binding.topicId ? Number(binding.topicId) : undefined;
        const renderedNotification = resolveTelegramMessageContent({
          text,
          inputFormat: "md",
          renderMode: "native",
        });
        await postTelegramText({
          token: this.accountConfig.botToken,
          chatId,
          text: renderedNotification.text,
          topicId: Number.isFinite(topicId) ? topicId : undefined,
          omitThreadId: shouldOmitTelegramThreadId(Number.isFinite(topicId) ? topicId : undefined),
          wireFormat: renderedNotification.wireFormat,
        });
      },
    });
  }

  async start() {
    const me = await callTelegramApi<TelegramGetMeResult>(
      this.accountConfig.botToken,
      "getMe",
      {},
    );
    this.botUserId = me.id;
    this.botUsername = me.username ?? "";
    console.log(`telegram bot @${this.botUsername || this.botUserId} (${this.accountId})`);
    await this.initializeOffset();
    await this.registerCommands();
    this.running = true;
    this.loopPromise = this.pollLoop();
  }

  async stop() {
    this.running = false;
    this.activePollController?.abort();
    await this.loopPromise;
    await Promise.allSettled([...this.inFlightUpdates]);
    this.agentService.unregisterSurfaceNotificationHandler({
      platform: "telegram",
      accountId: this.accountId,
    });
  }

  getBotLabel() {
    return this.botUsername ? `@${this.botUsername}` : `${this.botUserId || "unknown"}`;
  }

  getRuntimeIdentity() {
    return {
      accountId: this.accountId,
      label: `bot=${this.getBotLabel()}`,
      tokenHint: buildTokenHint(this.accountConfig.botToken),
    };
  }

  private async pollLoop() {
    const telegramConfig = this.loadedConfig.raw.channels.telegram;
    while (this.running) {
      try {
        const controller = new AbortController();
        this.activePollController = controller;
        const updates = await callTelegramApi<TelegramGetUpdatesResult>(
          this.accountConfig.botToken,
          "getUpdates",
          {
            timeout: telegramConfig.polling.timeoutSeconds,
            offset: this.nextUpdateId,
            allowed_updates: ["message"],
          },
          {
            signal: controller.signal,
            timeoutMs: (telegramConfig.polling.timeoutSeconds + 5) * 1000,
          },
        );
        this.activePollController = undefined;

        const dispatched = dispatchTelegramUpdates({
          updates,
          handleUpdate: (update) => this.handleUpdate(update),
          onUnhandledError: (error) => {
            console.error("telegram handler error", error);
          },
        });
        if (dispatched.nextUpdateId != null) {
          this.nextUpdateId = dispatched.nextUpdateId;
        }
        for (const task of dispatched.tasks) {
          this.trackInFlightUpdate(task);
        }
      } catch (error) {
        this.activePollController = undefined;
        if (!this.running) {
          return;
        }
        if (isTelegramPollingConflict(error)) {
          this.running = false;
          await this.reportLifecycle?.({
            connection: "failed",
            summary: "Telegram polling stopped because another instance is already using this bot token.",
            detail:
              error instanceof Error ? error.message : String(error),
            actions: [
              "stop the other Telegram poller that is using the same bot token",
              "run `clisbot start` again after the token is no longer in use elsewhere",
            ],
          });
          console.error(
            "telegram polling stopped: another bot instance is already calling getUpdates for this token",
          );
          return;
        }
        console.error("telegram polling error", error);
        await sleep(telegramConfig.polling.retryDelayMs);
      }
    }
  }

  private trackInFlightUpdate(task: Promise<void>) {
    this.inFlightUpdates.add(task);
    task.finally(() => {
      this.inFlightUpdates.delete(task);
    });
  }

  private async handleUpdate(update: TelegramUpdate) {
    const skipReason = getTelegramUpdateSkipReason(update);
    if (skipReason) {
      return;
    }

    const eventId = `telegram:${update.update_id}`;
    const existingStatus = await this.processedEventsStore.getStatus(eventId);
    if (existingStatus === "processing" || existingStatus === "completed") {
      return;
    }

    const message = update.message as TelegramMessage;
    const rawText = `${message.text ?? message.caption ?? ""}`.trim();
    const slashCommand = parseAgentCommand(rawText, {
      botUsername: this.botUsername,
      commandPrefixes: this.loadedConfig.raw.channels.telegram.commandPrefixes,
    });
    const routeInfo = resolveRouteAndTarget({
      loadedConfig: this.loadedConfig,
      message,
      agentService: this.agentService,
      botUserId: this.botUserId,
      botUsername: this.botUsername,
      accountId: this.accountId,
    });
    if (!routeInfo.route) {
      if (
        routeInfo.conversationKind !== "dm" &&
        slashCommand?.type === "control" &&
        (
          slashCommand.name === "whoami" ||
          slashCommand.name === "start" ||
          slashCommand.name === "help" ||
          slashCommand.name === "status"
        )
      ) {
          try {
            await callTelegramApi(
            this.accountConfig.botToken,
              "sendMessage",
            {
              chat_id: message.chat.id,
              text: renderTelegramUnroutedRouteMessage({
                mode: slashCommand.name,
                chatId: message.chat.id,
                chatType: message.chat.type,
                topicId: routeInfo.topicId ?? undefined,
                isForum: message.chat.is_forum === true,
              }),
              ...(routeInfo.topicId != null && !shouldOmitTelegramThreadId(routeInfo.topicId)
                ? { message_thread_id: routeInfo.topicId }
                : {}),
            },
          );
        } catch (error) {
          console.error("telegram unrouted whoami reply failed", error);
        }
      }
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }

    if (message.from?.id === this.botUserId) {
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }

    if (isTelegramBotOriginatedMessage(message) && !routeInfo.route.allowBots) {
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }

    if (routeInfo.conversationKind === "dm") {
      const directMessages = this.loadedConfig.raw.channels.telegram.directMessages;
      const senderId = message.from?.id != null ? String(message.from.id) : "";
      const senderUsername = message.from?.username;
      const dmIdentity = {
        platform: "telegram" as const,
        conversationKind: routeInfo.conversationKind,
        senderId: senderId || undefined,
        chatId: String(message.chat.id),
      };
      if (!senderId || directMessages.policy === "disabled") {
        await this.processedEventsStore.markCompleted(eventId);
        return;
      }

      let ownerClaimed = false;
      let ownerPrincipal: string | undefined;
      try {
        const claimResult = await claimFirstOwnerFromDirectMessage({
          config: this.loadedConfig.raw,
          configPath: this.loadedConfig.configPath,
          identity: dmIdentity,
        });
        ownerClaimed = claimResult.claimed;
        ownerPrincipal = claimResult.principal;
      } catch (error) {
        console.error("telegram first-owner claim failed", error);
      }

      if (ownerClaimed && ownerPrincipal) {
        try {
          await callTelegramApi(
            this.accountConfig.botToken,
            "sendMessage",
            {
              chat_id: message.chat.id,
              ...(message.message_id != null
                ? { reply_to_message_id: message.message_id }
                : {}),
              text: renderFirstOwnerClaimMessage({
                principal: ownerPrincipal,
                ownerClaimWindowMinutes: this.loadedConfig.raw.app.auth.ownerClaimWindowMinutes,
              }),
            },
          );
        } catch (error) {
          console.error("telegram first-owner claim reply failed", error);
        }
      }

      const auth = resolveChannelAuth({
        config: this.loadedConfig.raw,
        agentId: routeInfo.route.agentId,
        identity: dmIdentity,
      });

      if (directMessages.policy !== "open" && !auth.mayBypassPairing) {
        const storedAllowFrom = await readChannelAllowFromStore("telegram");
        const allowed = isTelegramSenderAllowed({
          allowFrom: [...directMessages.allowFrom, ...storedAllowFrom],
          userId: senderId,
          username: senderUsername,
        });
        if (!allowed) {
          if (directMessages.policy === "pairing") {
            const pairingRequest = await upsertChannelPairingRequest({
              channel: "telegram",
              id: senderId,
              meta: {
                username: senderUsername,
                firstName: message.from?.first_name,
                lastName: message.from?.last_name,
              },
            });
            const pairingReply = buildPairingReplyFromRequest({
              channel: "telegram",
              idLine: `Your Telegram user id: ${senderId}`,
              pairingRequest,
            });
            if (pairingReply) {
              try {
                await callTelegramApi(
                  this.accountConfig.botToken,
                  "sendMessage",
                  {
                    chat_id: message.chat.id,
                    text: pairingReply,
                  },
                );
              } catch (error) {
                console.error("telegram pairing reply failed", error);
              }
            }
          }
          await this.processedEventsStore.markCompleted(eventId);
          return;
        }
      }
    }
    if (hasForeignTelegramMention(rawText, this.botUsername)) {
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }
    const explicitMention =
      hasTelegramBotMention(rawText, this.botUsername) ||
      Boolean(slashCommand && rawText.startsWith("/"));
    const followUpState =
      await this.agentService.getConversationFollowUpState(routeInfo.sessionTarget);
    const effectiveFollowUpMode = resolveFollowUpMode({
      defaultMode: routeInfo.route.followUp.mode,
      overrideMode: followUpState.overrideMode,
    });
    const bypassMention = rawText.startsWith("/") || rawText.startsWith("!");
    const wasMentioned =
      explicitMention ||
      bypassMention ||
      isImplicitFollowUpAllowed({
        mode: effectiveFollowUpMode,
        participationTtlMs: routeInfo.route.followUp.participationTtlMs,
        lastBotReplyAt: followUpState.lastBotReplyAt,
        directReplyToBot: isReplyToTelegramBot(message, this.botUserId),
      });
    const textBody = explicitMention
      ? stripTelegramBotMention(rawText, this.botUsername)
      : rawText;
    const recentMessageMarker = String(message.message_id);
    if (rawText || explicitMention || slashCommand) {
      await this.agentService.appendRecentConversationMessage(routeInfo.sessionTarget, {
        marker: recentMessageMarker,
        text: slashCommand ? "" : textBody,
        senderId:
          message.from?.id != null ? String(message.from.id).trim() : undefined,
        senderName: [message.from?.first_name, message.from?.last_name]
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .join(" ")
          .trim() || message.from?.username?.trim() || undefined,
      });
    }
    if (routeInfo.route.requireMention && !wasMentioned) {
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }

    if (explicitMention && followUpState.overrideMode === "paused") {
      await this.agentService.reactivateConversationFollowUp(routeInfo.sessionTarget);
    }
    const effectivePromptText =
      textBody ||
      (explicitMention
        ? buildMentionOnlyFollowUpPrompt({
            conversationKind:
              routeInfo.conversationKind === "topic" ? "group" : routeInfo.conversationKind,
            threaded:
              routeInfo.topicId != null ||
              (message.message_thread_id != null &&
                Number.isFinite(message.message_thread_id)),
          })
        : "");
    const attachmentPaths = await resolveTelegramAttachmentPaths({
      message,
      botToken: this.accountConfig.botToken,
      workspacePath: this.agentService.getWorkspacePath(routeInfo.sessionTarget),
      sessionKey: routeInfo.sessionTarget.sessionKey,
      messageId: String(message.message_id),
    });
    const text = prependAttachmentMentions(effectivePromptText, attachmentPaths);
    if (!text) {
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }
    const recentConversationReplay = await this.agentService.getRecentConversationReplayMessages(
      routeInfo.sessionTarget,
      {
        excludeMarker: recentMessageMarker,
      },
    );
    const enrichPromptText = (nextText: string) =>
      prependRecentConversationContext({
        currentText: nextText,
        recentMessages: recentConversationReplay,
      });

    await this.processedEventsStore.markProcessing(eventId);
    await this.activityStore.record({
      agentId: routeInfo.route.agentId,
      channel: "telegram",
      surface:
        routeInfo.conversationKind === "dm"
          ? "dm"
          : routeInfo.topicId != null
            ? `topic:${message.chat.id}:${routeInfo.topicId}`
            : `group:${message.chat.id}`,
    });
    try {
      let responseChunks: TelegramPostedMessageChunk[] = [];
      const senderName = [message.from?.first_name, message.from?.last_name]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" ")
        .trim();
      const identity = {
        platform: "telegram" as const,
        accountId: this.accountId,
        conversationKind: routeInfo.conversationKind,
        senderId:
          message.from?.id != null ? String(message.from.id).trim() : undefined,
        senderName:
          senderName || message.from?.username?.trim() || undefined,
        chatId: String(message.chat.id),
        chatName: message.chat.title?.trim() || undefined,
        topicId:
          routeInfo.topicId != null ? String(routeInfo.topicId) : undefined,
      };
      const cliTool = getAgentEntry(this.loadedConfig, routeInfo.route.agentId)?.cliTool;
      const auth = resolveChannelAuth({
        config: this.loadedConfig.raw,
        agentId: routeInfo.route.agentId,
        identity,
      });
      const protectedControlMutationRule = auth.mayManageProtectedResources
        ? undefined
        : DEFAULT_PROTECTED_CONTROL_RULE;
      const agentPromptText = buildAgentPromptText({
        text: enrichPromptText(text),
        identity,
        config: this.loadedConfig.raw.channels.telegram.agentPrompt,
        cliTool,
        responseMode: routeInfo.route.responseMode,
        streaming: routeInfo.route.streaming,
        protectedControlMutationRule,
      });
      const timingContext = {
        platform: "telegram" as const,
        eventId,
        agentId: routeInfo.route.agentId,
        chatId: String(message.chat.id),
        topicId:
          routeInfo.topicId != null ? String(routeInfo.topicId) : undefined,
        sessionKey: routeInfo.sessionTarget.sessionKey,
      };
      logLatencyDebug("telegram-event-accepted", timingContext, {
        conversationKind: routeInfo.conversationKind,
        responseMode: routeInfo.route.responseMode,
        accountId: this.accountId,
      });
      const processingLease = await this.processingIndicators.acquire({
        key: `telegram:${this.accountId}:${message.chat.id}:${routeInfo.topicId ?? "root"}`,
        activate: async () =>
          beginTelegramTypingHeartbeat({
            sendTyping: () => this.sendTyping(message.chat.id, routeInfo.topicId),
            onError: (error) => {
              console.error("telegram typing failed", error);
            },
          }),
        onError: (_phase, error) => {
          console.error("telegram processing indicator failed", error);
        },
      });
      try {
        const interaction = await processChannelInteraction({
          agentService: this.agentService,
          sessionTarget: routeInfo.sessionTarget,
          identity,
          auth,
          senderId:
            message.from?.id != null ? String(message.from.id).trim() : undefined,
          text,
          agentPromptText,
          agentPromptBuilder: (nextText) =>
            buildAgentPromptText({
              text: enrichPromptText(nextText),
              identity,
              config: this.loadedConfig.raw.channels.telegram.agentPrompt,
              cliTool,
              responseMode: routeInfo.route.responseMode,
              streaming: routeInfo.route.streaming,
              protectedControlMutationRule,
            }),
          protectedControlMutationRule,
          transformSessionInputText: enrichPromptText,
          onPromptAccepted: async () => {
            await this.agentService.markRecentConversationProcessed(
              routeInfo.sessionTarget,
              recentMessageMarker,
            );
          },
          route: routeInfo.route,
          maxChars: this.getTelegramMaxChars(routeInfo.route.agentId),
          timingContext,
          postText: async (nextText) => {
            const renderedReply = resolveTelegramMessageContent({
              text: nextText,
              inputFormat: "md",
              renderMode: "native",
            });
            responseChunks = await postTelegramText({
              token: this.accountConfig.botToken,
              chatId: message.chat.id,
              text: renderedReply.text,
              topicId: routeInfo.topicId,
              omitThreadId: shouldOmitTelegramThreadId(routeInfo.topicId),
              wireFormat: renderedReply.wireFormat,
            });
            return responseChunks;
          },
          reconcileText: async (chunks, nextText) => {
            const renderedReply = resolveTelegramMessageContent({
              text: nextText,
              inputFormat: "md",
              renderMode: "native",
            });
            responseChunks = await reconcileTelegramText({
              token: this.accountConfig.botToken,
              chatId: message.chat.id,
              chunks,
              text: renderedReply.text,
              topicId: routeInfo.topicId,
              omitThreadId: shouldOmitTelegramThreadId(routeInfo.topicId),
              wireFormat: renderedReply.wireFormat,
            });
            return responseChunks;
          },
        });
        await processingLease.setLifecycle({
          agentService: this.agentService,
          sessionTarget: routeInfo.sessionTarget,
          observerId: `telegram-processing:${message.chat.id}:${routeInfo.topicId ?? "root"}`,
          lifecycle: interaction.processingIndicatorLifecycle,
        });
      } finally {
        await processingLease.release();
      }
      await this.processedEventsStore.markCompleted(eventId);
    } catch (error) {
      console.error("telegram handler error", error);
      await this.processedEventsStore.clear(eventId);
    }
  }

  private async sendTyping(chatId: number, topicId?: number) {
    await callTelegramApi(
      this.accountConfig.botToken,
      "sendChatAction",
      {
        chat_id: chatId,
        action: "typing",
        ...(topicId != null ? { message_thread_id: topicId } : {}),
      },
    );
  }

  private getTelegramMaxChars(agentId: string) {
    return getTelegramMaxChars(this.agentService.getMaxMessageChars(agentId));
  }

  private async registerCommands() {
    const token = this.accountConfig.botToken;
    try {
      for (const registration of buildTelegramCommandRegistrations(
        this.loadedConfig.raw.channels.telegram,
      )) {
        await callTelegramApi(token, "setMyCommands", registration.scope
          ? {
              commands: registration.commands,
              scope: registration.scope,
            }
          : {
              commands: registration.commands,
            });
      }
    } catch (error) {
      console.error("telegram command registration failed", error);
    }
  }

  private async initializeOffset() {
    const telegramConfig = this.loadedConfig.raw.channels.telegram;
    const updates = await retryTelegramPollingConflict({
      operation: () =>
        callTelegramApi<TelegramGetUpdatesResult>(
          this.accountConfig.botToken,
          "getUpdates",
          {
            timeout: 0,
            allowed_updates: ["message"],
          },
        ),
      retryDelayMs: telegramConfig.polling.retryDelayMs,
      maxWaitMs: TELEGRAM_STARTUP_CONFLICT_MAX_WAIT_MS,
    });
    const lastUpdateId = updates.at(-1)?.update_id;
    if (typeof lastUpdateId === "number") {
      this.nextUpdateId = lastUpdateId + 1;
      console.log(`telegram dropped ${updates.length} pending updates on startup`);
    }
  }
}

function resolveRouteAndTarget(params: {
  loadedConfig: LoadedConfig;
  message: TelegramMessage;
  agentService: AgentService;
  botUserId: number;
  botUsername: string;
  accountId: string;
}) {
  const isForum = params.message.chat.is_forum === true;
  const topicId =
    params.message.chat.type === "supergroup" && isForum
      ? (params.message.message_thread_id ?? 1)
      : undefined;
  const routeInfo = resolveTelegramConversationRoute({
    loadedConfig: params.loadedConfig,
    chatType: params.message.chat.type,
    chatId: params.message.chat.id,
    topicId,
    isForum,
    accountId: params.accountId,
  });
  const route = routeInfo.route;
  if (!route) {
    return {
      conversationKind: routeInfo.conversationKind,
      route: null,
      sessionTarget: null,
      topicId,
    };
  }

  return {
    conversationKind: routeInfo.conversationKind,
    route,
    topicId,
    sessionTarget: resolveTelegramConversationTarget({
      loadedConfig: params.loadedConfig,
      agentId: route.agentId,
      accountId: params.accountId,
      chatId: params.message.chat.id,
      userId: params.message.from?.id,
      conversationKind: routeInfo.conversationKind,
      topicId,
    }),
  };
}
