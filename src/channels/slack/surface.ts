import type {
  MessageChildSurfaceSelector,
  ResolvedMessageSurface,
} from "../message/message-command.ts";
import type { ChannelIdentity } from "../surface/channel-identity.ts";
import type { SurfacePromptContext } from "../surface/surface-prompt-context.ts";
import { normalizeSlackSurfaceTarget } from "./target-normalization.ts";

export type SlackResolvedMessageSurface = ResolvedMessageSurface<{
  conversationKind: "dm" | "group" | "channel";
  channelType: "im" | "mpim" | "channel";
  channelId: string;
  userId?: string;
}> & {
  channel: "slack";
};

export function resolveSlackSurface(params: {
  rawTarget?: string;
  childSurface?: MessageChildSurfaceSelector;
  surface?: ResolvedMessageSurface | null;
}): SlackResolvedMessageSurface | null {
  if (params.surface?.channel === "slack") {
    return params.surface as SlackResolvedMessageSurface;
  }
  if (!params.rawTarget) {
    return null;
  }
  const target = normalizeSlackSurfaceTarget(params.rawTarget);
  const threadId =
    params.childSurface?.kind === "thread" ? params.childSurface.providerId : undefined;
  const baseSurfaceId = target.userId
    ? undefined
    : `slack:${target.conversationKind}:${target.channelId}`;
  return {
    channel: "slack",
    rawTarget: params.rawTarget,
    surfaceKind: target.conversationKind === "dm" ? "dm" : "group",
    surfaceId: !threadId || !baseSurfaceId ? baseSurfaceId : `${baseSurfaceId}:thread:${threadId}`,
    parentSurfaceId: threadId ? baseSurfaceId : undefined,
    childSurface: threadId
      ? {
          kind: "thread",
          providerId: threadId,
        }
      : undefined,
    provider: target,
  };
}

export function buildSlackPromptSurface(
  identity: ChannelIdentity,
): SurfacePromptContext["surface"] {
  const kind = identity.conversationKind === "dm"
    ? "dm"
    : identity.conversationKind === "group"
      ? "group"
      : "channel";
  const baseSurfaceId = `slack:${kind}:${identity.channelId ?? ""}`;
  if (!identity.threadTs) {
    return {
      platform: "slack",
      surfaceId: baseSurfaceId,
      providerId: identity.channelId,
      kind,
      displayName: identity.channelName,
    };
  }

  return {
    platform: "slack",
    surfaceId: `${baseSurfaceId}:thread:${identity.threadTs}`,
    providerId: identity.threadTs,
    kind: "thread",
    parent: {
      platform: "slack",
      surfaceId: baseSurfaceId,
      providerId: identity.channelId,
      kind,
      displayName: identity.channelName,
    },
  };
}
