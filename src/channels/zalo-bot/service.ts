import { AgentService } from "../../agents/runtime/agent-service.ts";
import {
  isImplicitFollowUpAllowed,
  resolveFollowUpMode,
} from "../../agents/commands/follow-up-policy.ts";
import { hasAgentCommandPrefix } from "../../agents/commands/commands.ts";
import { processChannelInteraction } from "../message/interaction-processing.ts";
import { getAgentEntry, type LoadedConfig } from "../../config/core/load-config.ts";
import {
  isChannelSenderAllowed,
  isChannelSenderBlocked,
} from "../pairing/access.ts";
import { buildPairingReplyFromRequest } from "../pairing/messages.ts";
import { upsertChannelPairingRequest } from "../pairing/store.ts";
import { ProcessedEventsStore } from "../message/processed-events-store.ts";
import { ActivityStore } from "../../control/runtime/activity-store.ts";
import type { ZaloBotCredentialConfig } from "./config.ts";
import {
  resolveZaloBotConfig,
  resolveZaloBotDirectMessageConfig,
} from "./config.ts";
import { prependAttachmentMentions } from "../../agents/attachments/prompt.ts";
import { buildAgentPromptText } from "../message/agent-prompt.ts";
import {
  buildSurfacePromptContextWithDirectory,
  recordSurfaceDirectoryIdentity,
} from "../surface/surface-directory.ts";
import { prependRecentConversationContext } from "../../agents/routing/recent-message-context.ts";
import { DEFAULT_PROTECTED_CONTROL_RULE } from "../../auth/defaults.ts";
import { resolveChannelAuth } from "../../auth/resolve.ts";
import {
  claimFirstOwnerFromDirectMessage,
  renderFirstOwnerClaimMessage,
} from "../../auth/owner-claim.ts";
import { logLatencyDebug } from "../../control/runtime/latency-debug.ts";
import type { ChannelRuntimeLifecycleEvent } from "../integration/channel-plugin.ts";
import { ConversationProcessingIndicatorCoordinator } from "../message/processing-indicator.ts";
import { buildMentionOnlyFollowUpPrompt } from "../config/mention-follow-up.ts";
import {
  ZaloBotApiError,
  getZaloBotMe,
  getZaloBotUpdates,
  sendZaloBotChatAction,
  type ZaloBotMessage,
  type ZaloBotUpdate,
} from "./api.ts";
import {
  getZaloBotUpdateSkipReason,
  hasForeignZaloBotMention,
  hasZaloBotMention,
  isZaloBotOriginatedMessage,
  stripZaloBotMention,
} from "./message.ts";
import { resolveZaloBotConversationRoute } from "./route-config.ts";
import { resolveZaloBotConversationTarget } from "./session-routing.ts";
import {
  postZaloBotText,
  reconcileZaloBotText,
} from "./transport.ts";
import { beginZaloBotTypingHeartbeat } from "./typing.ts";
import { resolveZaloBotAttachmentPaths } from "./attachments.ts";

export class ZaloBotPollingService {
  private botUserId = "";
  private botName = "";
  private running = false;
  private loopPromise?: Promise<void>;
  private readonly processingIndicators = new ConversationProcessingIndicatorCoordinator();

  constructor(
    private readonly loadedConfig: LoadedConfig,
    private readonly agentService: AgentService,
    private readonly processedEventsStore: ProcessedEventsStore,
    private readonly activityStore: ActivityStore,
    private readonly botId: string,
    private readonly botCredentials: ZaloBotCredentialConfig,
    private readonly reportLifecycle: (event: ChannelRuntimeLifecycleEvent) => Promise<void>,
  ) {}

  private getBotConfig() {
    return resolveZaloBotConfig(this.loadedConfig.raw.bots.zaloBot, this.botId);
  }

  async start() {
    const me = await getZaloBotMe(this.botCredentials.botToken);
    this.botUserId = me.id;
    this.botName = me.name?.trim() ?? "";
    const mode = this.getBotConfig().mode;
    if (mode === "webhook") {
      throw new Error("Zalo Bot webhook mode is not implemented yet. Use mode=polling for now.");
    }
    this.running = true;
    this.loopPromise = this.pollLoop();
  }

