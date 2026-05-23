import type { AgentService } from "../../agents/runtime/agent-service.ts";
import { hasAgentCommandPrefix } from "../../agents/commands/commands.ts";
import { isImplicitFollowUpAllowed, resolveFollowUpMode } from "../../agents/commands/follow-up-policy.ts";
import { prependRecentConversationContext } from "../../agents/routing/recent-message-context.ts";
import { DEFAULT_PROTECTED_CONTROL_RULE } from "../../auth/defaults.ts";
import { claimFirstOwnerFromDirectMessage, renderFirstOwnerClaimMessage } from "../../auth/owner-claim.ts";
import { resolveChannelAuth } from "../../auth/resolve.ts";
import { buildAgentPromptText } from "../message/agent-prompt.ts";
import { renderGroupRouteAccessDeniedMessage } from "../config/route-policy.ts";
import { processChannelInteraction } from "../message/interaction-processing.ts";
import { buildRecentConversationMessage } from "../message/recent-conversation.ts";
import { ProcessedEventsStore } from "../message/processed-events-store.ts";
import { OrderedIngressDispatcher } from "../message/ordered-ingress-dispatcher.ts";
import { ActivityStore } from "../../control/runtime/activity-store.ts";
import { logLatencyDebug } from "../../control/runtime/latency-debug.ts";
import { getAgentEntry, type LoadedConfig } from "../../config/core/load-config.ts";
import { buildMentionOnlyFollowUpPrompt } from "../config/mention-follow-up.ts";
import { isChannelSenderAllowed, isChannelSenderBlocked } from "../pairing/access.ts";
import { buildPairingReplyFromRequest } from "../pairing/messages.ts";
import { upsertChannelPairingRequest } from "../pairing/store.ts";
import { buildSurfacePromptContextWithDirectory, recordSurfaceDirectoryIdentity } from "../surface/surface-directory.ts";
import type { ChannelRuntimeLifecycleEvent } from "../integration/channel-plugin.ts";
import { resolveZaloPersonalConfig, resolveZaloPersonalDirectMessageConfig, type ZaloPersonalCredentialConfig } from "./config.ts";
import { resolveZaloPersonalConversationRoute } from "./route-config.ts";
import { resolveZaloPersonalConversationTarget } from "./session-routing.ts";
import { loginZaloPersonalFromSession, type ZaloPersonalClient } from "./zca-js.ts";
import { resolveZaloPersonalGroupSenderPolicy } from "./sender-policy.ts";
import {
  getZaloPersonalMessageId,
  getZaloPersonalMessageSenderId,
  getZaloPersonalMessageText,
  hasZaloPersonalSelfMention,
} from "./inbound-message.ts";
import type {
  ZaloPersonalFollowUpState,
  ZaloPersonalIdentity,
  ZaloPersonalInboundMessage,
  ZaloPersonalInboundParams,
  ZaloPersonalSubmissionContext,
} from "./service-types.ts";

export class ZaloPersonalListenerService {
  private client?: ZaloPersonalClient;
  private accountLabel = "";
  private readonly inFlightMessages = new Set<Promise<void>>();
  private readonly ingressDispatcher = new OrderedIngressDispatcher<ZaloPersonalInboundMessage>(
    (message) => `zalo-personal:${this.botId}:${message.threadId}`,
    (message) => this.handleMessage(message),
    (error) => {
      console.error("zalo-personal message handler error", error);
    },
  );

  constructor(
    private readonly loadedConfig: LoadedConfig,
    private readonly agentService: AgentService,
    private readonly processedEventsStore: ProcessedEventsStore,
    private readonly activityStore: ActivityStore,
    private readonly botId: string,
    private readonly botCredentials: ZaloPersonalCredentialConfig,
    private readonly reportLifecycle: (event: ChannelRuntimeLifecycleEvent) => Promise<void>,
  ) {}

  private getBotConfig() {
    return resolveZaloPersonalConfig(this.loadedConfig.raw.bots.zaloPersonal, this.botId);
  }

  async start() {
    this.client = await loginZaloPersonalFromSession(this.botCredentials.tokenFile);
    this.accountLabel = this.client.api.getOwnId?.() ?? this.botId;
    this.client.api.listener.on("connected", () => {
      void this.reportLifecycle({
        connection: "active",
        summary: `Zalo Personal listener connected for ${this.botId}.`,
      });
    });
    this.client.api.listener.on("closed", (code, reason) => {
      void this.reportLifecycle({
        connection: "failed",
        summary: `Zalo Personal listener closed for ${this.botId}.`,
        detail: `${code}: ${reason}`,
      });
    });
    this.client.api.listener.on("error", (error) => {
      void this.reportLifecycle({
        connection: "failed",
        summary: `Zalo Personal listener failed for ${this.botId}.`,
        detail: error instanceof Error ? error.message : String(error),
      });
    });
    this.client.api.listener.on("message", (message) => {
      for (const task of this.ingressDispatcher.dispatch([message])) {
        this.trackInFlightMessage(task);
      }
    });
    this.client.api.listener.start({ retryOnClose: true });
  }

