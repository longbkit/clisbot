import { AgentService } from "../../agents/agent-service.ts";
import {
  isImplicitFollowUpAllowed,
  resolveFollowUpMode,
} from "../../agents/follow-up-policy.ts";
import { prependAttachmentMentions } from "../../agents/attachments/prompt.ts";
import { parseAgentCommand } from "../../agents/commands.ts";
import { processChannelInteraction } from "../interaction-processing.ts";
import { getAgentEntry, type LoadedConfig } from "../../config/load-config.ts";
import {
  isSlackSenderAllowed,
  isSlackSenderBlocked,
} from "../pairing/access.ts";
import { buildPairingReplyFromRequest } from "../pairing/messages.ts";
import {
  upsertChannelPairingRequest,
} from "../pairing/store.ts";
import { ProcessedEventsStore } from "../processed-events-store.ts";
import { ActivityStore } from "../../control/activity-store.ts";
import { renderChannelInteraction } from "../../shared/transcript.ts";
import { buildAgentPromptText } from "../agent-prompt.ts";
import {
  buildSurfacePromptContextWithDirectory,
  recordSurfaceDirectoryIdentity,
} from "../surface-directory.ts";
import { buildMentionOnlyFollowUpPrompt } from "../mention-follow-up.ts";
import { prependRecentConversationContext } from "../../shared/recent-message-context.ts";
import { DEFAULT_PROTECTED_CONTROL_RULE } from "../../auth/defaults.ts";
import { resolveChannelAuth } from "../../auth/resolve.ts";
import {
  claimFirstOwnerFromDirectMessage,
  renderFirstOwnerClaimMessage,
} from "../../auth/owner-claim.ts";
import {
  type SlackConversationKind,
  resolveSlackConversationTarget,
} from "./session-routing.ts";
import {
  resolveSlackConversationRoute,
  type SlackRoute,
} from "./route-config.ts";
import {
  clearSlackAssistantThreadStatus,
  setSlackAssistantThreadStatus,
} from "./assistant-status.ts";
import { ConversationProcessingIndicatorCoordinator } from "../processing-indicator.ts";
import { activateSlackProcessingDecoration } from "./processing-decoration.ts";
import { App } from "./bolt-compat.ts";
import {
  canUseImplicitSlackFollowUp,
  getSlackEventSkipReason,
  hasForeignSlackUserMention,
  hasBotMention,
  isBotOriginatedSlackEvent,
  isImplicitBotThreadReply,
  normalizeSlackMessageEvent,
  resolveSlackDirectReplyThreadTs,
  stripBotMention,
} from "./message.ts";
import {
  addConfiguredReaction,
  removeConfiguredReaction,
} from "./reactions.ts";
import {
  isSlackCommandLikeMessage,
  renderSlackMentionRequiredMessage,
  renderSlackRouteChoiceMessage,
  shouldSendSlackMentionRequiredGuidance,
  shouldGuideUnroutedSlackEvent,
  sendSlackGuidanceOnce,
} from "./feedback.ts";
import { resolveSlackAttachmentPaths } from "./attachments.ts";
import {
  getSlackMaxChars as getTransportSlackMaxChars,
  postSlackText,
  reconcileSlackText,
  type SlackPostedMessageChunk,
} from "./transport.ts";
import type { SlackBotCredentialConfig } from "../../config/channel-bots.ts";
import {
  resolveSlackBotConfig,
  resolveSlackDirectMessageAdmissionConfig,
} from "../../config/channel-bots.ts";
import { logLatencyDebug } from "../../control/latency-debug.ts";
import { buildTokenHint } from "../runtime-identity.ts";
import { renderGroupRouteAccessDeniedMessage } from "../route-policy.ts";

type SlackAppType = InstanceType<typeof App>;
type SlackThreadTsCacheEntry = {
  threadTs: string | null;
  updatedAt: number;
};

