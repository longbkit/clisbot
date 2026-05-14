import type { StoredLoopSurfaceBinding } from "../loops/loop-state.ts";
import type { MessageChildSurfaceSelector } from "../../channels/message/message-command.ts";
import {
  resolveChannelIdentityBotId,
  type ChannelIdentity,
} from "../../channels/surface/channel-identity.ts";

type SurfaceBindingIdentity = Pick<
  ChannelIdentity,
  | "platform"
  | "botId"
  | "accountId"
  | "conversationKind"
  | "channelId"
  | "channelName"
  | "chatId"
  | "chatName"
  | "threadTs"
  | "topicId"
  | "topicName"
>;

export function buildStoredSurfaceBinding(
  identity: SurfaceBindingIdentity,
): StoredLoopSurfaceBinding {
  return {
    platform: identity.platform,
    botId: resolveChannelIdentityBotId(identity),
    conversationKind: identity.conversationKind,
    channelId: identity.channelId,
    channelName: identity.channelName,
    chatId: identity.chatId,
    chatName: identity.chatName,
    threadTs: identity.threadTs,
    topicId: identity.topicId,
    topicName: identity.topicName,
  };
}

export function matchesStoredChildSurface(
  surfaceBinding: Pick<StoredLoopSurfaceBinding, "threadTs" | "topicId"> | undefined,
  childSurface: MessageChildSurfaceSelector,
) {
  if (!surfaceBinding) {
    return false;
  }
  return childSurface.kind === "thread"
    ? surfaceBinding.threadTs === childSurface.providerId
    : surfaceBinding.topicId === childSurface.providerId;
}