  async stop() {
    this.client?.api.listener.stop();
    await Promise.allSettled([...this.inFlightMessages]);
  }

  getRuntimeIdentity() {
    return {
      botId: this.botId,
      label: this.accountLabel || this.botId,
      tokenHint: "tokenFile",
    };
  }

  private async postText(conversationKind: "dm" | "group", chatId: string, text: string) {
    if (!this.client) {
      throw new Error("Zalo Personal listener is not connected.");
    }
    await this.client.api.sendMessage(
      { msg: text },
      chatId,
      conversationKind === "dm" ? this.client.ThreadType.User : this.client.ThreadType.Group,
    );
  }

  private trackInFlightMessage(task: Promise<void>) {
    this.inFlightMessages.add(task);
    task.finally(() => {
      this.inFlightMessages.delete(task);
    });
  }

  private async handleMessage(message: ZaloPersonalInboundMessage) {
    if (message.isSelf) {
      return;
    }
    const ownId = this.client?.api.getOwnId?.();
    const rawText = getZaloPersonalMessageText(message, ownId);
    if (!rawText) {
      return;
    }
    const conversationKind = message.type === this.client?.ThreadType.Group ? "group" : "dm";
    const senderId = getZaloPersonalMessageSenderId(message);
    const eventId = `zalo-personal:${this.botId}:${getZaloPersonalMessageId(message)}`;
    const status = await this.processedEventsStore.getStatus(eventId);
    if (status === "processing" || status === "completed") {
      return;
    }
    await this.processedEventsStore.markProcessing(eventId);
    try {
      await this.processInboundMessage({
        eventId,
        rawText,
        conversationKind,
        senderId,
        chatId: message.threadId,
        messageTime: Number(message.data.ts) || Date.now(),
        mentionedSelf: hasZaloPersonalSelfMention(message, ownId),
      });
      await this.processedEventsStore.markCompleted(eventId);
    } catch (error) {
      await this.processedEventsStore.clear(eventId);
      throw error;
    }
  }

  private async processInboundMessage(params: ZaloPersonalInboundParams) {
    const routeInfo = resolveZaloPersonalConversationRoute({
      loadedConfig: this.loadedConfig,
      conversationKind: params.conversationKind,
      chatId: params.chatId,
      senderId: params.senderId,
      botId: this.botId,
    });
    const route = routeInfo.route;
    if (!route) {
      return;
    }
    if (this.isBlockedSender(route, params.senderId)) {
      return;
    }
    const sessionTarget = resolveZaloPersonalConversationTarget({
      loadedConfig: this.loadedConfig,
      agentId: route.agentId,
      botId: this.botId,
      chatId: params.chatId,
      userId: routeInfo.conversationKind === "dm" ? params.senderId : undefined,
      conversationKind: routeInfo.conversationKind,
    });
    const identity = {
      platform: "zalo-personal" as const,
      botId: this.botId,
      conversationKind: routeInfo.conversationKind,
      senderId: params.senderId,
      chatId: params.chatId,
    };
    await this.maybeClaimFirstOwner(routeInfo.conversationKind, params, identity);
    const auth = resolveChannelAuth({
      config: this.loadedConfig.raw,
      agentId: route.agentId,
      identity,
    });
    if (!(await this.isDmAllowed(routeInfo.conversationKind, params, auth))) {
      return;
    }
    const senderPolicy = resolveZaloPersonalGroupSenderPolicy({
      conversationKind: routeInfo.conversationKind,
      senderId: params.senderId,
      rawText: params.rawText,
      mentionedSelf: params.mentionedSelf,
      route,
      auth,
    });
    if (!senderPolicy.allowed) {
      if (senderPolicy.shouldSendDeny) {
        await this.postText(routeInfo.conversationKind, params.chatId, renderGroupRouteAccessDeniedMessage());
      }
      return;
    }
    const followUpState = await this.agentService.getConversationFollowUpState(sessionTarget);
    if (!this.wasMentionedOrAllowedFollowUp(params, route, followUpState)) {
      return;
    }
    await this.submitInboundMessage({ params, routeInfo, route, sessionTarget, identity, auth });
  }

  private isBlockedSender(route: { blockUsers?: string[] }, senderId: string) {
    return isChannelSenderBlocked({
      channel: "zalo-personal",
      blockFrom: route.blockUsers ?? [],
      subject: { userId: senderId },
    });
  }

