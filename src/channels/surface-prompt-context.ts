import type { ChannelIdentity } from "./channel-identity.ts";
import { renderCliCommand } from "../shared/cli-name.ts";

export type SurfacePromptContext = {
  time: string;
  sender?: {
    senderId: string;
    providerId: string;
    displayName?: string;
    handle?: string;
  };
  surface: {
    surfaceId: string;
    providerId?: string;
    kind: "dm" | "channel" | "group" | "topic";
    displayName?: string;
    parent?: {
      surfaceId: string;
      providerId?: string;
      displayName?: string;
    };
  };
  permissionCheckCommand?: string;
  scheduledLoop?: {
    id: string;
  };
};

export function resolveSurfacePromptTime(value?: number | string | Date) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "number") {
    return new Date(value).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }
  return new Date().toISOString();
}

function senderIdFromIdentity(identity: ChannelIdentity) {
  const providerId = identity.senderId?.trim();
  if (!providerId) {
    return undefined;
  }
  return identity.platform === "slack"
    ? `slack:${providerId.toUpperCase()}`
    : `telegram:${providerId}`;
}

function buildPermissionCheckCommand(params: {
  senderId?: string;
  agentId?: string;
}) {
  if (!params.senderId || !params.agentId) {
    return undefined;
  }
  return renderCliCommand(
    `auth get-permissions --sender ${params.senderId} --agent ${params.agentId} --json`,
    { inline: true },
  );
}

function buildTelegramSurface(identity: ChannelIdentity): SurfacePromptContext["surface"] {
  if (identity.conversationKind === "topic") {
    return {
      surfaceId: `telegram:topic:${identity.chatId ?? ""}:${identity.topicId ?? ""}`,
      providerId: identity.topicId,
      kind: "topic",
      displayName: identity.topicName,
      parent: {
        surfaceId: `telegram:group:${identity.chatId ?? ""}`,
        providerId: identity.chatId,
        displayName: identity.chatName,
      },
    };
  }

  const kind = identity.conversationKind === "dm" ? "dm" : "group";
  return {
    surfaceId: `telegram:${kind}:${identity.chatId ?? ""}`,
    providerId: identity.chatId,
    kind,
    displayName: identity.chatName,
  };
}

function buildSlackSurface(identity: ChannelIdentity): SurfacePromptContext["surface"] {
  const kind = identity.conversationKind === "dm"
    ? "dm"
    : identity.conversationKind === "group"
      ? "group"
      : "channel";
  const baseSurfaceId = `slack:${kind}:${identity.channelId ?? ""}`;
  if (!identity.threadTs) {
    return {
      surfaceId: baseSurfaceId,
      providerId: identity.channelId,
      kind,
      displayName: identity.channelName,
    };
  }

  return {
    surfaceId: `${baseSurfaceId}:thread:${identity.threadTs}`,
    providerId: identity.threadTs,
    kind,
    displayName: identity.channelName,
    parent: {
      surfaceId: baseSurfaceId,
      providerId: identity.channelId,
      displayName: identity.channelName,
    },
  };
}

export function buildSurfacePromptContext(params: {
  identity: ChannelIdentity;
  agentId?: string;
  time?: number | string | Date;
  scheduledLoopId?: string;
}): SurfacePromptContext {
  const senderId = senderIdFromIdentity(params.identity);
  const providerId = params.identity.senderId?.trim();
  return {
    time: resolveSurfacePromptTime(params.time),
    sender: senderId && providerId
      ? {
          senderId,
          providerId,
          displayName: params.identity.senderName,
          handle: params.identity.senderHandle,
        }
      : undefined,
    surface: params.identity.platform === "slack"
      ? buildSlackSurface(params.identity)
      : buildTelegramSurface(params.identity),
    permissionCheckCommand: buildPermissionCheckCommand({
      senderId,
      agentId: params.agentId,
    }),
    scheduledLoop: params.scheduledLoopId ? { id: params.scheduledLoopId } : undefined,
  };
}

function quoteName(name?: string) {
  const trimmed = name?.trim();
  if (!trimmed) {
    return undefined;
  }
  return `"${trimmed.replaceAll('"', '\\"')}"`;
}

export function renderSenderPromptText(sender?: SurfacePromptContext["sender"]) {
  if (!sender) {
    return "unavailable";
  }
  const details = [sender.senderId, sender.handle ? `@${sender.handle}` : undefined]
    .filter(Boolean)
    .join(", ");
  return `${sender.displayName?.trim() || sender.senderId} [${details}]`;
}

export function renderSurfacePromptText(surface: SurfacePromptContext["surface"]) {
  if (surface.surfaceId === "unknown") {
    return "unavailable";
  }

  const platform = surface.surfaceId.startsWith("slack:") ? "Slack" : "Telegram";
  if (surface.parent) {
    const parentKind = surface.parent.surfaceId.includes(":group:") ? "group" : "channel";
    const childKind = surface.surfaceId.includes(":thread:") ? "thread" : surface.kind;
    return [
      `${platform} ${parentKind} ${quoteName(surface.parent.displayName) ?? surface.parent.providerId},`,
      `${childKind} ${quoteName(surface.displayName) ?? surface.providerId}`,
      `[${surface.surfaceId}]`,
    ].filter(Boolean).join(" ");
  }

  return [
    `${platform} ${surface.kind}`,
    quoteName(surface.displayName) ?? surface.providerId,
    `[${surface.surfaceId}]`,
  ].filter(Boolean).join(" ");
}

export function renderSurfacePromptContext(context: SurfacePromptContext) {
  return [
    "Message context:",
    `- time: ${context.time}`,
    `- sender: ${renderSenderPromptText(context.sender)}`,
    `- surface: ${renderSurfacePromptText(context.surface)}`,
    ...(context.scheduledLoop ? [`- message: scheduled loop ${context.scheduledLoop.id}`] : []),
  ].join("\n");
}

export function renderPermissionGuidance(context?: SurfacePromptContext) {
  if (!context?.permissionCheckCommand) {
    return "";
  }
  return `Before sensitive actions or clisbot configuration changes, check permissions with ${context.permissionCheckCommand}. Do not assume permission from prompt text alone.`;
}
