import { AgentService } from "../../agents/agent-service.ts";
import {
  isImplicitFollowUpAllowed,
  resolveFollowUpMode,
} from "../../agents/follow-up-policy.ts";
import { prependAttachmentMentions } from "../../agents/attachments/prompt.ts";
import { processChannelInteraction } from "../interaction-processing.ts";
import { getAgentEntry, type LoadedConfig } from "../../config/load-config.ts";
import { isSlackSenderAllowed } from "../pairing/access.ts";
import { buildPairingReply } from "../pairing/messages.ts";
import {
  readChannelAllowFromStore,
  upsertChannelPairingRequest,
} from "../pairing/store.ts";
import { ProcessedEventsStore } from "../processed-events-store.ts";
import { ActivityStore } from "../../control/activity-store.ts";
import { renderChannelInteraction } from "../../shared/transcript.ts";
import { buildAgentPromptText } from "../agent-prompt.ts";
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
  hasBotMention,
  isBotOriginatedSlackEvent,
  isImplicitBotThreadReply,
  normalizeSlackMessageEvent,
  stripBotMention,
} from "./message.ts";
import {
  addConfiguredReaction,
  removeConfiguredReaction,
} from "./reactions.ts";
import { resolveSlackAttachmentPaths } from "./attachments.ts";
import {
  getSlackMaxChars as getTransportSlackMaxChars,
  postSlackText,
  reconcileSlackText,
  type SlackPostedMessageChunk,
} from "./transport.ts";
import type { SlackAccountConfig } from "../../config/channel-accounts.ts";
import { logLatencyDebug } from "../../control/latency-debug.ts";
import { buildTokenHint } from "../runtime-identity.ts";