  private async maybeClaimFirstOwner(
    conversationKind: "dm" | "group",
    params: ZaloPersonalInboundParams,
    identity: ZaloPersonalIdentity,
  ) {
    if (conversationKind !== "dm") {
      return;
    }
    try {
      const claim = await claimFirstOwnerFromDirectMessage({
        config: this.loadedConfig.raw,
        configPath: this.loadedConfig.configPath,
        identity,
      });
      if (claim.claimed) {
        await this.postText(conversationKind, params.chatId, renderFirstOwnerClaimMessage({
          principal: claim.principal ?? `zalo-personal:${params.senderId}`,
          ownerClaimWindowMinutes: this.loadedConfig.raw.app.auth.ownerClaimWindowMinutes,
        }));
      }
    } catch (error) {
      console.error("zalo-personal first-owner claim failed", error);
    }
  }

  private async isDmAllowed(
    conversationKind: "dm" | "group",
    params: ZaloPersonalInboundParams,
    auth: ReturnType<typeof resolveChannelAuth>,
  ) {
    const dmRoute = conversationKind === "dm"
      ? resolveZaloPersonalDirectMessageConfig(this.getBotConfig(), params.senderId)
      : undefined;
    if (conversationKind !== "dm" || dmRoute?.policy === "open" || auth.mayBypassPairing) {
      return true;
    }
    const allowed = isChannelSenderAllowed({
      channel: "zalo-personal",
      allowFrom: dmRoute?.allowUsers ?? [],
      subject: { userId: params.senderId },
    });
    if (allowed) {
      return true;
    }
    await this.maybeSendPairingReply(dmRoute?.policy, params);
    return false;
  }

  private async maybeSendPairingReply(policy: string | undefined, params: ZaloPersonalInboundParams) {
    if (policy !== "pairing") {
      return;
    }
    const pairingRequest = await upsertChannelPairingRequest({
      channel: "zalo-personal",
      id: params.senderId,
      botId: this.botId,
    });
    const pairingReply = buildPairingReplyFromRequest({
      channel: "zalo-personal",
      idLine: `Your Zalo user id: ${params.senderId}`,
      botId: this.botId,
      pairingRequest,
    });
    if (pairingReply) {
      await this.postText(params.conversationKind, params.chatId, pairingReply);
    }
  }

  private wasMentionedOrAllowedFollowUp(
    params: ZaloPersonalInboundParams,
    route: NonNullable<ReturnType<typeof resolveZaloPersonalConversationRoute>["route"]>,
    followUpState: ZaloPersonalFollowUpState,
  ) {
    const effectiveFollowUpMode = resolveFollowUpMode({
      defaultMode: route.followUp.mode,
      overrideMode: followUpState.overrideMode,
    });
    const bypassMention = hasAgentCommandPrefix(params.rawText, {
      commandPrefixes: route.commandPrefixes,
    });
    const wasMentioned =
      params.mentionedSelf ||
      bypassMention ||
      isImplicitFollowUpAllowed({
        mode: effectiveFollowUpMode,
        participationTtlMs: route.followUp.participationTtlMs,
        lastBotReplyAt: followUpState.lastBotReplyAt,
        now: Date.now(),
      });
    return !route.requireMention || wasMentioned;
  }

  private async submitInboundMessage(context: ZaloPersonalSubmissionContext) {
    const env = await this.buildPromptEnvironment(context);
    const interaction = await processChannelInteraction({
      agentService: this.agentService,
      sessionTarget: context.sessionTarget,
      identity: context.identity,
      auth: context.auth,
      senderId: context.params.senderId,
      text: env.effectivePromptText,
      attachmentPaths: [],
      agentPromptText: env.agentPromptText,
      agentPromptBuilder: (nextText, options) => this.buildInteractionPrompt({
        context,
        env,
        nextText,
        maxProgressMessagesOverride: options?.maxProgressMessagesOverride,
      }),
      promptContext: env.promptContext,
      protectedControlMutationRule: env.protectedControlMutationRule,
      transformSessionInputText: env.enrichPromptText,
      onPromptAccepted: async () => {
        await this.agentService.markRecentConversationProcessed(context.sessionTarget, env.recentMessageMarker);
      },
      route: context.route,
      maxChars: 2000,
      canUpdateLiveReply: false,
      timingContext: env.timingContext,
      postText: async (nextText) => this.postInteractionText(context, nextText),
      reconcileText: async (_chunks, nextText) => this.postInteractionText(context, nextText),
    });
    void interaction;
  }

