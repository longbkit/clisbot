import type { ClisbotConfig } from "../../config/core/schema.ts";
import { resolveChannelIdentityBotId } from "../surface/channel-identity.ts";
import type { ChannelSurfaceConfigTargetContract } from "../config/surface-config-target-contract.ts";
import {
  resolveDirectMessageTargetBinding,
  resolveSurfaceTargetBot,
} from "../config/surface-config-target-contract.ts";

function resolveZaloPersonalTargetBinding(
  config: ClisbotConfig,
  botId: string | undefined,
  rawTarget?: string,
) {
  const resolved = resolveSurfaceTargetBot({
    config,
    configBotKey: "zaloPersonal",
    channel: "zalo-personal",
    botId,
  });
  const bot = resolved.bot as Record<string, unknown> & {
    directMessages: Record<string, Record<string, unknown>>;
    groups: Record<string, Record<string, unknown>>;
  };

  if (!rawTarget) {
    return {
      label: `zalo-personal bot ${resolved.botId}`,
      getExactSource: () => bot,
      getFallbackSources: () => [],
      ensureWritableSource: () => bot,
    };
  }

  const [kind, targetId] = rawTarget.split(":", 2);
  if (kind === "dm") {
    return resolveDirectMessageTargetBinding({
      channel: "zalo-personal",
      targetId: targetId ?? "",
      bot,
    });
  }

  if (kind === "group") {
    const routeKey = targetId?.trim();
    if (!routeKey) {
      throw new Error("zalo-personal target must use group:<id> or dm:<id>.");
    }
    const route = bot.groups[routeKey];
    if (!route) {
      throw new Error(`Route not configured yet: zalo-personal group:${routeKey}. Add the route first.`);
    }
    return {
      label: `zalo-personal group:${routeKey}`,
      getExactSource: () => route,
      getFallbackSources: () => [bot],
      ensureWritableSource: () => route,
    };
  }

  throw new Error("zalo-personal target must use group:<id> or dm:<id>.");
}

export const zaloPersonalSurfaceConfigTargetContract = {
  channel: "zalo-personal",
  resolveConfiguredSurfaceTargetBinding: (config, params) =>
    resolveZaloPersonalTargetBinding(config, params.botId, params.target),
  buildConfiguredTargetFromIdentity: (identity) => ({
    channel: "zalo-personal",
    botId: resolveChannelIdentityBotId(identity),
    target:
      identity.conversationKind === "dm"
        ? `dm:${identity.senderId ?? identity.chatId ?? "*"}`
        : `group:${identity.chatId ?? ""}`,
  }),
} satisfies ChannelSurfaceConfigTargetContract;

export default zaloPersonalSurfaceConfigTargetContract;
