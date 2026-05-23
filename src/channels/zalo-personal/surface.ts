import type {
  MessageChildSurfaceSelector,
  ResolvedMessageSurface,
} from "../message/message-command.ts";
import type { ChannelIdentity } from "../surface/channel-identity.ts";
import type { SurfacePromptContext } from "../surface/surface-prompt-context.ts";

export type ZaloPersonalResolvedMessageSurface = ResolvedMessageSurface<{
  conversationKind: "dm" | "group";
  chatId: string;
  userId?: string;
}> & {
  channel: "zalo-personal";
};

function parseZaloPersonalTarget(rawTarget: string) {
  const [kind, id] = rawTarget.split(":", 2);
  const chatId = id?.trim();
  if ((kind !== "dm" && kind !== "group") || !chatId) {
    throw new Error("zalo-personal target must use dm:<id> or group:<id>.");
  }
  return {
    conversationKind: kind,
    chatId,
    userId: kind === "dm" ? chatId : undefined,
  } as const;
}

export function resolveZaloPersonalSurface(params: {
  rawTarget?: string;
  childSurface?: MessageChildSurfaceSelector;
  surface?: ResolvedMessageSurface | null;
}): ZaloPersonalResolvedMessageSurface | null {
  if (params.surface?.channel === "zalo-personal") {
    return params.surface as ZaloPersonalResolvedMessageSurface;
  }
  if (!params.rawTarget) {
    return null;
  }
  if (params.childSurface) {
    throw new Error("zalo-personal does not support child surfaces.");
  }
  const target = parseZaloPersonalTarget(params.rawTarget);
  return {
    channel: "zalo-personal",
    rawTarget: params.rawTarget,
    surfaceKind: target.conversationKind,
    surfaceId: `zalo-personal:${target.conversationKind}:${target.chatId}`,
    provider: target,
  };
}

export function buildZaloPersonalPromptSurface(
  identity: ChannelIdentity,
): SurfacePromptContext["surface"] {
  const kind = identity.conversationKind === "dm" ? "dm" : "group";
  return {
    platform: "zalo-personal",
    surfaceId: `zalo-personal:${kind}:${identity.chatId ?? ""}`,
    providerId: identity.chatId,
    kind,
    displayName: identity.channelName,
  };
}
