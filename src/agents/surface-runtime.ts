import { buildAgentPromptText } from "../channels/agent-prompt.ts";
import type { ChannelIdentity } from "../channels/channel-identity.ts";
import { resolveChannelIdentityBotId } from "../channels/channel-identity.ts";
import {
  buildConfiguredTargetFromIdentity,
  resolveConfiguredSurfaceModeTarget,
} from "../channels/mode-config-shared.ts";
import { renderPlatformInteraction } from "../channels/rendering.ts";
import { buildSurfacePromptContextWithDirectory } from "../channels/surface-directory.ts";
import {
  renderLoopStartNotification,
  renderQueueStartNotification,
  type SurfaceNotificationsConfig,
} from "../channels/surface-notifications.ts";
import {
  resolveSlackBotConfig,
  resolveSlackDirectMessageConfig,
  resolveTelegramBotConfig,
  resolveTelegramDirectMessageConfig,
  resolveTeamsBotConfig,
  resolveTeamsDirectMessageConfig,
} from "../config/channel-bots.ts";
import { resolveSharedGroupsWildcardRoute } from "../config/group-routes.ts";
import { getAgentEntry, type LoadedConfig } from "../config/load-config.ts";
import type { RunUpdate } from "./run-observation.ts";
import type { StoredLoop, StoredLoopSurfaceBinding } from "./loop-state.ts";
import type { StoredQueueItem } from "./queue-state.ts";
import type { AgentSessionTarget } from "./resolved-target.ts";

export type SurfaceNotificationRequest = {
  binding: StoredLoopSurfaceBinding;
  text: string;
};

export type SurfaceNotificationHandler = (request: SurfaceNotificationRequest) => Promise<void>;

export type SurfaceNotificationRegistration = SurfaceNotificationTarget & {
  handler: SurfaceNotificationHandler;
};

export type SurfaceNotificationTarget = {
  platform: "slack" | "telegram" | "teams";
  botId?: string;
  accountId?: string;
};

export class SurfaceRuntime {
  private surfaceNotificationHandlers = new Map<string, SurfaceNotificationHandler>();

  constructor(private readonly loadedConfig: LoadedConfig) {}

  registerSurfaceNotificationHandler(params: SurfaceNotificationRegistration) {
    this.surfaceNotificationHandlers.set(
      this.getSurfaceNotificationHandlerKey(params.platform, params.botId ?? params.accountId),
      params.handler,
    );
  }

  unregisterSurfaceNotificationHandler(params: SurfaceNotificationTarget) {
    this.surfaceNotificationHandlers.delete(
      this.getSurfaceNotificationHandlerKey(params.platform, params.botId ?? params.accountId),
    );
  }

  getMaxMessageChars(agentId: string) {
    const defaults = this.loadedConfig.raw.agents.defaults.runner.defaults.stream;
    const override = getAgentEntry(this.loadedConfig, agentId)?.runner?.defaults?.stream;
    return {
      ...defaults,
      ...(override ?? {}),
    }.maxMessageChars;
  }

  async notifyManagedLoopStart(target: AgentSessionTarget, loop: StoredLoop) {
    if (!loop.surfaceBinding) {
      return;
    }

    const identity = this.buildLoopChannelIdentity(loop);
    const notifications = this.resolveSurfaceNotifications(identity);
    const mode = loop.loopStart ?? notifications.loopStart;
    const text =
      loop.kind === "calendar"
        ? renderLoopStartNotification({
            mode,
            agentId: target.agentId,
            loopId: loop.id,
            promptSummary: loop.promptSummary,
            cadence: loop.cadence,
            dayOfWeek: loop.dayOfWeek,
            localTime: loop.localTime,
            timezone: loop.timezone,
            nextRunAt: loop.nextRunAt,
            remainingRuns: Math.max(0, loop.maxRuns - loop.attemptedRuns),
            maxRuns: loop.maxRuns,
            kind: "calendar",
          })
        : renderLoopStartNotification({
            mode,
            agentId: target.agentId,
            loopId: loop.id,
            promptSummary: loop.promptSummary,
            intervalMs: loop.intervalMs,
            nextRunAt: loop.nextRunAt,
            remainingRuns: Math.max(0, loop.maxRuns - loop.attemptedRuns),
            maxRuns: loop.maxRuns,
          });
    if (!text) {
      return;
    }

    try {
      await this.notifySurface({
        binding: loop.surfaceBinding,
        text,
      });
    } catch (error) {
      console.error("loop start notification failed", error);
    }
  }

