import type { ClisbotConfig } from "../../config/core/schema.ts";
import { resolveChannelIdentityBotId } from "../surface/channel-identity.ts";
import type { ChannelSurfaceConfigTargetContract } from "../config/surface-config-target-contract.ts";
import {
  resolveDirectMessageTargetBinding,
  resolveSurfaceTargetBot,
} from "../config/surface-config-target-contract.ts";

function resolveZaloBotTargetBinding(
  config: ClisbotConfig,
  botId: string | undefined,
  rawTarget?: string,
) {
  const resolved = resolveSurfaceTargetBot({
    config,
    configBotKey: "zaloBot",
    channel: "zalo-bot",
    botId,
  });
  const resolvedBotId = resolved.botId;
  const bot = resolved.bot as Record<string, unknown> & {
    directMessages: Record<string, Record<string, unknown>>;
    groups: Record<string, Record<string, unknown>>;
  };

  if (!rawTarget) {
    return {
      label: `zalo-bot bot ${resolvedBotId}`,
      getExactSource: () => bot,
      getFallbackSources: () => [],
      ensureWritableSource: () => bot,
    };
  }

  const [kind, routeId] = rawTarget.split(":", 2);
  if (kind === "dm") {
    return resolveDirectMessageTargetBinding({
      channel: "zalo-bot",
      targetId: routeId ?? "",
      bot,
    });
  }

  if (kind === "group") {
    const chatId = routeId?.trim();
    if (!chatId) {
      throw new Error("zalo-bot target must use group:<chatId> or dm:<id>.");
    }
    const route = bot.groups[chatId];
    if (!route) {
      throw new Error(`Route not configured yet: zalo-bot group:${chatId}. Add the route first.`);
    }
    return {
      label: `zalo-bot group:${chatId}`,
      getExactSource: () => route,
      getFallbackSources: () => [bot],
      ensureWritableSource: () => route,
    };
  }

  throw new Error("zalo-bot target must use dm:<id|*> or group:<chatId>.");
}

export const zaloBotSurfaceConfigTargetContract = {
  channel: "zalo-bot",
  resolveConfiguredSurfaceTargetBinding: (config, params) =>
    resolveZaloBotTargetBinding(config, params.botId, params.target),
  buildConfiguredTargetFromIdentity: (identity) => ({
    channel: "zalo-bot",
    botId: resolveChannelIdentityBotId(identity),
    target:
      identity.conversationKind === "dm"
        ? `dm:${identity.senderId ?? identity.chatId ?? "*"}`
        : `group:${identity.chatId ?? ""}`,
  }),
} satisfies ChannelSurfaceConfigTargetContract;

export default zaloBotSurfaceConfigTargetContract;
