import type {
  MessageChildSurfaceSelector,
  ResolvedMessageSurface,
} from "../message/message-command.ts";
import type { ChannelIdentity } from "../surface/channel-identity.ts";
import type { SurfacePromptContext } from "../surface/surface-prompt-context.ts";

export type ZaloBotResolvedMessageSurface = ResolvedMessageSurface<{
  chatId: string;
  chatType: "PRIVATE" | "GROUP";
}> & {
  channel: "zalo-bot";
};

function parseZaloBotTarget(rawTarget: string) {
  const target = rawTarget.trim();
  if (!target) {
    return null;
  }
  const [kind, routeId] = target.split(":", 2);
  if (kind === "dm" || kind === "group") {
    const chatId = routeId?.trim();
    if (!chatId) {
      return null;
    }
    return {
      chatId,
      chatType: kind === "group" ? ("GROUP" as const) : ("PRIVATE" as const),
    };
  }
  return {
    chatId: target,
    chatType: "PRIVATE" as const,
  };
}

export function resolveZaloBotSurface(params: {
  rawTarget?: string;
  childSurface?: MessageChildSurfaceSelector;
  surface?: ResolvedMessageSurface | null;
}): ZaloBotResolvedMessageSurface | null {
  if (params.surface?.channel === "zalo-bot") {
    return params.surface as ZaloBotResolvedMessageSurface;
  }
  if (!params.rawTarget) {
    return null;
  }

  const target = parseZaloBotTarget(params.rawTarget);
  if (!target) {
    return null;
  }

  const isGroup = target.chatType === "GROUP";
  return {
    channel: "zalo-bot",
    rawTarget: params.rawTarget,
    surfaceKind: isGroup ? "group" : "dm",
    surfaceId: `zalo-bot:${isGroup ? "group" : "dm"}:${target.chatId}`,
    childSurface: params.childSurface,
    provider: {
      chatId: target.chatId,
      chatType: target.chatType,
    },
  };
}

export function buildZaloBotPromptSurface(
  identity: ChannelIdentity,
): SurfacePromptContext["surface"] {
  const kind = identity.conversationKind === "dm" ? "dm" : "group";
  return {
    platform: "zalo-bot",
    surfaceId: `zalo-bot:${kind}:${identity.chatId ?? ""}`,
    providerId: identity.chatId,
    kind,
    displayName: identity.chatName,
  };
}
