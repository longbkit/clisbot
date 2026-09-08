// upstream: extensions/googlechat/src/targets.ts@5d8067a4483
// Googlechat plugin module implements targets behavior.
import { normalizeLowercaseStringOrEmpty } from "@getpaseo/channels-core/plugin-sdk/string-coerce-runtime";
import type { ResolvedGoogleChatAccount } from "./accounts.js";
import { findGoogleChatDirectMessage } from "./api.js";
import type { GoogleChatSpace } from "./types.js";

export function normalizeGoogleChatTarget(raw?: string | null): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  const withoutPrefix = trimmed.replace(/^(googlechat|google-chat|gchat):/i, "");
  const normalized = withoutPrefix
    .replace(/^user:(users\/)?/i, "users/")
    .replace(/^space:(spaces\/)?/i, "spaces/");
  if (isGoogleChatUserTarget(normalized)) {
    const suffix = normalized.slice("users/".length);
    return suffix.includes("@") ? `users/${normalizeLowercaseStringOrEmpty(suffix)}` : normalized;
  }
  if (isGoogleChatSpaceTarget(normalized)) {
    return normalized;
  }
  if (normalized.includes("@")) {
    return `users/${normalizeLowercaseStringOrEmpty(normalized)}`;
  }
  return normalized;
}

export function isGoogleChatUserTarget(value: string): boolean {
  return normalizeLowercaseStringOrEmpty(value).startsWith("users/");
}

export function isGoogleChatSpaceTarget(value: string): boolean {
  return normalizeLowercaseStringOrEmpty(value).startsWith("spaces/");
}

function resolveGoogleChatSpaceChatType(space: GoogleChatSpace): "direct" | "group" | undefined {
  const spaceType = (space.spaceType ?? "").toUpperCase();
  // The current field wins when both current and deprecated fields are present.
  if (spaceType === "DIRECT_MESSAGE") {
    return "direct";
  }
  if (spaceType === "SPACE" || spaceType === "GROUP_CHAT") {
    return "group";
  }
  if (space.singleUserBotDm === true || (space.type ?? "").toUpperCase() === "DM") {
    return "direct";
  }
  if ((space.type ?? "").toUpperCase() === "ROOM") {
    return "group";
  }
  return undefined;
}

export function isGoogleChatGroupSpace(space: GoogleChatSpace): boolean {
  // Legacy webhook payloads can omit type metadata. Preserve their historical
  // group default while outbound routing requires an exact API classification.
  return resolveGoogleChatSpaceChatType(space) !== "direct";
}

function stripMessageSuffix(target: string): string {
  const index = target.indexOf("/messages/");
  if (index === -1) {
    return target;
  }
  return target.slice(0, index);
}

async function resolveGoogleChatOutboundSpaceDetails(params: {
  account: ResolvedGoogleChatAccount;
  target: string;
}): Promise<{ name: string; resource?: GoogleChatSpace }> {
  const normalized = normalizeGoogleChatTarget(params.target);
  if (!normalized) {
    throw new Error("Missing Google Chat target.");
  }
  const base = stripMessageSuffix(normalized);
  if (isGoogleChatSpaceTarget(base)) {
    return { name: base };
  }
  if (isGoogleChatUserTarget(base)) {
    const dm = await findGoogleChatDirectMessage({
      account: params.account,
      userName: base,
    });
    if (!dm?.name) {
      throw new Error(`No Google Chat DM found for ${base}`);
    }
    return { name: dm.name, resource: dm };
  }
  return { name: base };
}

export async function resolveGoogleChatOutboundSpace(params: {
  account: ResolvedGoogleChatAccount;
  target: string;
}): Promise<string> {
  return (await resolveGoogleChatOutboundSpaceDetails(params)).name;
}

// D-GC-011: upstream's `resolveGoogleChatOutboundSessionRoute` is omitted. It
// builds an OpenClaw outbound session key through
// `buildChannelOutboundSessionRoute` (`src/plugin-sdk/core.ts` →
// `src/infra/outbound/base-session-key.ts` → the OpenClaw session-key routing
// tree). Fusion's Hub owns session keys and thread bindings, so the vertical
// has no session to route; the space classification the function existed to
// obtain is exported above (`isGoogleChatGroupSpace`,
// `resolveGoogleChatOutboundSpace`) and the Hub reads it directly.
