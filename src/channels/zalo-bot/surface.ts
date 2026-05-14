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

  const chatId = params.rawTarget.trim();
  if (!chatId) {
    return null;
  }

  const isGroup = chatId.startsWith("g");
  return {
    channel: "zalo-bot",
    rawTarget: params.rawTarget,
    surfaceKind: isGroup ? "group" : "dm",
    surfaceId: `zalo-bot:${isGroup ? "group" : "dm"}:${chatId}`,
    childSurface: params.childSurface,
    provider: {
      chatId,
      chatType: isGroup ? "GROUP" : "PRIVATE",
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
