/**
 * What a Channel supports, from the Hub's catalog: the capabilities its
 * integration implements, the ones it implements with a limit, and the rest.
 *
 * This describes the Channel, not a Connection. Whether a Connection is up is
 * its own status (`channel-account-health.ts`); the Hub keeps no per-capability
 * evidence, so a per-Connection "verified" state would only ever read "not
 * verified" (2026-09-19 decision, docs/audits/2026-09-19-connection-naming-and-route-flow.md).
 */
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

export const CHANNEL_CAPABILITY_LABELS: Readonly<Record<string, string>> = {
  text: "Text messages",
  thread: "Threads",
  mention: "Mentions",
  format: "Rich formatting",
  chunk: "Long-message chunking",
  media: "Media",
  file: "File attachments",
  reaction: "Reactions",
  edit: "Edit messages",
  delete: "Delete messages",
  voice: "Voice messages",
  video: "Video",
  "video-note": "Video notes",
  location: "Location",
  poll: "Polls",
  topic: "Forum topics",
  presentation: "Tables and charts",
  buttons: "Buttons",
  select: "Select menus",
  approval: "Approval prompts",
  "native-actions": "Native commands",
  "group-dm": "Group DMs",
  "emoji-discovery": "Emoji discovery",
  visibility: "Public and private groups",
};

/**
 * Capabilities the catalog lists but its own notes narrow. Each entry restates
 * a note on the matching catalog entry; nothing is invented here.
 */
const CAPABILITY_RESTRICTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  discord: {
    reaction: "Outbound reactions only; inbound reaction events are not wired yet.",
    "native-actions": "Slash commands and interaction callbacks are not wired yet.",
  },
  googlechat: {
    buttons: "Card clicks arrive inbound; the Hub renders no card of its own.",
    select: "Card clicks arrive inbound; the Hub renders no card of its own.",
  },
  feishu: {
    buttons: "Card clicks arrive inbound; the Hub renders no Lark card of its own.",
    select: "Card clicks arrive inbound; the Hub renders no Lark card of its own.",
  },
  zalo: {
    media: "Inbound images only; the Zalo Bot API has no upload endpoint.",
  },
};

export function channelCapabilityLabel(capability: string): string {
  return CHANNEL_CAPABILITY_LABELS[capability] ?? capability;
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
    else support.limited.push({ label, limit });
  }
  return support;
}
