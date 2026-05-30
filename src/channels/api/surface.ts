import type { MessageChildSurfaceSelector, ResolvedMessageSurface } from "../message/message-command.ts";
import type { ChannelIdentity } from "../surface/channel-identity.ts";
import type { SurfacePromptContext } from "../surface/surface-prompt-context.ts";

export type ApiResolvedMessageSurface = ResolvedMessageSurface<{
  surfaceKind: "dm" | "group";
  surfaceId: string;
}> & {
  channel: "api";
};

function parseTarget(rawTarget?: string) {
  const target = rawTarget?.trim();
  if (!target) {
    return null;
  }
  const separatorIndex = target.indexOf(":");
  const kind = separatorIndex >= 0 ? target.slice(0, separatorIndex) : "";
  const id = separatorIndex >= 0 ? target.slice(separatorIndex + 1) : "";
  if ((kind !== "dm" && kind !== "group") || !id) {
    return null;
  }
  return {
    kind,
    id,
  } as const;
}

export function resolveApiSurface(params: {
  rawTarget?: string;
  childSurface?: MessageChildSurfaceSelector;
  surface?: ResolvedMessageSurface | null;
}): ApiResolvedMessageSurface | null {
  if (params.surface?.channel === "api") {
    return params.surface as ApiResolvedMessageSurface;
  }
  if (params.childSurface) {
    return null;
  }
  const parsed = parseTarget(params.rawTarget);
  if (!parsed) {
    return null;
  }
  return {
    channel: "api",
    rawTarget: params.rawTarget!,
    surfaceKind: parsed.kind,
    surfaceId: `api:${parsed.kind}:${parsed.id}`,
    provider: {
      surfaceKind: parsed.kind,
      surfaceId: parsed.id,
    },
  };
}

export function buildApiPromptSurface(identity: ChannelIdentity): SurfacePromptContext["surface"] {
  const kind = identity.conversationKind === "dm" ? "dm" : "group";
  const providerId = identity.chatId ?? identity.channelId ?? "";
  return {
    platform: "api",
    surfaceId: `api:${kind}:${providerId}`,
    providerId,
    kind,
    displayName: identity.chatName ?? identity.channelName,
  };
}
