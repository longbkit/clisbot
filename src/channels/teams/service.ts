import http from "node:http";
import type { AgentService } from "../../agents/agent-service.ts";
import { parseAgentCommand } from "../../agents/commands.ts";
import { prependAttachmentMentions } from "../../agents/attachments/prompt.ts";
import {
  isImplicitFollowUpAllowed,
  resolveFollowUpMode,
} from "../../agents/follow-up-policy.ts";
import { processChannelInteraction } from "../interaction-processing.ts";
import { getAgentEntry, type LoadedConfig } from "../../config/load-config.ts";
import {
  upsertChannelPairingRequest,
} from "../pairing/store.ts";
import { buildPairingReplyFromRequest } from "../pairing/messages.ts";
import { ProcessedEventsStore } from "../processed-events-store.ts";
import { ActivityStore } from "../../control/activity-store.ts";
import {
  resolveTeamsBotConfig,
  resolveTeamsDirectMessageAdmissionConfig,
  type ResolvedTeamsBotConfig,
} from "../../config/channel-bots.ts";
import type { TeamsBotCredentialConfig } from "../../config/channel-bots.ts";
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
import { logLatencyDebug } from "../../control/latency-debug.ts";
import { buildTokenHint } from "../runtime-identity.ts";
import { renderGroupRouteAccessDeniedMessage } from "../route-policy.ts";
import type { ChannelRuntimeLifecycleEvent } from "../channel-plugin.ts";
import {
  postTeamsText,
  reconcileTeamsText,
  getTeamsMaxChars,
  type TeamsPostedMessage,
} from "./transport.ts";
import { resolveTeamsMessageContent } from "./content.ts";
import {
  isTeamsBotMentioned,
  isTeamsBotOriginatedMessage,
  stripTeamsBotMention,
  resolveTeamsConversationName,
  type TeamsActivity,
} from "./message.ts";
import {
  resolveTeamsConversationRoute,
} from "./route-config.ts";
import {
  resolveTeamsConversationTarget,
} from "./session-routing.ts";

// Map from conversationId to { serviceUrl, lastSeen } for notification delivery
const teamsServiceUrlCache = new Map<string, { serviceUrl: string; lastSeenAt: number }>();

function cacheServiceUrl(conversationId: string, serviceUrl: string) {
  teamsServiceUrlCache.set(conversationId, {
    serviceUrl,
    lastSeenAt: Date.now(),
  });
}

function getCachedServiceUrl(conversationId: string): string | undefined {
  return teamsServiceUrlCache.get(conversationId)?.serviceUrl;
}

function isBearerAuthValid(authHeader?: string): boolean {
  if (!authHeader) {
    return false;
  }
  const parts = authHeader.trim().split(" ");
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer") {
    return false;
  }
  const token = parts[1];
  if (!token || token.length < 10) {
    return false;
  }
  // Basic JWT expiry check
  try {
    const jwtParts = token.split(".");
    if (jwtParts.length !== 3) {
      return false;
    }
    const payload = JSON.parse(
      Buffer.from(jwtParts[1] ?? "", "base64url").toString("utf8"),
    ) as { exp?: number };
    if (typeof payload.exp === "number") {
      const nowSec = Math.floor(Date.now() / 1000);
      if (payload.exp < nowSec) {
        return false;
      }
    }
    return true;
  } catch {
    // If we can't parse the JWT just let it through — full verification can be added later
    return true;
  }
}

export class TeamsWebhookService {
  private botId_: string = "";
  private botName_: string = "";
  private server: http.Server | null = null;
  private running = false;

  constructor(
    private readonly loadedConfig: LoadedConfig,
    private readonly agentService: AgentService,
    private readonly processedEventsStore: ProcessedEventsStore,
    private readonly activityStore: ActivityStore,
    private readonly botId: string = "default",
    private readonly credentials: TeamsBotCredentialConfig,
    private readonly reportLifecycle?: (event: ChannelRuntimeLifecycleEvent) => Promise<void>,
  ) {
    this.agentService.registerSurfaceNotificationHandler({
      platform: "teams",
      botId: this.botId,
      handler: async ({ binding, text }) => {
        const conversationId = binding.chatId ?? binding.channelId;
        if (!conversationId) {
          return;
        }
        const serviceUrl = getCachedServiceUrl(conversationId);
        if (!serviceUrl) {
          // No known serviceUrl for this conversation — skip
          return;
        }
        const renderedNotification = resolveTeamsMessageContent({
          text,
          inputFormat: "md",
          renderMode: "native",
        });
        await postTeamsText({
          appId: this.credentials.appId,
          appPassword: this.credentials.appPassword,
          serviceUrl,
          conversationId,
          text: renderedNotification.text,
          wireFormat: renderedNotification.wireFormat,
        });
      },
    });
  }

