/**
 * What a Channel supports, from the Hub's catalog: the capabilities its
 * integration implements, the ones it implements with a limit, and the rest.
 *
 * This describes the Channel, not a Connection. Whether a Connection is up is
 * its own status (`channel-account-health.ts`); the Hub keeps no per-capability
 * evidence, so a per-Connection "verified" state would only ever read "not
 * verified" (2026-09-19 decision, docs/audits/2026-09-19-connection-naming-and-route-flow.md).
 */
import { i18n } from "@/i18n/i18next";
import type { ChannelCatalogEntry } from "./channel-catalog";

export type ChannelTransportState =
  | "starting"
  | "started"
  | "deferred"
  | "stopped"
  | "failed"
  /** A QR-auth account whose profile has no live session. */
  | "needs-login"
  | "disabled";

export const CHANNEL_CAPABILITY_LABELS: Readonly<Record<string, () => string>> = {
  text: () => i18n.t("hub.channels.capability.text"),
  thread: () => i18n.t("hub.channels.capability.thread"),
  mention: () => i18n.t("hub.channels.capability.mention"),
  format: () => i18n.t("hub.channels.capability.format"),
  chunk: () => i18n.t("hub.channels.capability.chunk"),
  media: () => i18n.t("hub.channels.capability.media"),
  file: () => i18n.t("hub.channels.capability.file"),
  reaction: () => i18n.t("hub.channels.capability.reaction"),
  edit: () => i18n.t("hub.channels.capability.edit"),
  delete: () => i18n.t("hub.channels.capability.delete"),
  voice: () => i18n.t("hub.channels.capability.voice"),
  video: () => i18n.t("hub.channels.capability.video"),
  "video-note": () => i18n.t("hub.channels.capability.videoNote"),
  location: () => i18n.t("hub.channels.capability.location"),
  poll: () => i18n.t("hub.channels.capability.poll"),
  topic: () => i18n.t("hub.channels.capability.topic"),
  presentation: () => i18n.t("hub.channels.capability.presentation"),
  buttons: () => i18n.t("hub.channels.capability.buttons"),
  select: () => i18n.t("hub.channels.capability.select"),
  approval: () => i18n.t("hub.channels.capability.approval"),
  "native-actions": () => i18n.t("hub.channels.capability.nativeActions"),
  "group-dm": () => i18n.t("hub.channels.capability.groupDm"),
  "emoji-discovery": () => i18n.t("hub.channels.capability.emojiDiscovery"),
  visibility: () => i18n.t("hub.channels.capability.visibility"),
};

/**
 * Capabilities the catalog lists but its own notes narrow. Each entry restates
 * a note on the matching catalog entry; nothing is invented here.
 */
const CAPABILITY_RESTRICTIONS: Readonly<Record<string, Readonly<Record<string, () => string>>>> = {
  discord: {
    reaction: () => i18n.t("hub.channels.capabilityLimit.discordReaction"),
    "native-actions": () => i18n.t("hub.channels.capabilityLimit.discordNativeActions"),
  },
  googlechat: {
    buttons: () => i18n.t("hub.channels.capabilityLimit.cardClicks"),
    select: () => i18n.t("hub.channels.capabilityLimit.cardClicks"),
  },
  feishu: {
    buttons: () => i18n.t("hub.channels.capabilityLimit.larkCardClicks"),
    select: () => i18n.t("hub.channels.capabilityLimit.larkCardClicks"),
  },
  zalo: {
    media: () => i18n.t("hub.channels.capabilityLimit.zaloMedia"),
  },
};

export function channelCapabilityLabel(capability: string): string {
  return CHANNEL_CAPABILITY_LABELS[capability]?.() ?? capability;
}

export interface ChannelSupport {
  /** Labels of what the Channel supports, in vocabulary order. */
  supported: string[];
  /** Supported with a limit its catalog notes state. */
  limited: { label: string; limit: string }[];
  /** Labels of the vocabulary the Channel does not support. */
  unsupported: string[];
}

export function channelSupport(entry: ChannelCatalogEntry): ChannelSupport {
  const claimed = new Set(entry.capabilities);
  const limits = CAPABILITY_RESTRICTIONS[entry.id] ?? {};
  const support: ChannelSupport = { supported: [], limited: [], unsupported: [] };
  for (const capability of Object.keys(CHANNEL_CAPABILITY_LABELS)) {
    const label = channelCapabilityLabel(capability);
    const limit = limits[capability];
    if (!claimed.has(capability)) support.unsupported.push(label);
    else if (limit === undefined) support.supported.push(label);
    else support.limited.push({ label, limit: limit() });
  }
  return support;
}
