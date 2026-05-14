import { buildAgentPromptText } from "../../channels/message/agent-prompt.ts";
import type { ChannelId } from "../../channels/integration/channel-surface-contract.ts";
import {
  resolveChannelIdentityBotId,
  type ChannelIdentity,
} from "../../channels/surface/channel-identity.ts";
import { getChannelPlugin } from "../../channels/catalog/registry.ts";
import { renderPlatformInteraction } from "../../channels/message/rendering.ts";
import { buildSurfacePromptContextWithDirectory } from "../../channels/surface/surface-directory.ts";
import {
  renderLoopStartNotification,
  renderQueueStartNotification,
  type SurfaceNotificationsConfig,
} from "../../channels/config/surface-notifications.ts";
import { getAgentEntry, type LoadedConfig } from "../../config/core/load-config.ts";
import type { RunUpdate } from "../session/run-observation.ts";
import type { StoredLoop, StoredLoopSurfaceBinding } from "../loops/loop-state.ts";
import type { StoredQueueItem } from "../queue/queue-state.ts";
import type { AgentSessionTarget } from "../routing/resolved-target.ts";

export type SurfaceNotificationRequest = {
  binding: StoredLoopSurfaceBinding;
  text: string;
};

export type SurfaceNotificationHandler = (request: SurfaceNotificationRequest) => Promise<void>;

export type SurfaceNotificationRegistration = SurfaceNotificationTarget & {
  handler: SurfaceNotificationHandler;
};

export type SurfaceNotificationTarget = {
  platform: ChannelId;
  botId?: string;
};

export class SurfaceRuntime {
  private surfaceNotificationHandlers = new Map<string, SurfaceNotificationHandler>();

  constructor(private readonly loadedConfig: LoadedConfig) {}

  registerSurfaceNotificationHandler(params: SurfaceNotificationRegistration) {
    this.surfaceNotificationHandlers.set(
      this.getSurfaceNotificationHandlerKey(params.platform, params.botId),
      params.handler,
    );
  }

  unregisterSurfaceNotificationHandler(params: SurfaceNotificationTarget) {
    this.surfaceNotificationHandlers.delete(
      this.getSurfaceNotificationHandlerKey(params.platform, params.botId),
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
    const runtimeContext = this.resolveBoundSurfaceRuntimeContext(identity);
    const mode = loop.loopStart ?? runtimeContext.surfaceNotifications.loopStart;
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
    const runtimeContext = this.resolveBoundSurfaceRuntimeContext(identity);
    const text = renderQueueStartNotification({
      mode: runtimeContext.surfaceNotifications.queueStart,
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
    const promptSummary = item.promptSummary.trim();
    const content = promptSummary
      ? `Prompt: ${promptSummary}\n\n${update.snapshot}`
      : update.snapshot;
    const text = renderPlatformInteraction({
      platform: identity.platform,
      status: update.status,
      content,
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
    const runtimeContext = this.resolveBoundSurfaceRuntimeContext(identity);
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
      config: runtimeContext.promptConfig,
      cliTool: getAgentEntry(this.loadedConfig, agentId)?.cli,
      responseMode: runtimeContext.responseMode,
      streaming: runtimeContext.streaming,
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
    const runtimeContext = this.resolveBoundSurfaceRuntimeContext(identity);
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
      config: runtimeContext.promptConfig,
      cliTool: getAgentEntry(this.loadedConfig, agentId)?.cli,
      responseMode: runtimeContext.responseMode,
      streaming: runtimeContext.streaming,
      protectedControlMutationRule: item.protectedControlMutationRule,
      agentId,
      time: promptTime,
      promptContext,
    });
  }

  private getSurfaceNotificationHandlerKey(
    platform: ChannelId,
    botId?: string,
  ) {
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

  private buildLoopChannelIdentity(loop: StoredLoop): ChannelIdentity {
    const binding = loop.surfaceBinding!;
    const sender = loop.sender;
    return {
      platform: binding.platform,
      botId: resolveChannelIdentityBotId(binding),
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
      botId: resolveChannelIdentityBotId(binding),
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

  private resolveBoundSurfaceRuntimeContext(identity: ChannelIdentity) {
    const plugin = getChannelPlugin(identity.platform);
    const context = plugin?.resolveBoundSurfaceRuntimeContext?.({
      loadedConfig: this.loadedConfig,
      identity,
    });
    if (!context) {
      throw new Error(`Channel ${identity.platform} does not support bound surface runtime context.`);
    }
    return context;
  }
}
