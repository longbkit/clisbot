import { AgentService } from "../../agents/agent-service.ts";
import {
  isImplicitFollowUpAllowed,
  resolveFollowUpMode,
} from "../../agents/follow-up-policy.ts";
import { parseAgentCommand } from "../../agents/commands.ts";
import { prependAttachmentMentions } from "../../agents/attachments/prompt.ts";
import { processChannelInteraction } from "../interaction-processing.ts";
import { type LoadedConfig } from "../../config/load-config.ts";
import { isTelegramSenderAllowed } from "../pairing/access.ts";
import { buildPairingReply } from "../pairing/messages.ts";
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
import { resolveTelegramAttachmentPaths } from "./attachments.ts";
import { sleep } from "../../shared/process.ts";

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
  { command: "followup", description: "Show or change follow-up mode" },
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
  const scopeLabel = params.topicId != null ? "topic" : "group";
  const lines = params.mode === "whoami"
    ? [
        "Who am I",
        "",
        "platform: `telegram`",
        `chatType: \`${params.chatType}\``,
        `chatId: \`${params.chatId}\``,
      ]
    : [
        `muxbot: this Telegram ${scopeLabel} is not configured yet.`,
        "",
        "Ask the bot owner to add this route with:",
      ];

  if (params.mode === "whoami" && params.topicId != null) {
    lines.push(`topicId: \`${params.topicId}\``);
  }

  if (params.mode === "whoami" && params.isForum) {
    lines.push("isForum: `true`");
  }

  if (params.mode === "whoami") {
    lines.push("routed: `no`");
    lines.push("");
    lines.push("Ask the bot owner to add this route with:");
  }

  lines.push(
    params.topicId != null
      ? `\`muxbot channels add telegram-group ${params.chatId} --topic ${params.topicId}\``
      : `\`muxbot channels add telegram-group ${params.chatId}\``,
  );

  if (params.mode === "start" || params.mode === "help" || params.mode === "status") {
    lines.push("");
    lines.push("After that, group commands such as `/transcript`, `/stop`, `/followup`, and `/bash` will work here.");
  } else {
    lines.push("");
    lines.push(
      params.topicId != null
        ? `Config path: \`channels.telegram.groups.\"${params.chatId}\".topics.\"${params.topicId}\"\``
        : `Config path: \`channels.telegram.groups.\"${params.chatId}\"\``,
    );
  }

  return lines.join("\n");
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

  constructor(
    private readonly loadedConfig: LoadedConfig,
    private readonly agentService: AgentService,
    private readonly processedEventsStore: ProcessedEventsStore,
    private readonly activityStore: ActivityStore,
  ) {}

  async start() {
    const telegramConfig = this.loadedConfig.raw.channels.telegram;
    const me = await callTelegramApi<TelegramGetMeResult>(
      telegramConfig.botToken,
      "getMe",
      {},
    );
    this.botUserId = me.id;
    this.botUsername = me.username ?? "";
    console.log(`telegram bot @${this.botUsername || this.botUserId}`);
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
  }

  getBotLabel() {
    return this.botUsername ? `@${this.botUsername}` : `${this.botUserId || "unknown"}`;
  }

  private async pollLoop() {
    const telegramConfig = this.loadedConfig.raw.channels.telegram;
    while (this.running) {
      try {
        const controller = new AbortController();
        this.activePollController = controller;
        const updates = await callTelegramApi<TelegramGetUpdatesResult>(
          telegramConfig.botToken,
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
            this.loadedConfig.raw.channels.telegram.botToken,
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
      if (!senderId || directMessages.policy === "disabled") {
        await this.processedEventsStore.markCompleted(eventId);
        return;
      }

      if (directMessages.policy !== "open") {
        const storedAllowFrom = await readChannelAllowFromStore("telegram");
        const allowed = isTelegramSenderAllowed({
          allowFrom: [...directMessages.allowFrom, ...storedAllowFrom],
          userId: senderId,
          username: senderUsername,
        });
        if (!allowed) {
          if (directMessages.policy === "pairing") {
            const { code, created } = await upsertChannelPairingRequest({
              channel: "telegram",
              id: senderId,
              meta: {
                username: senderUsername,
                firstName: message.from?.first_name,
                lastName: message.from?.last_name,
              },
            });
            if (created && code) {
              try {
                await callTelegramApi(
                  this.loadedConfig.raw.channels.telegram.botToken,
                  "sendMessage",
                  {
                    chat_id: message.chat.id,
                    text: buildPairingReply({
                      channel: "telegram",
                      idLine: `Your Telegram user id: ${senderId}`,
                      code,
                    }),
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
    if (routeInfo.route.requireMention && !wasMentioned) {
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }

    if (explicitMention && followUpState.overrideMode === "paused") {
      await this.agentService.reactivateConversationFollowUp(routeInfo.sessionTarget);
    }

    const textBody = explicitMention
      ? stripTelegramBotMention(rawText, this.botUsername)
      : rawText;
    const attachmentPaths = await resolveTelegramAttachmentPaths({
      message,
      botToken: this.loadedConfig.raw.channels.telegram.botToken,
      workspacePath: this.agentService.getWorkspacePath(routeInfo.sessionTarget),
      sessionKey: routeInfo.sessionTarget.sessionKey,
      messageId: String(message.message_id),
    });
    const text = prependAttachmentMentions(textBody, attachmentPaths);
    if (!text) {
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }

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
      await this.sendTyping(message.chat.id, routeInfo.topicId);
      let responseChunks: TelegramPostedMessageChunk[] = [];
      await processChannelInteraction({
        agentService: this.agentService,
        sessionTarget: routeInfo.sessionTarget,
        identity: {
          platform: "telegram",
          conversationKind: routeInfo.conversationKind,
          senderId:
            message.from?.id != null ? String(message.from.id).trim() : undefined,
          chatId: String(message.chat.id),
          topicId:
            routeInfo.topicId != null ? String(routeInfo.topicId) : undefined,
        },
        senderId:
          message.from?.id != null ? String(message.from.id).trim() : undefined,
        text,
        route: routeInfo.route,
        maxChars: this.getTelegramMaxChars(routeInfo.route.agentId),
        postText: async (nextText) => {
          responseChunks = await postTelegramText({
            token: this.loadedConfig.raw.channels.telegram.botToken,
            chatId: message.chat.id,
            text: nextText,
            topicId: routeInfo.topicId,
            omitThreadId: shouldOmitTelegramThreadId(routeInfo.topicId),
          });
          return responseChunks;
        },
        reconcileText: async (chunks, nextText) => {
          responseChunks = await reconcileTelegramText({
            token: this.loadedConfig.raw.channels.telegram.botToken,
            chatId: message.chat.id,
            chunks,
            text: nextText,
            topicId: routeInfo.topicId,
            omitThreadId: shouldOmitTelegramThreadId(routeInfo.topicId),
          });
          return responseChunks;
        },
      });
      await this.processedEventsStore.markCompleted(eventId);
    } catch (error) {
      console.error("telegram handler error", error);
      await this.processedEventsStore.clear(eventId);
    }
  }

  private async sendTyping(chatId: number, topicId?: number) {
    await callTelegramApi(
      this.loadedConfig.raw.channels.telegram.botToken,
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
    const token = this.loadedConfig.raw.channels.telegram.botToken;
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
          telegramConfig.botToken,
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
    accountId: "default",
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
      chatId: params.message.chat.id,
      userId: params.message.from?.id,
      conversationKind: routeInfo.conversationKind,
      topicId,
    }),
  };
}