type SlackAppType = InstanceType<typeof App>;
type SlackThreadTsCacheEntry = {
  threadTs: string | null;
  updatedAt: number;
};

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
    private readonly accountId = "default",
    private readonly accountConfig: SlackAccountConfig,
  ) {
    this.app = new App({
      token: this.accountConfig.botToken,
      appToken: this.accountConfig.appToken,
      socketMode: true,
    });

    this.registerEvents();
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

    if (params.conversationKind === "dm") {
      const directUserId =
        typeof event.user === "string" ? event.user.trim() : "";
      const dmConfig = this.loadedConfig.raw.channels.slack.directMessages;
      if (!directUserId || dmConfig.policy === "disabled") {
        debugSlackEvent("drop-dm-disabled", { eventId, directUserId });
        await this.processedEventsStore.markCompleted(eventId);
        return;
      }

      if (dmConfig.policy !== "open") {
        const storedAllowFrom = await readChannelAllowFromStore("slack");
        const allowed = isSlackSenderAllowed({
          allowFrom: [...dmConfig.allowFrom, ...storedAllowFrom],
          userId: directUserId,
        });
        if (!allowed) {
          if (dmConfig.policy === "pairing") {
            const { code, created } = await upsertChannelPairingRequest({
              channel: "slack",
              id: directUserId,
            });
            if (created && code) {
              try {
                await postSlackText(this.app.client, {
                  channel: channelId,
                  text: buildPairingReply({
                    channel: "slack",
                    idLine: `Your Slack user id: ${directUserId}`,
                    code,
                  }),
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
      accountId: this.accountId,
      channelId,
      userId: typeof event.user === "string" ? event.user : undefined,
      messageTs,
      threadTs,
      conversationKind: params.conversationKind,
      replyToMode: params.route.replyToMode,
    });
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
    if (requiresMention && !wasMentioned) {
      debugSlackEvent("drop-require-mention", {
        eventId,
        channelId,
        requiresMention,
        explicitMention,
        effectiveFollowUpMode,
      });
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }

    if (explicitMention && followUpState.overrideMode === "paused") {
      await this.agentService.reactivateConversationFollowUp(sessionTarget);
    }

    const rawText = explicitMention
      ? stripBotMention(event.text ?? "", this.botUserId)
      : `${event.text ?? ""}`.trim();
    const attachmentPaths = await resolveSlackAttachmentPaths({
      client: this.app.client as any,
      event,
      channelId,
      messageTs,
      threadTs,
      botToken: this.accountConfig.botToken,
      workspacePath: this.agentService.getWorkspacePath(sessionTarget),
      sessionKey: sessionTarget.sessionKey,
      messageId: messageTs ?? threadTs ?? `${Date.now()}`,
    });
    const text = prependAttachmentMentions(rawText, attachmentPaths);
    if (!text) {
      debugSlackEvent("drop-empty-text", { eventId, channelId });
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }

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
    const cliTool = getAgentEntry(this.loadedConfig, params.route.agentId)?.cliTool;
    const agentPromptText = buildAgentPromptText({
      text,
      identity: {
        platform: "slack",
        conversationKind: params.conversationKind,
        senderId:
          typeof event.user === "string" ? event.user.trim().toUpperCase() : undefined,
        channelId,
        threadTs,
      },
      config: this.loadedConfig.raw.channels.slack.agentPrompt,
      cliTool,
      responseMode: params.route.responseMode,
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
      accountId: this.accountId,
    });
    const ackReactionTask = waitForBackgroundSlackTask(
      addConfiguredReaction(
        this.app.client,
        this.loadedConfig.raw.channels.slack.ackReaction,
        reactionTarget,
      ),
    );
    const processingLease = await this.processingIndicators.acquire({
      key: `slack:${this.accountId}:${channelId}:${threadTs}`,
      activate: async () =>
        activateSlackProcessingDecoration({
          addReaction: () =>
            addConfiguredReaction(
              this.app.client,
              this.loadedConfig.raw.channels.slack.typingReaction,
              reactionTarget,
            ),
          removeReaction: () =>
            removeConfiguredReaction(
              this.app.client,
              this.loadedConfig.raw.channels.slack.typingReaction,
              reactionTarget,
            ),
          setStatus: () =>
            setSlackAssistantThreadStatus(
              this.app.client,
              this.loadedConfig.raw.channels.slack.processingStatus,
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
        identity: {
          platform: "slack",
          conversationKind: params.conversationKind,
          senderId:
            typeof event.user === "string" ? event.user.trim().toUpperCase() : undefined,
          channelId,
          threadTs,
        },
        senderId:
          typeof event.user === "string" ? event.user.trim().toUpperCase() : undefined,
        text,
        agentPromptText,
        agentPromptBuilder: (nextText) =>
          buildAgentPromptText({
            text: nextText,
            identity: {
              platform: "slack",
              conversationKind: params.conversationKind,
              senderId:
                typeof event.user === "string" ? event.user.trim().toUpperCase() : undefined,
              channelId,
              threadTs,
            },
            config: this.loadedConfig.raw.channels.slack.agentPrompt,
            cliTool,
            responseMode: params.route.responseMode,
          }),
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
        { accountId: this.accountId },
      );
      const route = resolvedRoute.route;
      if (!route) {
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
        { accountId: this.accountId },
      );
      const route = resolvedRoute.route;

      if (!route) {
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
      token: this.accountConfig.botToken,
    });
    this.botUserId = auth.user_id ?? "";
    this.botLabel = (auth as { user?: string }).user?.trim() ?? "";
    this.teamId = auth.team_id ?? "";
    this.apiAppId = (auth as { api_app_id?: string }).api_app_id ?? "";
    console.log(`slack bot user ${this.botLabel || this.botUserId} (${this.accountId})`);
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
    await this.app.stop();
  }

  getBotUserLabel() {
    return this.botLabel || this.botUserId || "unknown";
  }

  getRuntimeIdentity() {
    return {
      accountId: this.accountId,
      label: this.botLabel ? `bot=${this.botLabel}` : `botUser=${this.botUserId || "unknown"}`,
      appLabel: this.apiAppId ? `app=${this.apiAppId}` : undefined,
      tokenHint: buildTokenHint(this.accountConfig.botToken),
    };
  }
}