type SlackDisplayIdentity = {
  senderName?: string;
  senderHandle?: string;
  channelName?: string;
};

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function resolveSlackSenderDisplay(
  client: unknown,
  userId?: string,
): Promise<Pick<SlackDisplayIdentity, "senderName" | "senderHandle">> {
  const users = (
    client as { users?: { info?: (params: { user: string }) => Promise<unknown> } }
  )?.users;
  if (!userId || typeof users?.info !== "function") {
    return {};
  }
  try {
    const result = await users.info({ user: userId });
    const user = (result as { user?: Record<string, unknown> })?.user;
    const profile = user?.profile as Record<string, unknown> | undefined;
    const senderName =
      stringValue(profile?.real_name) ??
      stringValue(profile?.display_name) ??
      stringValue(user?.real_name) ??
      stringValue(user?.name);
    return {
      senderName,
      senderHandle: stringValue(user?.name),
    };
  } catch {
    return {};
  }
}

async function resolveSlackChannelDisplay(
  client: unknown,
  channelId?: string,
): Promise<Pick<SlackDisplayIdentity, "channelName">> {
  const conversations = (
    client as { conversations?: { info?: (params: { channel: string }) => Promise<unknown> } }
  )?.conversations;
  if (!channelId || typeof conversations?.info !== "function") {
    return {};
  }
  try {
    const result = await conversations.info({ channel: channelId });
    const channel = (result as { channel?: Record<string, unknown> })?.channel;
    return { channelName: stringValue(channel?.name) };
  } catch {
    return {};
  }
}

async function resolveSlackDisplayIdentity(params: {
  client: unknown;
  userId?: string;
  channelId?: string;
}): Promise<SlackDisplayIdentity> {
  const [sender, channel] = await Promise.all([
    resolveSlackSenderDisplay(params.client, params.userId),
    resolveSlackChannelDisplay(params.client, params.channelId),
  ]);
  return { ...sender, ...channel };
}

function mergeSlackDisplayIdentity(
  current: SlackDisplayIdentity,
  next: SlackDisplayIdentity,
): SlackDisplayIdentity {
  return {
    senderName: current.senderName ?? next.senderName,
    senderHandle: current.senderHandle ?? next.senderHandle,
    channelName: current.channelName ?? next.channelName,
  };
}

const SEEN_MESSAGE_TTL_MS = 60_000;
const THREAD_TS_CACHE_TTL_MS = 60_000;

function debugSlackEvent(message: string, details: Record<string, unknown> = {}) {
  if (process.env.CLISBOT_DEBUG_SLACK_EVENTS !== "1") {
    return;
  }

  console.log(`slack debug ${message} ${JSON.stringify(details)}`);
}

function waitForBackgroundSlackTask(task: Promise<unknown>) {
  return task.catch((error) => {
    console.error("slack background task failed", error);
  });
}

export class SlackSocketService {
  private readonly app: SlackAppType;
  private readonly processingIndicators = new ConversationProcessingIndicatorCoordinator();
  private botUserId = "";
  private botLabel = "";
  private teamId = "";
  private apiAppId = "";
  private startPromise?: Promise<unknown>;
  private readonly seenMessages = new Map<string, number>();
  private readonly threadTsCache = new Map<string, SlackThreadTsCacheEntry>();

  constructor(
    private readonly loadedConfig: LoadedConfig,
    private readonly agentService: AgentService,
    private readonly processedEventsStore: ProcessedEventsStore,
    private readonly activityStore: ActivityStore,
    private readonly botId = "default",
    private readonly botCredentials: SlackBotCredentialConfig,
  ) {
    this.app = new App({
      token: this.botCredentials.botToken,
      appToken: this.botCredentials.appToken,
      socketMode: true,
    });

    this.agentService.registerSurfaceNotificationHandler({
      platform: "slack",
      botId: this.botId,
      handler: async ({ binding, text }) => {
        if (!binding.channelId) {
          return;
        }
        await postSlackText(this.app.client as any, {
          channel: binding.channelId,
          threadTs: binding.threadTs,
          text,
        });
      },
    });
    this.registerEvents();
  }

  private getBotConfig() {
    return resolveSlackBotConfig(this.loadedConfig.raw.bots.slack, this.botId);
  }

  private getDirectMessageConfig(userId?: string) {
    return resolveSlackDirectMessageAdmissionConfig(this.getBotConfig());
  }

  private getSlackMaxChars(agentId: string) {
    return getTransportSlackMaxChars(
      this.agentService.getMaxMessageChars(agentId),
    );
  }