  async notifyManagedQueueStart(target: AgentSessionTarget, item: StoredQueueItem) {
    if (!item.surfaceBinding) {
      return;
    }

    const identity = this.buildQueueChannelIdentity(item);
    const notifications = this.resolveSurfaceNotifications(identity);
    const text = renderQueueStartNotification({
      mode: notifications.queueStart,
      agentId: target.agentId,
      promptSummary: item.promptSummary,
    });
    if (!text) {
      return;
    }

    try {
      await this.notifySurface({
        binding: item.surfaceBinding,
        text,
      });
    } catch (error) {
      console.error("queue start notification failed", error);
    }
  }

  async notifyManagedQueueSettlement(
    target: AgentSessionTarget,
    item: StoredQueueItem,
    update: RunUpdate,
  ) {
    if (!item.surfaceBinding) {
      return;
    }

    const identity = this.buildQueueChannelIdentity(item);
    const text = renderPlatformInteraction({
      platform: identity.platform,
      status: update.status,
      content: update.snapshot,
      maxChars: this.getMaxMessageChars(target.agentId),
      note: update.note,
      responsePolicy: "final",
    });

    try {
      await this.notifySurface({
        binding: item.surfaceBinding,
        text,
      });
    } catch (error) {
      console.error("queue settlement notification failed", error);
    }
  }

  async notifyManagedQueueFailure(
    target: AgentSessionTarget,
    item: StoredQueueItem,
    error: unknown,
  ) {
    if (!item.surfaceBinding) {
      return;
    }

    const identity = this.buildQueueChannelIdentity(item);
    const text = renderPlatformInteraction({
      platform: identity.platform,
      status: "error",
      content: String(error),
      maxChars: this.getMaxMessageChars(target.agentId),
      responsePolicy: "final",
    });

    try {
      await this.notifySurface({
        binding: item.surfaceBinding,
        text,
      });
    } catch (notificationError) {
      console.error("queue failure notification failed", notificationError);
    }
  }

  async buildManagedLoopPrompt(agentId: string, loop: StoredLoop) {
    if (!loop.surfaceBinding) {
      return loop.promptText;
    }

    const identity = this.buildLoopChannelIdentity(loop);
    const channelConfig = this.resolveChannelPromptConfig(identity);
    const { responseMode, streaming } = this.resolveSurfaceModes(identity);
    const promptTime = Date.now();
    const promptContext = await buildSurfacePromptContextWithDirectory({
      stateDir: this.loadedConfig.stateDir,
      identity,
      agentId,
      time: promptTime,
      scheduledLoopId: loop.id,
    });

    return buildAgentPromptText({
      text: loop.promptText,
      identity,
      config: channelConfig.agentPrompt,
      cliTool: getAgentEntry(this.loadedConfig, agentId)?.cli,
      responseMode,
      streaming,
      protectedControlMutationRule: loop.protectedControlMutationRule,
      agentId,
      time: promptTime,
      promptContext,
      scheduledLoopId: loop.id,
      maxProgressMessagesOverride: loop.progressMessages,
    });
  }

  async buildManagedQueuePrompt(agentId: string, item: StoredQueueItem) {
    if (!item.surfaceBinding) {
      return item.promptText;
    }

    const identity = this.buildQueueChannelIdentity(item);
    const channelConfig = this.resolveChannelPromptConfig(identity);
    const { responseMode, streaming } = this.resolveSurfaceModes(identity);
    const promptTime = Date.now();
    const promptContext = await buildSurfacePromptContextWithDirectory({
      stateDir: this.loadedConfig.stateDir,
      identity,
      agentId,
      time: promptTime,
    });

    return buildAgentPromptText({
      text: item.promptText,
      identity,
      config: channelConfig.agentPrompt,
      cliTool: getAgentEntry(this.loadedConfig, agentId)?.cli,
      responseMode,
      streaming,
      protectedControlMutationRule: item.protectedControlMutationRule,
      agentId,
      time: promptTime,
      promptContext,
    });
  }

  private getSurfaceNotificationHandlerKey(platform: "slack" | "telegram" | "teams", botId?: string) {
    return `${platform}:${botId?.trim() || "default"}`;
  }

  private async notifySurface(request: SurfaceNotificationRequest) {
    const handler = this.surfaceNotificationHandlers.get(
      this.getSurfaceNotificationHandlerKey(request.binding.platform, request.binding.botId),
    );
    if (!handler) {
      return;
    }
    await handler(request);
  }