  async stop() {
    this.running = false;
    await this.loopPromise;
  }

  getRuntimeIdentity() {
    return {
      botId: this.botId,
      label: this.botName || this.botUserId || this.botId,
      tokenHint: this.botCredentials.botToken.slice(0, 8),
    };
  }

  private async pollLoop() {
    while (this.running) {
      const config = this.getBotConfig();
      try {
        const update = await getZaloBotUpdates({
          token: this.botCredentials.botToken,
          timeoutSeconds: config.polling.timeoutSeconds,
        });
        await this.handleUpdate(update);
      } catch (error) {
        if (error instanceof ZaloBotApiError && error.isPollingTimeout) {
          continue;
        }
        console.error("zalo-bot polling error", error);
        await this.reportLifecycle({
          connection: "failed",
          summary: "Zalo Bot polling failed.",
          detail: error instanceof Error ? error.message : String(error),
        });
        await Bun.sleep(config.polling.retryDelayMs);
      }
    }
  }

  private async handleUpdate(update: ZaloBotUpdate) {
    const skipReason = getZaloBotUpdateSkipReason(update);
    if (skipReason) {
      return;
    }

    const message = update.message!;
    const eventId = `zalo-bot:${this.botId}:${message.message_id}`;
    const status = await this.processedEventsStore.getStatus(eventId);
    if (status === "processing" || status === "completed") {
      return;
    }

    await this.processedEventsStore.markProcessing(eventId);
    try {
      await this.handleInboundMessage(eventId, message);
      await this.processedEventsStore.markCompleted(eventId);
    } catch (error) {
      await this.processedEventsStore.clear(eventId);
      throw error;
    }
  }

