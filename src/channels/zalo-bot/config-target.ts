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
    throw new Error("zalo-bot targets support DM routes only; use dm:<id|*>.");
  }

  throw new Error("zalo-bot target must use dm:<id|*>.");
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
        : undefined,
  }),
} satisfies ChannelSurfaceConfigTargetContract;

export default zaloBotSurfaceConfigTargetContract;