  private resolveChannelPromptConfig(identity: ChannelIdentity) {
    if (identity.platform === "slack") {
      return resolveSlackBotConfig(
        this.loadedConfig.raw.bots.slack,
        resolveChannelIdentityBotId(identity),
      );
    }
    if (identity.platform === "teams") {
      return resolveTeamsBotConfig(
        this.loadedConfig.raw.bots.teams,
        resolveChannelIdentityBotId(identity),
      );
    }
    return resolveTelegramBotConfig(
      this.loadedConfig.raw.bots.telegram,
      resolveChannelIdentityBotId(identity),
    );
  }

  private resolveSurfaceNotifications(identity: ChannelIdentity): SurfaceNotificationsConfig {
    if (identity.platform === "slack") {
      return this.resolveSlackSurfaceNotifications(identity);
    }
    if (identity.platform === "teams") {
      return this.resolveTeamsSurfaceNotifications(identity);
    }
    return this.resolveTelegramSurfaceNotifications(identity);
  }

  private resolveSlackSurfaceNotifications(identity: ChannelIdentity): SurfaceNotificationsConfig {
    const channelConfig = resolveSlackBotConfig(
      this.loadedConfig.raw.bots.slack,
      resolveChannelIdentityBotId(identity),
    );
    const resolved: SurfaceNotificationsConfig = {
      queueStart: channelConfig.surfaceNotifications?.queueStart ?? "brief",
      loopStart: channelConfig.surfaceNotifications?.loopStart ?? "brief",
    };
    if (identity.conversationKind === "dm") {
      const directMessageConfig = resolveSlackDirectMessageConfig(
        channelConfig,
        identity.senderId,
      );
      return {
        ...resolved,
        ...(directMessageConfig?.surfaceNotifications ?? {}),
      };
    }
    const routeCollection = channelConfig.groups;
    const routeKey = identity.conversationKind === "group"
      ? identity.channelId ? `group:${identity.channelId}` : undefined
      : identity.channelId ? `channel:${identity.channelId}` : undefined;
    const wildcardRoute = resolveSharedGroupsWildcardRoute(routeCollection);
    const route = identity.channelId
      ? routeCollection[routeKey ?? ""] ?? wildcardRoute
      : undefined;
    return {
      ...resolved,
      ...(route?.surfaceNotifications ?? {}),
    };
  }

  private resolveTelegramSurfaceNotifications(identity: ChannelIdentity): SurfaceNotificationsConfig {
    const channelConfig = resolveTelegramBotConfig(
      this.loadedConfig.raw.bots.telegram,
      resolveChannelIdentityBotId(identity),
    );
    let resolved: SurfaceNotificationsConfig = {
      queueStart: channelConfig.surfaceNotifications?.queueStart ?? "brief",
      loopStart: channelConfig.surfaceNotifications?.loopStart ?? "brief",
    };
    if (identity.conversationKind === "dm") {
      const directMessageConfig = resolveTelegramDirectMessageConfig(
        channelConfig,
        identity.senderId,
      );
      return {
        ...resolved,
        ...(directMessageConfig?.surfaceNotifications ?? {}),
      };
    }
    const groupRoute = identity.chatId
      ? channelConfig.groups[identity.chatId] ??
        resolveSharedGroupsWildcardRoute(channelConfig.groups)
      : undefined;
    resolved = {
      ...resolved,
      ...(groupRoute?.surfaceNotifications ?? {}),
    };
    if (identity.conversationKind === "topic" && identity.topicId) {
      return {
        ...resolved,
        ...(groupRoute?.topics?.[identity.topicId]?.surfaceNotifications ?? {}),
      };
    }
    return resolved;
  }

  private buildLoopChannelIdentity(loop: StoredLoop): ChannelIdentity {
    const binding = loop.surfaceBinding!;
    const sender = loop.sender;
    return {
      platform: binding.platform,
      botId: binding.botId ?? binding.accountId,
      conversationKind: binding.conversationKind,
      senderId: sender?.providerId ?? loop.createdBy,
      senderName: sender?.displayName,
      senderHandle: sender?.handle,
      channelId: binding.channelId,
      channelName: binding.channelName,
      chatId: binding.chatId,
      chatName: binding.chatName,
      threadTs: binding.threadTs,
      topicId: binding.topicId,
      topicName: binding.topicName,
    };
  }

  private buildQueueChannelIdentity(item: StoredQueueItem): ChannelIdentity {
    const binding = item.surfaceBinding!;
    const sender = item.sender;
    return {
      platform: binding.platform,
      botId: binding.botId ?? binding.accountId,
      conversationKind: binding.conversationKind,
      senderId: sender?.providerId ?? item.createdBy,
      senderName: sender?.displayName,
      senderHandle: sender?.handle,
      channelId: binding.channelId,
      channelName: binding.channelName,
      chatId: binding.chatId,
      chatName: binding.chatName,
      threadTs: binding.threadTs,
      topicId: binding.topicId,
      topicName: binding.topicName,
    };
  }

