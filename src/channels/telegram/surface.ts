import type {
  MessageChildSurfaceSelector,
  ResolvedMessageSurface,
} from "../message/message-command.ts";
import type { ChannelIdentity } from "../surface/channel-identity.ts";
import type { SurfacePromptContext } from "../surface/surface-prompt-context.ts";

export type TelegramResolvedMessageSurface = ResolvedMessageSurface<{
  chatId: number;
  chatType: "private" | "supergroup";
  topicId?: number;
  isForum: boolean;
}> & {
  channel: "telegram";
};

export function resolveTelegramSurface(params: {
  rawTarget?: string;
  childSurface?: MessageChildSurfaceSelector;
  surface?: ResolvedMessageSurface | null;
}): TelegramResolvedMessageSurface | null {
  if (params.surface?.channel === "telegram") {
    return params.surface as TelegramResolvedMessageSurface;
  }
  if (!params.rawTarget) {
    return null;
  }
  const chatId = Number(params.rawTarget);
  if (!Number.isFinite(chatId)) {
    return null;
  }

  const rawTopicId =
    params.childSurface?.kind === "topic" ? params.childSurface.providerId : undefined;
  const topicId = rawTopicId ? Number(rawTopicId) : undefined;
  if (rawTopicId && !Number.isFinite(topicId)) {
    return null;
  }

  const baseSurfaceId = `telegram:${chatId > 0 ? "dm" : "group"}:${chatId}`;
  return {
    channel: "telegram",
    rawTarget: params.rawTarget,
    surfaceKind: Number.isFinite(topicId) ? "topic" : chatId > 0 ? "dm" : "group",
    surfaceId:
      Number.isFinite(topicId) ? `telegram:topic:${chatId}:${topicId}` : baseSurfaceId,
    parentSurfaceId: Number.isFinite(topicId) ? `telegram:group:${chatId}` : undefined,
    childSurface: Number.isFinite(topicId)
      ? {
          kind: "topic",
          providerId: String(topicId),
        }
      : undefined,
    provider: {
      chatId,
      chatType: chatId > 0 ? "private" : "supergroup",
      topicId: Number.isFinite(topicId) ? topicId : undefined,
      isForum: Number.isFinite(topicId),
    },
  };
}

export function buildTelegramPromptSurface(
  identity: ChannelIdentity,
): SurfacePromptContext["surface"] {
  if (identity.conversationKind === "topic") {
    return {
      platform: "telegram",
      surfaceId: `telegram:topic:${identity.chatId ?? ""}:${identity.topicId ?? ""}`,
      providerId: identity.topicId,
      kind: "topic",
      displayName: identity.topicName,
      parent: {
        platform: "telegram",
        surfaceId: `telegram:group:${identity.chatId ?? ""}`,
        providerId: identity.chatId,
        kind: "group",
        displayName: identity.chatName,
      },
    };
  }

  const kind = identity.conversationKind === "dm" ? "dm" : "group";
  return {
    platform: "telegram",
    surfaceId: `telegram:${kind}:${identity.chatId ?? ""}`,
    providerId: identity.chatId,
    kind,
    displayName: identity.chatName,
  };
}
