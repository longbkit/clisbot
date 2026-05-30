import type { ClisbotConfig } from "../../config/core/schema.ts";
import type { ChannelSurfaceConfigTargetContract } from "../config/surface-config-target-contract.ts";
import {
  resolveDirectMessageTargetBinding,
  resolveSurfaceTargetBot,
} from "../config/surface-config-target-contract.ts";
import { resolveChannelIdentityBotId } from "../surface/channel-identity.ts";

function resolveApiTargetBinding(
  config: ClisbotConfig,
  botId: string | undefined,
  rawTarget?: string,
) {
  const resolved = resolveSurfaceTargetBot({
    config,
    configBotKey: "api",
    channel: "api",
    botId,
  });
  const bot = resolved.bot as Record<string, unknown> & {
    directMessages: Record<string, Record<string, unknown>>;
    groups: Record<string, Record<string, unknown>>;
  };

  if (!rawTarget) {
    return {
      label: `api bot ${resolved.botId}`,
      getExactSource: () => bot,
      getFallbackSources: () => [],
      ensureWritableSource: () => bot,
    };
  }

  const separatorIndex = rawTarget.indexOf(":");
  const kind = separatorIndex >= 0 ? rawTarget.slice(0, separatorIndex) : rawTarget;
  const targetId = separatorIndex >= 0 ? rawTarget.slice(separatorIndex + 1) : "";
  if (kind === "dm") {
    return resolveDirectMessageTargetBinding({
      channel: "api",
      targetId: targetId ?? "",
      bot,
    });
  }
  if (kind === "group") {
    const routeKey = targetId?.trim();
    if (!routeKey) {
      throw new Error("api target must use dm:<surface-id> or group:<surface-id>.");
    }
    const route = bot.groups[routeKey];
    if (!route) {
      throw new Error(`Route not configured yet: api group:${routeKey}. Add the route first.`);
    }
    return {
      label: `api group:${routeKey}`,
      getExactSource: () => route,
      getFallbackSources: () => [bot],
      ensureWritableSource: () => route,
    };
  }

  throw new Error("api target must use dm:<surface-id> or group:<surface-id>.");
}

export const apiSurfaceConfigTargetContract = {
  channel: "api",
  resolveConfiguredSurfaceTargetBinding: (config, params) =>
    resolveApiTargetBinding(config, params.botId, params.target),
  buildConfiguredTargetFromIdentity: (identity) => {
    const surfaceId = identity.conversationKind === "dm"
      ? identity.chatId ?? identity.channelId ?? identity.senderId ?? "*"
      : identity.channelId ?? identity.chatId ?? "*";
    return {
      channel: "api",
      botId: resolveChannelIdentityBotId(identity),
      target: `${identity.conversationKind === "dm" ? "dm" : "group"}:${surfaceId}`,
    };
  },
} satisfies ChannelSurfaceConfigTargetContract;

export default apiSurfaceConfigTargetContract;