  private resolveSurfaceModes(identity: ChannelIdentity) {
    const modes = this.resolveChannelSurfaceModes(identity);
    return {
      responseMode: this.resolveConfiguredResponseMode(identity) ??
        modes.responseMode,
      streaming: this.resolveConfiguredStreaming(identity) ??
        modes.streaming,
    };
  }

  private resolveConfiguredResponseMode(identity: ChannelIdentity) {
    try {
      return resolveConfiguredSurfaceModeTarget(
        this.loadedConfig.raw,
        "responseMode",
        buildConfiguredTargetFromIdentity(identity),
      ).get();
    } catch {
      // Fall back to channel-level defaults if the original route no longer exists.
    }
  }

  private resolveConfiguredStreaming(identity: ChannelIdentity) {
    try {
      return resolveConfiguredSurfaceModeTarget(
        this.loadedConfig.raw,
        "streaming",
        buildConfiguredTargetFromIdentity(identity),
      ).get();
    } catch {
      // Fall back to channel-level defaults if the original route no longer exists.
    }
  }

  private resolveTeamsSurfaceNotifications(identity: ChannelIdentity): SurfaceNotificationsConfig {
    const channelConfig = resolveTeamsBotConfig(
      this.loadedConfig.raw.bots.teams,
      resolveChannelIdentityBotId(identity),
    );
    let resolved: SurfaceNotificationsConfig = {
      queueStart: channelConfig.surfaceNotifications?.queueStart ?? "brief",
      loopStart: channelConfig.surfaceNotifications?.loopStart ?? "brief",
    };
    if (identity.conversationKind === "dm") {
      const directMessageConfig = resolveTeamsDirectMessageConfig(
        channelConfig,
        identity.senderId,
      );
      return {
        ...resolved,
        ...(directMessageConfig?.surfaceNotifications ?? {}),
      };
    }
    const conversationId = (identity.chatId ?? identity.channelId)?.trim();
    const isChannel = identity.conversationKind === "channel";
    const routeCollection = isChannel ? channelConfig.channels : channelConfig.groupChats;
    const groupRoute = conversationId
      ? routeCollection[conversationId] ?? routeCollection["*"]
      : undefined;
    resolved = {
      ...resolved,
      ...(groupRoute?.surfaceNotifications ?? {}),
    };
    return resolved;
  }

  private resolveChannelSurfaceModes(identity: ChannelIdentity) {
    if (identity.platform === "slack") {
      return this.resolveSlackSurfaceModes(identity);
    }
    if (identity.platform === "teams") {
      return this.resolveTeamsSurfaceModes(identity);
    }
    return this.resolveTelegramSurfaceModes(identity);
  }

  private resolveSlackSurfaceModes(identity: ChannelIdentity) {
    const channelConfig = resolveSlackBotConfig(
      this.loadedConfig.raw.bots.slack,
      resolveChannelIdentityBotId(identity),
    );
    const directMessageConfig = identity.conversationKind === "dm"
      ? resolveSlackDirectMessageConfig(channelConfig, identity.senderId)
      : undefined;
    return {
      responseMode: directMessageConfig?.responseMode ?? channelConfig.responseMode,
      streaming: directMessageConfig?.streaming ?? channelConfig.streaming,
    };
  }

  private resolveTelegramSurfaceModes(identity: ChannelIdentity) {
    const channelConfig = resolveTelegramBotConfig(
      this.loadedConfig.raw.bots.telegram,
      resolveChannelIdentityBotId(identity),
    );
    const directMessageConfig = identity.conversationKind === "dm"
      ? resolveTelegramDirectMessageConfig(channelConfig, identity.senderId)
      : undefined;
    return {
      responseMode: directMessageConfig?.responseMode ?? channelConfig.responseMode,
      streaming: directMessageConfig?.streaming ?? channelConfig.streaming,
    };
  }

  private resolveTeamsSurfaceModes(identity: ChannelIdentity) {
    const channelConfig = resolveTeamsBotConfig(
      this.loadedConfig.raw.bots.teams,
      resolveChannelIdentityBotId(identity),
    );
    const directMessageConfig = identity.conversationKind === "dm"
      ? resolveTeamsDirectMessageConfig(channelConfig, identity.senderId)
      : undefined;
    return {
      responseMode: directMessageConfig?.responseMode ?? channelConfig.responseMode,
      streaming: directMessageConfig?.streaming ?? channelConfig.streaming,
    };
  }
}