  private async buildPromptEnvironment(context: ZaloPersonalSubmissionContext) {
    const recentMessageMarker = await this.recordInboundConversationMessage(context);
    const promptInput = await this.buildPromptInput(context, recentMessageMarker);
    await this.recordInboundActivity(context);
    const runtimePrompt = await this.buildRuntimePrompt(context, promptInput);
    const timingContext = {
      platform: "zalo-personal" as const,
      eventId: context.params.eventId,
      agentId: context.route.agentId,
      chatId: context.params.chatId,
      sessionKey: context.sessionTarget.sessionKey,
    };
    logLatencyDebug("zalo-personal-event-accepted", timingContext, {
      conversationKind: context.routeInfo.conversationKind,
      responseMode: context.route.responseMode,
      botId: this.botId,
    });

    return {
      recentMessageMarker,
      ...promptInput,
      ...runtimePrompt,
      timingContext,
    };
  }

  private async recordInboundConversationMessage(context: ZaloPersonalSubmissionContext) {
    const { params, route, sessionTarget } = context;
    const recentMessageMarker = params.eventId;
    await this.agentService.appendRecentConversationMessage(sessionTarget, buildRecentConversationMessage({
      marker: recentMessageMarker,
      text: params.rawText,
      senderId: params.senderId,
      platform: "zalo-personal",
      commandPrefixes: route.commandPrefixes,
    }));
    return recentMessageMarker;
  }

  private async buildPromptInput(
    context: ZaloPersonalSubmissionContext,
    recentMessageMarker: string,
  ) {
    const { params, routeInfo, route, sessionTarget } = context;
    const effectivePromptText =
      params.rawText ||
      (route.requireMention
        ? buildMentionOnlyFollowUpPrompt({ conversationKind: routeInfo.conversationKind })
        : "");
    const recentConversationReplay = await this.agentService.getRecentConversationReplayMessages(
      sessionTarget,
      { excludeMarker: recentMessageMarker },
    );
    const enrichPromptText = (input: string) => prependRecentConversationContext({
      currentText: input,
      recentMessages: recentConversationReplay,
    });
    return { effectivePromptText, enrichPromptText };
  }

  private async recordInboundActivity(context: ZaloPersonalSubmissionContext) {
    const { routeInfo, route, identity } = context;
    await this.activityStore.record({
      agentId: route.agentId,
      channel: "zalo-personal",
      surface: routeInfo.conversationKind,
    });
    void recordSurfaceDirectoryIdentity({
      stateDir: this.loadedConfig.stateDir,
      identity,
    }).catch(() => undefined);
  }

  private async buildRuntimePrompt(
    context: ZaloPersonalSubmissionContext,
    promptInput: {
      effectivePromptText: string;
      enrichPromptText: (input: string) => string;
    },
  ) {
    const { params, route, identity, auth } = context;
    const cliTool = getAgentEntry(this.loadedConfig, route.agentId)?.cli ??
      this.loadedConfig.raw.agents.defaults.cli;
    const protectedControlMutationRule = auth.mayManageProtectedResources
      ? undefined
      : DEFAULT_PROTECTED_CONTROL_RULE;
    const promptContext = await buildSurfacePromptContextWithDirectory({
      stateDir: this.loadedConfig.stateDir,
      identity,
      agentId: route.agentId,
      time: params.messageTime,
    });
    const agentPromptText = buildAgentPromptText({
      text: promptInput.enrichPromptText(promptInput.effectivePromptText),
      identity,
      config: this.getBotConfig().agentPrompt,
      cliTool,
      responseMode: route.responseMode,
      streaming: route.streaming,
      protectedControlMutationRule,
      agentId: route.agentId,
      time: params.messageTime,
      promptContext,
    });
    return { cliTool, protectedControlMutationRule, promptContext, agentPromptText };
  }

  private buildInteractionPrompt(input: {
    context: ZaloPersonalSubmissionContext;
    env: Awaited<ReturnType<ZaloPersonalListenerService["buildPromptEnvironment"]>>;
    nextText: string;
    maxProgressMessagesOverride?: number;
  }) {
    const { context, env, nextText, maxProgressMessagesOverride } = input;
    return buildAgentPromptText({
      text: env.enrichPromptText(nextText),
      identity: context.identity,
      config: this.getBotConfig().agentPrompt,
      cliTool: env.cliTool,
      responseMode: context.route.responseMode,
      streaming: context.route.streaming,
      protectedControlMutationRule: env.protectedControlMutationRule,
      agentId: context.route.agentId,
      time: Date.now(),
      promptContext: {
        ...env.promptContext,
        time: new Date().toISOString(),
      },
      maxProgressMessagesOverride,
    });
  }

  private async postInteractionText(context: ZaloPersonalSubmissionContext, text: string) {
    await this.postText(context.routeInfo.conversationKind, context.params.chatId, text);
    return [];
  }
}