  private getBotConfig(): ResolvedTeamsBotConfig {
    return resolveTeamsBotConfig(this.loadedConfig.raw.bots.teams, this.botId);
  }

  async start() {
    this.running = true;
    const botConfig = this.getBotConfig();
    const port = botConfig.webhook.port;
    const path = botConfig.webhook.path;

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        console.error("teams webhook handler error", error);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(port, () => {
        resolve();
      });
      this.server!.on("error", reject);
    });

    this.botId_ = this.credentials.appId;
    this.botName_ = `appId=${this.credentials.appId}`;
    console.log(`teams bot ${this.botName_} (${this.botId}) listening on port ${port} at ${path}`);
  }

  async stop() {
    this.running = false;
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
    this.agentService.unregisterSurfaceNotificationHandler({
      platform: "teams",
      botId: this.botId,
    });
  }

  getRuntimeIdentity() {
    return {
      botId: this.botId,
      label: `appId=${this.credentials.appId}`,
      tokenHint: buildTokenHint(this.credentials.appPassword),
    };
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const botConfig = this.getBotConfig();
    const expectedPath = botConfig.webhook.path;

    if (req.method !== "POST" || req.url !== expectedPath) {
      res.writeHead(404);
      res.end();
      return;
    }

    const authHeader = req.headers.authorization;
    if (!isBearerAuthValid(authHeader)) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const body = await readRequestBody(req);
    let activity: TeamsActivity;
    try {
      activity = JSON.parse(body) as TeamsActivity;
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }

    // Respond immediately to Teams
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({}));

    if (!this.running) {
      return;
    }

    // Only process message activities
    if (activity.type !== "message") {
      return;
    }

    // Cache the serviceUrl for later notification delivery
    if (activity.serviceUrl && activity.conversation?.id) {
      cacheServiceUrl(activity.conversation.id, activity.serviceUrl);
    }

    this.handleActivity(activity).catch((error) => {
      console.error("teams activity handler error", error);
    });
  }

  private async handleActivity(activity: TeamsActivity) {
    const eventId = `teams:${activity.id}`;
    const existingStatus = await this.processedEventsStore.getStatus(eventId);
    if (existingStatus === "processing" || existingStatus === "completed") {
      return;
    }

    const conversationType = activity.conversation.conversationType ?? "personal";
    const conversationId = activity.conversation.id;
    const userId = activity.from.id;
    const rawText = (activity.text ?? "").trim();

    const botConfig = this.getBotConfig();
    const slashCommand = parseAgentCommand(rawText, {
      commandPrefixes: botConfig.commandPrefixes,
    });

    const routeInfo = resolveTeamsConversationRoute({
      loadedConfig: this.loadedConfig,
      conversationType,
      conversationId,
      userId,
      botId: this.botId,
    });

    const route = routeInfo.route;
    const sessionTarget = route
      ? resolveTeamsConversationTarget({
          loadedConfig: this.loadedConfig,
          agentId: route.agentId,
          botId: this.botId,
          conversationId,
          userId,
          conversationKind: routeInfo.conversationKind,
        })
      : null;

    if (!route) {
      if (routeInfo.status !== "disabled") {
        // No route configured
      }
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }

    if (!sessionTarget) {
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }

    // Skip messages from the bot itself
    if (isTeamsBotOriginatedMessage(activity, this.credentials.appId)) {
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }

    if (isTeamsBotOriginatedMessage(activity, this.credentials.appId) && !route.allowBots) {
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }

    // In channel/group, check for bot mention requirement
    const isMentioned = isTeamsBotMentioned(activity, this.credentials.appId);
    const textBody = isMentioned
      ? stripTeamsBotMention(rawText, activity.recipient.name)
      : rawText;

    if (routeInfo.conversationKind !== "dm") {
      // Shared room: check auth, blocks, allowlists
      const sharedAuth =
        userId && route.agentId
          ? resolveChannelAuth({
            config: this.loadedConfig.raw,
            agentId: route.agentId,
            identity: {
              platform: "teams",
              botId: this.botId,
              conversationKind: routeInfo.conversationKind,
              senderId: userId,
              channelId: conversationId,
            },
          })
          : undefined;

      if (
        !sharedAuth?.mayBypassSharedSenderPolicy &&
        userId &&
        (route.policy === "allowlist" || (route.allowUsers?.length ?? 0) > 0) &&
        !(route.allowUsers ?? []).some(
          (allowed) => allowed.trim().toLowerCase() === userId.trim().toLowerCase(),
        )
      ) {
        await this.sendTextToConversation(activity.serviceUrl, conversationId, renderGroupRouteAccessDeniedMessage());
        await this.processedEventsStore.markCompleted(eventId);
        return;
      }
    }

    if (routeInfo.conversationKind === "dm") {
      const directMessages = resolveTeamsDirectMessageAdmissionConfig(botConfig);

      if (!userId || directMessages.policy === "disabled") {
        await this.processedEventsStore.markCompleted(eventId);
        return;
      }

      const dmIdentity = {
        platform: "teams" as const,
        conversationKind: routeInfo.conversationKind,
        senderId: userId || undefined,
        chatId: conversationId,
      };

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
        console.error("teams first-owner claim failed", error);
      }

      if (ownerClaimed && ownerPrincipal) {
        try {
          await this.sendTextToConversation(
            activity.serviceUrl,
            conversationId,
            renderFirstOwnerClaimMessage({
              principal: ownerPrincipal,
              ownerClaimWindowMinutes: this.loadedConfig.raw.app.auth.ownerClaimWindowMinutes,
            }),
          );
        } catch (error) {
          console.error("teams first-owner claim reply failed", error);
        }
      }

      const auth = resolveChannelAuth({
        config: this.loadedConfig.raw,
        agentId: route.agentId,
        identity: dmIdentity,
      });

      if (
        (route.blockUsers ?? []).some(
          (blocked) => blocked.trim().toLowerCase() === userId.trim().toLowerCase(),
        )
      ) {
        await this.processedEventsStore.markCompleted(eventId);
        return;
      }

      if (directMessages.policy !== "open" && !auth.mayBypassPairing) {
        const allowed = (directMessages.allowUsers ?? []).some(
          (allowedEntry) => allowedEntry.trim().toLowerCase() === userId.trim().toLowerCase(),
        );
        if (!allowed) {
          if (directMessages.policy === "pairing") {
            const pairingRequest = await upsertChannelPairingRequest({
              channel: "teams",
              id: userId,
              botId: this.botId,
              meta: {
                name: activity.from.name,
              },
            });
            const pairingReply = buildPairingReplyFromRequest({
              channel: "teams",
              idLine: `Your Teams user id: ${userId}`,
              botId: this.botId,
              pairingRequest,
            });
            if (pairingReply) {
              try {
                await this.sendTextToConversation(activity.serviceUrl, conversationId, pairingReply);
              } catch (error) {
                console.error("teams pairing reply failed", error);
              }
            }
          }
          await this.processedEventsStore.markCompleted(eventId);
          return;
        }
      }
    }

    const explicitMention =
      isMentioned || Boolean(slashCommand && rawText.startsWith("/"));
    const followUpState =
      await this.agentService.getConversationFollowUpState(sessionTarget);
    const effectiveFollowUpMode = resolveFollowUpMode({
      defaultMode: route.followUp.mode,
      overrideMode: followUpState.overrideMode,
    });
    const bypassMention = rawText.startsWith("/") || rawText.startsWith("!");
    const wasMentioned =
      explicitMention ||
      bypassMention ||
      isImplicitFollowUpAllowed({
        mode: effectiveFollowUpMode,
        participationTtlMs: route.followUp.participationTtlMs,
        lastBotReplyAt: followUpState.lastBotReplyAt,
        directReplyToBot: false,
      });

    const recentMessageMarker = activity.id;
    if (rawText || explicitMention || slashCommand) {
      await this.agentService.appendRecentConversationMessage(sessionTarget, {
        marker: recentMessageMarker,
        text: slashCommand ? "" : textBody,
        senderId: userId || undefined,
        senderName: activity.from.name?.trim() || undefined,
        platform: "teams",
      });
    }

    if (route.requireMention && !wasMentioned) {
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }

    if (explicitMention && followUpState.overrideMode === "paused") {
      await this.agentService.reactivateConversationFollowUp(sessionTarget);
    }

    const effectivePromptText =
      textBody ||
      (explicitMention
        ? buildMentionOnlyFollowUpPrompt({
            conversationKind: routeInfo.conversationKind === "dm" ? "dm" : "group",
            threaded: false,
          })
        : "");

    const text = prependAttachmentMentions(effectivePromptText, []);

    if (!text) {
      await this.processedEventsStore.markCompleted(eventId);
      return;
    }

    const recentConversationReplay = await this.agentService.getRecentConversationReplayMessages(
      sessionTarget,
      { excludeMarker: recentMessageMarker },
    );
    const enrichPromptText = (nextText: string) =>
      prependRecentConversationContext({
        currentText: nextText,
        recentMessages: recentConversationReplay,
      });

    await this.processedEventsStore.markProcessing(eventId);
    await this.activityStore.record({
      agentId: route.agentId,
      channel: "teams",
      surface:
        routeInfo.conversationKind === "dm"
          ? "dm"
          : `group:${conversationId}`,
    });

    try {
      let responseChunks: TeamsPostedMessage[] = [];
      const senderName = activity.from.name?.trim() || undefined;
      const identity = {
        platform: "teams" as const,
        botId: this.botId,
        conversationKind: routeInfo.conversationKind,
        senderId: userId || undefined,
        senderName,
        channelId: conversationId,
        chatId: conversationId,
        chatName: resolveTeamsConversationName(activity),
      };
      void recordSurfaceDirectoryIdentity({
        stateDir: this.loadedConfig.stateDir,
        identity,
      }).catch(() => undefined);

      const cliTool =
        getAgentEntry(this.loadedConfig, route.agentId)?.cli ??
        this.loadedConfig.raw.agents.defaults.cli;
      const auth = resolveChannelAuth({
        config: this.loadedConfig.raw,
        agentId: route.agentId,
        identity,
      });
      const protectedControlMutationRule = auth.mayManageProtectedResources
        ? undefined
        : DEFAULT_PROTECTED_CONTROL_RULE;
      const promptTime = activity.timestamp
        ? new Date(activity.timestamp).getTime()
        : Date.now();
      const promptContext = await buildSurfacePromptContextWithDirectory({
        stateDir: this.loadedConfig.stateDir,
        identity,
        agentId: route.agentId,
        time: promptTime,
      });
      const agentPromptText = buildAgentPromptText({
        text: enrichPromptText(text),
        identity,
        config: botConfig.agentPrompt,
        cliTool,
        responseMode: route.responseMode,
        streaming: route.streaming,
        protectedControlMutationRule,
        agentId: route.agentId,
        time: promptTime,
        promptContext,
      });
      const timingContext = {
        platform: "teams" as const,
        eventId,
        agentId: route.agentId,
        chatId: conversationId,
        sessionKey: sessionTarget.sessionKey,
      };
      logLatencyDebug("teams-event-accepted", timingContext, {
        conversationKind: routeInfo.conversationKind,
        responseMode: route.responseMode,
        botId: this.botId,
      });

      const serviceUrl = activity.serviceUrl;

      await processChannelInteraction({
        agentService: this.agentService,
        sessionTarget,
        identity,
        auth,
        senderId: userId || undefined,
        text,
        agentPromptText,
        agentPromptBuilder: (nextText, options) =>
          buildAgentPromptText({
            text: enrichPromptText(nextText),
            identity,
            config: botConfig.agentPrompt,
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
        maxChars: getTeamsMaxChars(this.agentService.getMaxMessageChars(route.agentId)),
        timingContext,
        postText: async (nextText) => {
          const renderedReply = resolveTeamsMessageContent({
            text: nextText,
            inputFormat: "md",
            renderMode: "native",
          });
          responseChunks = await postTeamsText({
            appId: this.credentials.appId,
            appPassword: this.credentials.appPassword,
            serviceUrl,
            conversationId,
            text: renderedReply.text,
            wireFormat: renderedReply.wireFormat,
          });
          return responseChunks;
        },
        reconcileText: async (chunks: TeamsPostedMessage[], nextText) => {
          const renderedReply = resolveTeamsMessageContent({
            text: nextText,
            inputFormat: "md",
            renderMode: "native",
          });
          responseChunks = await reconcileTeamsText({
            appId: this.credentials.appId,
            appPassword: this.credentials.appPassword,
            serviceUrl,
            conversationId,
            chunks,
            text: renderedReply.text,
            wireFormat: renderedReply.wireFormat,
          });
          return responseChunks;
        },
      });

      await this.processedEventsStore.markCompleted(eventId);
    } catch (error) {
      console.error("teams handler error", error);
      await this.processedEventsStore.clear(eventId);
    }
  }

  private async sendTextToConversation(
    serviceUrl: string,
    conversationId: string,
    text: string,
  ) {
    const resolved = resolveTeamsMessageContent({
      text,
      inputFormat: "md",
      renderMode: "native",
    });
    await postTeamsText({
      appId: this.credentials.appId,
      appPassword: this.credentials.appPassword,
      serviceUrl,
      conversationId,
      text: resolved.text,
      wireFormat: resolved.wireFormat,
    });
  }
}

async function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