  private markMessageSeen(channelId: string | undefined, ts?: string) {
    if (!channelId || !ts) {
      return false;
    }

    const now = Date.now();
    for (const [key, updatedAt] of this.seenMessages.entries()) {
      if (now - updatedAt > SEEN_MESSAGE_TTL_MS) {
        this.seenMessages.delete(key);
      }
    }

    const cacheKey = `${channelId}:${ts}`;
    if (this.seenMessages.has(cacheKey)) {
      return true;
    }

    this.seenMessages.set(cacheKey, now);
    return false;
  }

  private shouldDropMismatchedSlackEvent(body: unknown) {
    if (!body || typeof body !== "object") {
      return false;
    }

    const raw = body as { api_app_id?: unknown; team_id?: unknown };
    const incomingApiAppId =
      typeof raw.api_app_id === "string" ? raw.api_app_id : "";
    const incomingTeamId = typeof raw.team_id === "string" ? raw.team_id : "";

    if (
      this.apiAppId &&
      incomingApiAppId &&
      incomingApiAppId !== this.apiAppId
    ) {
      console.log("slack skipped due to api_app_id mismatch", incomingApiAppId);
      return true;
    }

    if (this.teamId && incomingTeamId && incomingTeamId !== this.teamId) {
      console.log("slack skipped due to team_id mismatch", incomingTeamId);
      return true;
    }

    return false;
  }

  private async resolveThreadTs(event: any) {
    const threadTs =
      typeof event.thread_ts === "string" ? event.thread_ts : undefined;
    if (threadTs) {
      return threadTs;
    }

    const messageTs = typeof event.ts === "string" ? event.ts : undefined;
    if (!messageTs) {
      return "";
    }

    if (!event.parent_user_id) {
      return messageTs;
    }

    const channelId = event.channel as string;
    const cacheKey = `${channelId}:${messageTs}`;
    const cached = this.threadTsCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.updatedAt <= THREAD_TS_CACHE_TTL_MS) {
      return cached.threadTs ?? messageTs;
    }