  private async handleInboundMessage(eventId: string, message: ZaloBotMessage) {
    if (isZaloBotOriginatedMessage(message)) {
      return;
    }

    const rawText = [message.text, message.caption].filter(Boolean).join("\n").trim();
    const routeInfo = resolveZaloBotConversationRoute({
      loadedConfig: this.loadedConfig,
      chatType: message.chat.chat_type,
      chatId: message.chat.id,
      senderId: message.from.id,
      botId: this.botId,
    });
    const route = routeInfo.route;
    if (!route) {
      return;
    }

    const senderId = message.from.id.trim();
    const senderName = message.from.display_name?.trim() || message.from.name?.trim();
    if (isChannelSenderBlocked({
      channel: "zalo-bot",
      blockFrom: route.blockUsers ?? [],
      subject: {
        userId: senderId,
      },
    })) {
      return;
    }

    const sessionTarget = resolveZaloBotConversationTarget({
      loadedConfig: this.loadedConfig,
      agentId: route.agentId,
      botId: this.botId,
      chatId: message.chat.id,
      userId: senderId,
      conversationKind: routeInfo.conversationKind,
    });
    const attachmentPaths = await resolveZaloBotAttachmentPaths({
      message,
      workspacePath: this.agentService.getWorkspacePath(sessionTarget),
      sessionKey: sessionTarget.sessionKey,
      messageId: message.message_id,
    });
    if (!rawText && attachmentPaths.length === 0) {
      return;
    }

    const directMessages = resolveZaloBotDirectMessageConfig(this.getBotConfig(), senderId);
    if (!directMessages || directMessages.policy === "disabled") {
      return;
    }

    let ownerPrincipal: string | undefined;
    try {
      const claim = await claimFirstOwnerFromDirectMessage({
        config: this.loadedConfig.raw,
        configPath: this.loadedConfig.configPath,
        identity: {
          platform: "zalo-bot",
          botId: this.botId,
          conversationKind: "dm",
          senderId,
          senderName,
          chatId: message.chat.id,
        },
      });
      ownerPrincipal = claim.claimed ? claim.principal : undefined;
    } catch (error) {
      console.error("zalo-bot first-owner claim failed", error);
    }

    if (ownerPrincipal) {
      await postZaloBotText({
        token: this.botCredentials.botToken,
        chatId: message.chat.id,
        text: renderFirstOwnerClaimMessage({
          principal: ownerPrincipal,
          ownerClaimWindowMinutes: this.loadedConfig.raw.app.auth.ownerClaimWindowMinutes,
        }),
      });
    }

    const identity = {
      platform: "zalo-bot" as const,
      botId: this.botId,
      conversationKind: "dm" as const,
      senderId,
      senderName,
      chatId: message.chat.id,
    };
    const auth = resolveChannelAuth({
      config: this.loadedConfig.raw,
      agentId: route.agentId,
      identity,
    });
    if (directMessages.policy !== "open" && !auth.mayBypassPairing) {
      const allowed = isChannelSenderAllowed({
        channel: "zalo-bot",
        allowFrom: directMessages.allowUsers ?? [],
        subject: {
          userId: senderId,
        },
      });
      if (!allowed) {
        if (directMessages.policy === "pairing") {
          const pairingRequest = await upsertChannelPairingRequest({
            channel: "zalo-bot",
            id: senderId,
            botId: this.botId,
            meta: {
              firstName: senderName,
            },
          });
          const pairingReply = buildPairingReplyFromRequest({
            channel: "zalo-bot",
            idLine: `Your Zalo user id: ${senderId}`,
            botId: this.botId,
            pairingRequest,
          });
          if (pairingReply) {
            await postZaloBotText({
              token: this.botCredentials.botToken,
              chatId: message.chat.id,
              text: pairingReply,
            });
          }
        }
        return;
      }
    }

    if (hasForeignZaloBotMention(rawText, this.botName)) {
      return;
    }

    const explicitMention = hasZaloBotMention(rawText, this.botName);
    const followUpState = await this.agentService.getConversationFollowUpState(sessionTarget);
    const effectiveFollowUpMode = resolveFollowUpMode({
      defaultMode: route.followUp.mode,
      overrideMode: followUpState.overrideMode,
    });
    const bypassMention = hasAgentCommandPrefix(rawText, {
      commandPrefixes: route.commandPrefixes,
    });
    const wasMentioned =
      explicitMention ||
      bypassMention ||
      isImplicitFollowUpAllowed({
        mode: effectiveFollowUpMode,
        participationTtlMs: route.followUp.participationTtlMs,
        lastBotReplyAt: followUpState.lastBotReplyAt,
        now: Date.now(),
      });
    if (route.requireMention && !wasMentioned) {
      return;
    }

    const textBody = explicitMention ? stripZaloBotMention(rawText, this.botName) : rawText;
    const recentMessageMarker = message.message_id;
    if (rawText || attachmentPaths.length > 0 || explicitMention) {
      await this.agentService.appendRecentConversationMessage(sessionTarget, {
        marker: recentMessageMarker,
        text: textBody,
        senderId,
        senderName,
        platform: "zalo-bot",
      });
    }
    if (explicitMention && followUpState.overrideMode === "paused") {
      await this.agentService.reactivateConversationFollowUp(sessionTarget);
    }
    const effectivePromptText =
      textBody ||
      (explicitMention
        ? buildMentionOnlyFollowUpPrompt({
            conversationKind: routeInfo.conversationKind,
          })
        : "");
    const text = prependAttachmentMentions(effectivePromptText, attachmentPaths);
    if (!text) {
      return;
    }
    const recentConversationReplay = await this.agentService.getRecentConversationReplayMessages(
      sessionTarget,
      {
        excludeMarker: recentMessageMarker,
      },
    );
    const enrichPromptText = (input: string) => prependRecentConversationContext({
      currentText: input,
      recentMessages: recentConversationReplay,
    });
    await this.activityStore.record({
      agentId: route.agentId,
      channel: "zalo-bot",
      surface: "dm",
    });
    void recordSurfaceDirectoryIdentity({
      stateDir: this.loadedConfig.stateDir,
      identity,
    }).catch(() => undefined);
    const cliTool =
      getAgentEntry(this.loadedConfig, route.agentId)?.cli ??
      this.loadedConfig.raw.agents.defaults.cli;
    const protectedControlMutationRule = auth.mayManageProtectedResources
      ? undefined
      : DEFAULT_PROTECTED_CONTROL_RULE;
    const promptTime =
      Number.isFinite(message.date) ? message.date * 1000 : Date.now();
    const promptContext = await buildSurfacePromptContextWithDirectory({
      stateDir: this.loadedConfig.stateDir,
      identity,
      agentId: route.agentId,
      time: promptTime,
    });
    const agentPromptText = buildAgentPromptText({
      text: enrichPromptText(text),
      identity,
      config: this.getBotConfig().agentPrompt,
      cliTool,
      responseMode: route.responseMode,
      streaming: route.streaming,
      protectedControlMutationRule,
      agentId: route.agentId,
      time: promptTime,
      promptContext,
    });
    const timingContext = {
      platform: "zalo-bot" as const,
      eventId,
      agentId: route.agentId,
      chatId: message.chat.id,
      sessionKey: sessionTarget.sessionKey,
    };
    logLatencyDebug("zalo-bot-event-accepted", timingContext, {
      conversationKind: routeInfo.conversationKind,
      responseMode: route.responseMode,
      botId: this.botId,
    });

    const processingLease = await this.processingIndicators.acquire({
      key: `zalo-bot:${this.botId}:${message.chat.id}`,
      activate: async () =>
        beginZaloBotTypingHeartbeat({
          sendTyping: () => this.sendTyping(message.chat.id),
          onError: (error) => {
            console.error("zalo-bot typing failed", error);
          },
        }),
      onError: (_phase, error) => {
        console.error("zalo-bot processing indicator failed", error);
      },
    });
    try {
      const interaction = await processChannelInteraction({
        agentService: this.agentService,
        sessionTarget,
        identity,
        auth,
        senderId,
        text,
        agentPromptText,
        agentPromptBuilder: (nextText, options) =>
          buildAgentPromptText({
            text: enrichPromptText(nextText),
            identity,
            config: this.getBotConfig().agentPrompt,
            cliTool,
            responseMode: route.responseMode,
            streaming: route.streaming,
            protectedControlMutationRule,
            agentId: route.agentId,
            time: Date.now(),
            promptContext: {
              ...promptContext,
              time: new Date().toISOString(),
            },
            timezone: this.agentService.resolveEffectiveTimezone({
              agentId: route.agentId,
              routeTimezone: route.timezone,
              botTimezone: route.botTimezone,
            }).timezone,
            maxProgressMessagesOverride: options?.maxProgressMessagesOverride,
          }),
        promptContext,
        protectedControlMutationRule,
        transformSessionInputText: enrichPromptText,
        onPromptAccepted: async () => {
          await this.agentService.markRecentConversationProcessed(
            sessionTarget,
            recentMessageMarker,
          );
        },
        route,
        maxChars: 2000,
        timingContext,
        postText: async (nextText) => await postZaloBotText({
          token: this.botCredentials.botToken,
          chatId: message.chat.id,
          text: nextText,
        }),
        reconcileText: async (chunks, nextText) => await reconcileZaloBotText({
          token: this.botCredentials.botToken,
          chatId: message.chat.id,
          chunks: chunks as Awaited<ReturnType<typeof postZaloBotText>>,
          text: nextText,
        }),
      });
      await processingLease.setLifecycle({
        agentService: this.agentService,
        sessionTarget,
        observerId: `zalo-bot-processing:${message.chat.id}`,
        lifecycle: interaction.processingIndicatorLifecycle,
      });
    } finally {
      await processingLease.release();
    }
  }

  private async sendTyping(chatId: string) {
    await sendZaloBotChatAction({
      token: this.botCredentials.botToken,
      chatId,
      action: "typing",
    });
  }
}
