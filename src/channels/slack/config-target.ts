import type { ClisbotConfig } from "../../config/core/schema.ts";
import { resolveChannelIdentityBotId } from "../surface/channel-identity.ts";
import type { ChannelSurfaceConfigTargetContract } from "../config/surface-config-target-contract.ts";
import {
  resolveDirectMessageTargetBinding,
  resolveSurfaceTargetBot,
} from "../config/surface-config-target-contract.ts";

function resolveSlackTargetBinding(
  config: ClisbotConfig,
  botId: string | undefined,
  rawTarget?: string,
) {
  const resolved = resolveSurfaceTargetBot({
    config,
    configBotKey: "slack",
    channel: "slack",
    botId,
  });
  const resolvedBotId = resolved.botId;
  const bot = resolved.bot as Record<string, unknown> & {
    directMessages: Record<string, Record<string, unknown>>;
    groups: Record<string, Record<string, unknown>>;
  };

  if (!rawTarget) {
    return {
      label: `slack bot ${resolvedBotId}`,
      getExactSource: () => bot,
      getFallbackSources: () => [],
      ensureWritableSource: () => bot,
    };
  }

  const [kind, targetId] = rawTarget.split(":", 2);
  if (kind === "dm") {
    return resolveDirectMessageTargetBinding({
      channel: "slack",
      targetId: targetId ?? "",
      bot,
    });
  }

  if (kind === "channel" || kind === "group") {
    const routeKey = targetId?.trim();
    if (!routeKey) {
      throw new Error("slack target must use group:<id> or dm:<id>.");
    }
    const route = bot.groups[routeKey];
    if (!route) {
      throw new Error(`Route not configured yet: slack group:${routeKey}. Add the route first.`);
    }
    return {
      label: `slack group:${routeKey}`,
      getExactSource: () => route,
      getFallbackSources: () => [bot],
      ensureWritableSource: () => route,
    };
  }

  throw new Error("slack target must use group:<id> or dm:<id>.");
}

export const slackSurfaceConfigTargetContract = {
  channel: "slack",
  resolveConfiguredSurfaceTargetBinding: (config, params) =>
    resolveSlackTargetBinding(config, params.botId, params.target),
  buildConfiguredTargetFromIdentity: (identity) => ({
    channel: "slack",
    botId: resolveChannelIdentityBotId(identity),
    target:
      identity.conversationKind === "dm"
        ? `dm:${identity.senderId ?? identity.channelId ?? "*"}`
        : `group:${identity.channelId ?? ""}`,
  }),
} satisfies ChannelSurfaceConfigTargetContract;

export default slackSurfaceConfigTargetContract;