    try {
      const response = (await this.app.client.conversations.history({
        channel: channelId,
        latest: messageTs,
        oldest: messageTs,
        inclusive: true,
        limit: 1,
      })) as { messages?: Array<{ ts?: string; thread_ts?: string }> };
      const matchedMessage =
        response.messages?.find((entry) => entry.ts === messageTs) ??
        response.messages?.[0];
      const resolvedThreadTs = matchedMessage?.thread_ts ?? null;
      this.threadTsCache.set(cacheKey, {
        threadTs: resolvedThreadTs,
        updatedAt: now,
      });
      return resolvedThreadTs ?? messageTs;
    } catch (error) {
      console.error("slack thread_ts resolution failed", error);
      return messageTs;
    }
  }

  private async handleInboundMessage(params: {
    body: any;
    event: any;
    conversationKind: SlackConversationKind;
    route: SlackRoute;
    wasMentioned: boolean;
  }) {
    const eventId = params.body.event_id as string | undefined;
    const event = normalizeSlackMessageEvent(params.event);
    if (!eventId) {
      debugSlackEvent("missing-event-id", {
        channel: event.channel,
        type: event.type,
      });
      console.log("slack missing event id");
      return;
    }

    if (this.shouldDropMismatchedSlackEvent(params.body)) {
      debugSlackEvent("drop-mismatched-event", { eventId });
      return;
    }

    const existingStatus = await this.processedEventsStore.getStatus(eventId);
    if (existingStatus === "processing" || existingStatus === "completed") {
      debugSlackEvent("drop-duplicate-event", { eventId, existingStatus });
      return;
    }

    const skipReason = getSlackEventSkipReason(event);
    if (skipReason) {
      debugSlackEvent("drop-skip-reason", { eventId, skipReason });
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }

    const channelId = event.channel as string;
    const messageTs =
      (event.ts as string | undefined) ??
      (event.event_ts as string | undefined);
    if (this.markMessageSeen(channelId, messageTs)) {
      debugSlackEvent("drop-seen-message", { eventId, channelId, messageTs });
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }

    if (event.user && this.botUserId && event.user === this.botUserId) {
      debugSlackEvent("drop-self-message", { eventId, user: event.user });
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }

    if (isBotOriginatedSlackEvent(event) && !params.route.allowBots) {
      debugSlackEvent("drop-bot-message", { eventId, allowBots: params.route.allowBots });
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }

    if (params.conversationKind !== "dm") {
      const senderId =
        typeof event.user === "string" ? event.user.trim().toUpperCase() : "";
      const sharedAuth =
        senderId && params.route.agentId
          ? resolveChannelAuth({
            config: this.loadedConfig.raw,
            agentId: params.route.agentId,
            identity: {
              platform: "slack",
              botId: this.botId,
              conversationKind: params.conversationKind,
              senderId,
              channelId,
            },
          })
          : undefined;
      if (
        senderId &&
        isSlackSenderBlocked({
          blockFrom: params.route.blockUsers ?? [],
          userId: senderId,
        })
      ) {
        debugSlackEvent("drop-shared-blocked", { eventId, senderId });
        await this.processedEventsStore.markCompleted(eventId);
        return;
      }
      if (
        !sharedAuth?.mayBypassSharedSenderPolicy &&
        senderId &&
        (
          params.route.policy === "allowlist" ||
          (params.route.allowUsers?.length ?? 0) > 0
        ) &&
        !isSlackSenderAllowed({
          allowFrom: params.route.allowUsers ?? [],
          userId: senderId,
        })
      ) {
        try {
          await postSlackText(this.app.client, {
            channel: channelId,
            threadTs: await this.resolveThreadTs(event),
            text: renderGroupRouteAccessDeniedMessage(),
          });
        } catch (error) {
          console.error("slack shared allowlist deny reply failed", error);
        }
        debugSlackEvent("drop-shared-not-allowed", { eventId, senderId });
        await this.processedEventsStore.markCompleted(eventId);
        return;
      }
    }

    if (params.conversationKind === "dm") {
      const directUserId =
        typeof event.user === "string" ? event.user.trim() : "";
      const dmConfig = this.getDirectMessageConfig(directUserId);
      const dmIdentity = {
        platform: "slack" as const,
        conversationKind: params.conversationKind,
        senderId: directUserId || undefined,
        channelId,
      };
      if (!directUserId || dmConfig.policy === "disabled") {
        debugSlackEvent("drop-dm-disabled", { eventId, directUserId });
        await this.processedEventsStore.markCompleted(eventId);
        return;
      }
      const directReplyThreadTs = resolveSlackDirectReplyThreadTs({
        messageTs,
        resolvedThreadTs: await this.resolveThreadTs(event),
      });

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
        console.error("slack first-owner claim failed", error);
      }

      if (ownerClaimed && ownerPrincipal) {
        try {
          await postSlackText(this.app.client, {
            channel: channelId,
            threadTs: directReplyThreadTs,
            text: renderFirstOwnerClaimMessage({
              principal: ownerPrincipal,
              ownerClaimWindowMinutes: this.loadedConfig.raw.app.auth.ownerClaimWindowMinutes,
            }),
          });
        } catch (error) {
          console.error("slack first-owner claim reply failed", error);
        }
      }

      const auth = resolveChannelAuth({
        config: this.loadedConfig.raw,
        agentId: params.route.agentId,
        identity: dmIdentity,
      });

      if (isSlackSenderBlocked({
        blockFrom: dmConfig.blockUsers ?? [],
        userId: directUserId,
      })) {
        debugSlackEvent("drop-dm-blocked", { eventId, directUserId });
        await this.processedEventsStore.markCompleted(eventId);
        return;
      }

      if (dmConfig.policy !== "open" && !auth.mayBypassPairing) {
        const allowed = isSlackSenderAllowed({
          allowFrom: dmConfig.allowUsers ?? [],
          userId: directUserId,
        });
        if (!allowed) {
          if (dmConfig.policy === "pairing") {
            const pairingRequest = await upsertChannelPairingRequest({
              channel: "slack",
              id: directUserId,
              botId: this.botId,
            });
            const pairingReply = buildPairingReplyFromRequest({
              channel: "slack",
              idLine: `Your Slack user id: ${directUserId}`,
              botId: this.botId,
              pairingRequest,
            });
            if (pairingReply) {
              try {
                await postSlackText(this.app.client, {
                  channel: channelId,
                  threadTs: directReplyThreadTs,
                  text: pairingReply,
                });
              } catch (error) {
                console.error("slack pairing reply failed", error);
              }
            }
          }
          debugSlackEvent("drop-dm-not-allowed", { eventId, directUserId, policy: dmConfig.policy });
          await this.processedEventsStore.markCompleted(eventId);
          return;
        }
      }
    }

    const requiresMention = params.route.requireMention;
    const threadTs = await this.resolveThreadTs(event);
    const sessionTarget = resolveSlackConversationTarget({
      loadedConfig: this.loadedConfig,
      agentId: params.route.agentId,
      botId: this.botId,
      channelId,
      userId: typeof event.user === "string" ? event.user : undefined,
      messageTs,
      threadTs,
      conversationKind: params.conversationKind,
      replyToMode: params.route.replyToMode,
    });
    if (hasForeignSlackUserMention(event.text ?? "", this.botUserId)) {
      debugSlackEvent("drop-foreign-mention", {
        eventId,
        channelId,
      });
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }
    const explicitMention =
      params.wasMentioned || hasBotMention(event.text ?? "", this.botUserId);
    const followUpState =
      await this.agentService.getConversationFollowUpState(sessionTarget);
    const effectiveFollowUpMode = resolveFollowUpMode({
      defaultMode: params.route.followUp.mode,
      overrideMode: followUpState.overrideMode,
    });
    const wasMentioned =
      explicitMention ||
      (canUseImplicitSlackFollowUp({
          conversationKind: params.conversationKind,
          event,
        }) &&
        isImplicitFollowUpAllowed({
          mode: effectiveFollowUpMode,
          participationTtlMs: params.route.followUp.participationTtlMs,
          lastBotReplyAt: followUpState.lastBotReplyAt,
          directReplyToBot: isImplicitBotThreadReply(event, this.botUserId),
        }));
    const rawText = explicitMention
      ? stripBotMention(event.text ?? "", this.botUserId)
      : `${event.text ?? ""}`.trim();
    const recentMessageMarker = messageTs?.trim();
    const slackSenderId =
      typeof event.user === "string" ? event.user.trim().toUpperCase() : undefined;
    let displayIdentity: SlackDisplayIdentity = {};
    if (recentMessageMarker && (rawText || explicitMention)) {
      displayIdentity = await resolveSlackDisplayIdentity({
        client: this.app.client,
        userId: slackSenderId,
        channelId,
      });
      await this.agentService.appendRecentConversationMessage(sessionTarget, {
        marker: recentMessageMarker,
        text: parseAgentCommand(rawText, {
          commandPrefixes: params.route.commandPrefixes,
        })
          ? ""
          : rawText,
        senderId: slackSenderId,
        senderName: displayIdentity.senderName,
        senderHandle: displayIdentity.senderHandle,
        platform: "slack",
      });
    }
    if (requiresMention && !wasMentioned) {
      const isCommandLike = isSlackCommandLikeMessage({
        text: event.text ?? "",
        botUserId: this.botUserId,
        botUsername: this.botLabel,
        commandPrefixes: params.route.commandPrefixes,
      });
      if (
        shouldSendSlackMentionRequiredGuidance({
          conversationKind: params.conversationKind,
          isCommandLike,
        })
      ) {
        try {
          await postSlackText(this.app.client, {
            channel: channelId,
            threadTs,
            text: renderSlackMentionRequiredMessage(this.botLabel),
          });
        } catch (error) {
          console.error("slack mention guidance failed", error);
        }
      }
      debugSlackEvent("drop-require-mention", {
        eventId,
        channelId,
        requiresMention,
        explicitMention,
        isCommandLike,
        effectiveFollowUpMode,
      });
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }

    if (explicitMention && followUpState.overrideMode === "paused") {
      await this.agentService.reactivateConversationFollowUp(sessionTarget);
    }
    const effectivePromptText =
      rawText ||
      (explicitMention
        ? buildMentionOnlyFollowUpPrompt({
            conversationKind: params.conversationKind,
            threaded: Boolean(threadTs),
          })
        : "");
    const attachmentPaths = await resolveSlackAttachmentPaths({
      client: this.app.client as any,
      event,
      channelId,
      messageTs,
      threadTs,
      botToken: this.botCredentials.botToken,
      workspacePath: this.agentService.getWorkspacePath(sessionTarget),
      sessionKey: sessionTarget.sessionKey,
      messageId: messageTs ?? threadTs ?? `${Date.now()}`,
    });
    const text = prependAttachmentMentions(effectivePromptText, attachmentPaths);
    if (!text) {
      debugSlackEvent("drop-empty-text", { eventId, channelId });
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }
    const recentConversationReplay = recentMessageMarker
      ? await this.agentService.getRecentConversationReplayMessages(sessionTarget, {
          excludeMarker: recentMessageMarker,
        })
      : [];
    const enrichPromptText = (nextText: string) =>
      prependRecentConversationContext({
        currentText: nextText,
        recentMessages: recentConversationReplay,
      });

    debugSlackEvent("process-message", {
      eventId,
      channelId,
      threadTs,
      sessionKey: sessionTarget.sessionKey,
      conversationKind: params.conversationKind,
    });
    await this.processedEventsStore.markProcessing(eventId);
    await this.activityStore.record({
      agentId: params.route.agentId,
      channel: "slack",
      surface:
        params.conversationKind === "dm"
          ? "dm"
          : params.conversationKind === "group"
            ? `group:${channelId}`
            : `channel:${channelId}`,
    });
    const reactionTarget = {
      channel: channelId,
      timestamp: messageTs,
    };
    let responseChunks: SlackPostedMessageChunk[] = [];
    const cliTool =
      getAgentEntry(this.loadedConfig, params.route.agentId)?.cli ??
      this.loadedConfig.raw.agents.defaults.cli;
    if (
      !displayIdentity.senderName ||
      !displayIdentity.senderHandle ||
      !displayIdentity.channelName
    ) {
      displayIdentity = mergeSlackDisplayIdentity(
        displayIdentity,
        await resolveSlackDisplayIdentity({
          client: this.app.client,
          userId: slackSenderId,
          channelId,
        }),
      );
    }
    const identity = {
      platform: "slack" as const,
      botId: this.botId,
      conversationKind: params.conversationKind,
      senderId: slackSenderId,
      senderName: displayIdentity.senderName,
      senderHandle: displayIdentity.senderHandle,
      channelId,
      channelName: displayIdentity.channelName,
      threadTs,
    };
    void recordSurfaceDirectoryIdentity({
      stateDir: this.loadedConfig.stateDir,
      identity,
    }).catch(() => undefined);
    const promptTime =
      messageTs && Number.isFinite(Number(messageTs))
        ? Number(messageTs) * 1000
        : Date.now();
    const promptContext = await buildSurfacePromptContextWithDirectory({
      stateDir: this.loadedConfig.stateDir,
      identity,
      agentId: params.route.agentId,
      time: promptTime,
    });
    const auth = resolveChannelAuth({
      config: this.loadedConfig.raw,
      agentId: params.route.agentId,
      identity,
    });
    const protectedControlMutationRule = auth.mayManageProtectedResources
      ? undefined
      : DEFAULT_PROTECTED_CONTROL_RULE;
    const agentPromptText = buildAgentPromptText({
      text: enrichPromptText(text),
      identity,
      config: this.getBotConfig().agentPrompt,
      cliTool,
      responseMode: params.route.responseMode,
      streaming: params.route.streaming,
      protectedControlMutationRule,
      agentId: params.route.agentId,
      time: promptTime,
      promptContext,
    });
    const timingContext = {
      platform: "slack" as const,
      eventId,
      agentId: params.route.agentId,
      channelId,
      threadId: threadTs,
      sessionKey: sessionTarget.sessionKey,
    };
    logLatencyDebug("slack-event-accepted", timingContext, {
      conversationKind: params.conversationKind,
      responseMode: params.route.responseMode,
      botId: this.botId,
    });
    const ackReactionTask = waitForBackgroundSlackTask(
      addConfiguredReaction(
        this.app.client,
        this.getBotConfig().ackReaction,
        reactionTarget,
      ),
    );
    const processingLease = await this.processingIndicators.acquire({
      key: `slack:${this.botId}:${channelId}:${threadTs}`,
      activate: async () =>
        activateSlackProcessingDecoration({
          addReaction: () =>
            addConfiguredReaction(
              this.app.client,
              this.getBotConfig().typingReaction,
              reactionTarget,
            ),
          removeReaction: () =>
            removeConfiguredReaction(
              this.app.client,
              this.getBotConfig().typingReaction,
              reactionTarget,
            ),
          setStatus: () =>
            setSlackAssistantThreadStatus(
              this.app.client,
              this.getBotConfig().processingStatus,
              {
                channel: channelId,
                threadTs,
              },
            ),
          clearStatus: () =>
            clearSlackAssistantThreadStatus(this.app.client, {
              channel: channelId,
              threadTs,
            }),
          onUnexpectedError: (phase, error) => {
            console.error(`slack processing indicator ${phase} failed`, error);
          },
        }),
      onError: (phase, error) => {
        console.error(`slack processing indicator ${phase} failed`, error);
      },
    });
    try {
      const interaction = await processChannelInteraction({
        agentService: this.agentService,
        sessionTarget,
        identity,
        auth,
        senderId: slackSenderId,
        text,
        agentPromptText,
        agentPromptBuilder: (nextText) =>
          buildAgentPromptText({
            text: enrichPromptText(nextText),
            identity,
            config: this.getBotConfig().agentPrompt,
            cliTool,
            responseMode: params.route.responseMode,
            streaming: params.route.streaming,
            protectedControlMutationRule,
            agentId: params.route.agentId,
            time: Date.now(),
            promptContext: {
              ...promptContext,
              time: new Date().toISOString(),
            },
            timezone: this.agentService.resolveEffectiveTimezone({
              agentId: params.route.agentId,
              routeTimezone: params.route.timezone,
              botTimezone: params.route.botTimezone,
            }).timezone,
          }),
        promptContext,
        protectedControlMutationRule,
        transformSessionInputText: enrichPromptText,
        onPromptAccepted: recentMessageMarker
          ? async () => {
            await this.agentService.markRecentConversationProcessed(
              sessionTarget,
              recentMessageMarker,
            );
          }
          : undefined,
        route: params.route,
        maxChars: this.getSlackMaxChars(params.route.agentId),
        timingContext,
        postText: async (nextText) => {
          responseChunks = await postSlackText(this.app.client, {
            channel: channelId,
            threadTs,
            text: nextText,
          });
          return responseChunks;
        },
        reconcileText: async (chunks, nextText) => {
          responseChunks = await reconcileSlackText(this.app.client, {
            channel: channelId,
            threadTs,
            chunks,
            text: nextText,
          });
          return responseChunks;
        },
      });
      await processingLease.setLifecycle({
        agentService: this.agentService,
        sessionTarget,
        observerId: `slack-processing:${channelId}:${threadTs}`,
        lifecycle: interaction.processingIndicatorLifecycle,
      });
      await this.processedEventsStore.markCompleted(eventId);
    } catch (error) {
      console.error("slack handler error", error);
      await this.processedEventsStore.clear(eventId);
      return;
    } finally {
      await ackReactionTask;
      await processingLease.release();
    }
  }

  private async maybeGuideUnroutedSlackEvent(params: {
    eventId?: string;
    channelId: string;
    threadTs?: string;
  }) {
    return sendSlackGuidanceOnce({
      eventId: params.eventId,
      processedEventsStore: this.processedEventsStore,
      send: async () => {
        await postSlackText(this.app.client, {
          channel: params.channelId,
          threadTs: params.threadTs,
          text: renderSlackRouteChoiceMessage({
            channelId: params.channelId,
            botLabel: this.botLabel,
          }),
        });
      },
    });
  }

  private registerEvents() {
    this.app.event("app_mention", async ({ body, event }) => {
      const normalizedEvent = normalizeSlackMessageEvent(event as any);
      debugSlackEvent("received-app-mention", {
        eventId: body.event_id,
        channel: normalizedEvent.channel,
        text: normalizedEvent.text,
      });
      const resolvedRoute = resolveSlackConversationRoute(
        this.loadedConfig,
        normalizedEvent,
        { botId: this.botId },
      );
      const route = resolvedRoute.route;
      if (!route) {
        if (resolvedRoute.status === "disabled") {
          debugSlackEvent("drop-disabled-route", {
            eventId: body.event_id,
            channel: normalizedEvent.channel,
            type: "app_mention",
          });
          return;
        }
        if (
          isBotOriginatedSlackEvent(normalizedEvent) &&
          !this.getBotConfig().allowBots
        ) {
          debugSlackEvent("drop-unrouted-bot-mention", {
            eventId: body.event_id,
            allowBots: this.getBotConfig().allowBots,
          });
          return;
        }
        try {
          await this.maybeGuideUnroutedSlackEvent({
            eventId: body.event_id,
            channelId: normalizedEvent.channel as string,
            threadTs:
              typeof normalizedEvent.thread_ts === "string"
                ? normalizedEvent.thread_ts
                : typeof normalizedEvent.ts === "string"
                  ? normalizedEvent.ts
                  : undefined,
          });
        } catch (error) {
          console.error("slack unrouted guidance failed", error);
        }
        debugSlackEvent("drop-no-route", {
          eventId: body.event_id,
          channel: normalizedEvent.channel,
          type: "app_mention",
        });
        return;
      }

      await this.handleInboundMessage({
        body,
        event: normalizedEvent,
        conversationKind: resolvedRoute.conversationKind,
        route,
        wasMentioned: true,
      });
    });

    this.app.event("message", async ({ body, event }) => {
      const normalizedEvent = normalizeSlackMessageEvent(event as any);
      debugSlackEvent("received-message", {
        eventId: body.event_id,
        channel: normalizedEvent.channel,
        subtype: normalizedEvent.subtype,
        text: normalizedEvent.text,
      });
      const resolvedRoute = resolveSlackConversationRoute(
        this.loadedConfig,
        normalizedEvent,
        { botId: this.botId },
      );
      const route = resolvedRoute.route;

      if (!route) {
        if (resolvedRoute.status === "disabled") {
          debugSlackEvent("drop-disabled-route", {
            eventId: body.event_id,
            channel: normalizedEvent.channel,
            type: "message",
          });
          return;
        }
        const shouldGuide = shouldGuideUnroutedSlackEvent({
          conversationKind: resolvedRoute.conversationKind,
          isCommandLike: isSlackCommandLikeMessage({
            text: normalizedEvent.text ?? "",
            botUserId: this.botUserId,
            botUsername: this.botLabel,
            commandPrefixes: this.getBotConfig().commandPrefixes,
          }),
          wasMentioned: hasBotMention(normalizedEvent.text ?? "", this.botUserId),
          isBotOriginated:
            isBotOriginatedSlackEvent(normalizedEvent) &&
            !this.getBotConfig().allowBots,
        });
        if (shouldGuide) {
          try {
            await this.maybeGuideUnroutedSlackEvent({
              eventId: body.event_id,
              channelId: normalizedEvent.channel as string,
              threadTs:
                typeof normalizedEvent.thread_ts === "string"
                  ? normalizedEvent.thread_ts
                  : typeof normalizedEvent.ts === "string"
                    ? normalizedEvent.ts
                    : undefined,
            });
          } catch (error) {
            console.error("slack unrouted guidance failed", error);
          }
        }
        debugSlackEvent("drop-no-route", {
          eventId: body.event_id,
          channel: normalizedEvent.channel,
          type: "message",
        });
        return;
      }

      await this.handleInboundMessage({
        body,
        event: normalizedEvent,
        conversationKind: resolvedRoute.conversationKind,
        route,
        wasMentioned: false,
      });
    });
  }

  async start() {
    const auth = await this.app.client.auth.test({
      token: this.botCredentials.botToken,
    });
    this.botUserId = auth.user_id ?? "";
    this.botLabel = (auth as { user?: string }).user?.trim() ?? "";
    this.teamId = auth.team_id ?? "";
    this.apiAppId = (auth as { api_app_id?: string }).api_app_id ?? "";
    console.log(`slack bot user ${this.botLabel || this.botUserId} (${this.botId})`);
    this.app.error(async (error) => {
      console.error("slack app error", error);
    });
    this.startPromise = this.app.start().catch((error) => {
      console.error("slack socket start failed", error);
      throw error;
    });
    await this.startPromise;
  }

  async stop() {
    this.agentService.unregisterSurfaceNotificationHandler({
      platform: "slack",
      botId: this.botId,
    });
    await this.app.stop();
  }

  getBotUserLabel() {
    return this.botLabel || this.botUserId || "unknown";
  }

  getRuntimeIdentity() {
    return {
      botId: this.botId,
      label: this.botLabel ? `bot=${this.botLabel}` : `botUser=${this.botUserId || "unknown"}`,
      appLabel: this.apiAppId ? `app=${this.apiAppId}` : undefined,
      tokenHint: buildTokenHint(this.botCredentials.botToken),
    };
  }
}
