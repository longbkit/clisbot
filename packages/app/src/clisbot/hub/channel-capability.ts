/**
 * The per-account capability matrix.
 *
 * The Hub publishes no per-capability evidence: `channel-accounts/status` says
 * whether a transport is up, and the catalog says what the vertical claims. That
 * is the whole input. So a running account's capability is reported as
 * `notVerified`, not `available` — the catalog is a claim, and a claim rendered
 * as a green check is how a UI starts lying. `available` is reachable only from
 * a `verified` set, which the Hub does not send today and which this model
 * already accepts so the surface flips over the day it does.
 */
import type { ChannelCatalogEntry } from "./channel-catalog";

export type ChannelCapabilityState =
  | "available"
  | "needsSetup"
  | "restricted"
  | "unsupported"
  | "notVerified";

export type ChannelTransportState =
  | "starting"
  | "started"
  | "deferred"
  | "stopped"
  | "failed"
  /** A QR-auth account whose profile has no live session. */
  | "needs-login"
  | "disabled";

export interface ChannelCapabilityRow {
  capability: string;
  label: string;
  state: ChannelCapabilityState;
  reason: string;
  /** What the operator does next, or null when nothing is actionable here. */
  nextAction: string | null;
}

export interface ChannelCapabilityAccount {
  /** Transport state from `channel-accounts/status`; null when nothing runs. */
  transport: ChannelTransportState | null;
  /** The authored `enabled` flag on the account record. */
  enabled: boolean;
  /** The status row's `detail`, which explains a deferred or failed transport. */
  detail?: string | undefined;
  /** Capability names the Hub has live evidence for. Empty on every Hub today. */
  verified?: readonly string[] | undefined;
}

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

const TRANSPORT_REASONS: Readonly<Record<ChannelTransportState, string>> = {
  starting: "The transport is still starting.",
  started: "",
  deferred: "The transport is deferred.",
  stopped: "The transport is stopped.",
  failed: "The transport failed to start.",
  "needs-login": "The account has no linked session.",
  disabled: "The transport is disabled.",
};

const TRANSPORT_ACTIONS: Readonly<Record<ChannelTransportState, string | null>> = {
  starting: null,
  started: null,
  deferred: "Check the account's Connection and required configuration.",
  stopped: "Retry the account.",
  failed: "Retry the account.",
  "needs-login": "Link the account by scanning its QR code.",
  disabled: "Enable the account.",
};

export function channelCapabilityLabel(capability: string): string {
  return CHANNEL_CAPABILITY_LABELS[capability] ?? capability;
}

/** Every capability any channel in the catalog claims, in label order. */
export function channelCapabilityUniverse(
  entries: readonly ChannelCatalogEntry[],
): readonly string[] {
  const seen = new Set<string>();
  for (const entry of entries) for (const capability of entry.capabilities) seen.add(capability);
  return [...seen];
}

export function deriveChannelCapabilities(
  entry: ChannelCatalogEntry,
  account: ChannelCapabilityAccount | null,
  capabilities: readonly string[] = Object.keys(CHANNEL_CAPABILITY_LABELS),
): ChannelCapabilityRow[] {
  const claimed = new Set(entry.capabilities);
  return capabilities.map((capability) => ({
    capability,
    label: channelCapabilityLabel(capability),
    ...resolveCapability(entry, account, capability, claimed.has(capability)),
  }));
}

function resolveCapability(
  entry: ChannelCatalogEntry,
  account: ChannelCapabilityAccount | null,
  capability: string,
  claimed: boolean,
): Pick<ChannelCapabilityRow, "state" | "reason" | "nextAction"> {
  if (!claimed) {
    return {
      state: "unsupported",
      reason: `${entry.label} does not support this.`,
      nextAction: null,
    };
  }
  const blocked = setupBlocker(entry, account);
  if (blocked !== null) return blocked;
  const restriction = CAPABILITY_RESTRICTIONS[entry.id]?.[capability];
  if (restriction !== undefined) {
    return { state: "restricted", reason: restriction, nextAction: null };
  }
  if (account?.verified?.includes(capability) === true) {
    return { state: "available", reason: "Verified on this account.", nextAction: null };
  }
  return {
    state: "notVerified",
    reason: "The catalog claims this; the Hub reports no live evidence for it.",
    nextAction: "Exercise it in a conversation on this account.",
  };
}

function setupBlocker(
  entry: ChannelCatalogEntry,
  account: ChannelCapabilityAccount | null,
): Pick<ChannelCapabilityRow, "state" | "reason" | "nextAction"> | null {
  if (entry.status === "planned") {
    return {
      state: "needsSetup",
      reason: `${entry.label} has no runtime on this Hub yet.`,
      nextAction: null,
    };
  }
  if (account === null) {
    return {
      state: "needsSetup",
      reason: "No account is configured for this channel.",
      nextAction: `Add a ${entry.label} Channel account.`,
    };
  }
  if (!account.enabled) {
    return {
      state: "needsSetup",
      reason: "The account is disabled.",
      nextAction: "Enable the account.",
    };
  }
  if (account.transport === null) {
    return {
      state: "needsSetup",
      reason: "The Channel runtime reports no transport for this account.",
      nextAction: "Refresh status, then retry the account.",
    };
  }
  if (account.transport === "started") return null;
  const detail = account.detail?.trim();
  return {
    state: "needsSetup",
    reason:
      detail === undefined || detail.length === 0
        ? TRANSPORT_REASONS[account.transport]
        : `${TRANSPORT_REASONS[account.transport]} ${detail}`,
    nextAction: TRANSPORT_ACTIONS[account.transport],
  };
}

export const CHANNEL_CAPABILITY_STATE_LABELS: Readonly<Record<ChannelCapabilityState, string>> = {
  available: "Available",
  needsSetup: "Needs setup",
  restricted: "Restricted",
  unsupported: "Unsupported",
  notVerified: "Not verified",
};

/** Counts for the one-line summary above the matrix. */
export function summarizeChannelCapabilities(
  rows: readonly ChannelCapabilityRow[],
): Readonly<Record<ChannelCapabilityState, number>> {
  const totals: Record<ChannelCapabilityState, number> = {
    available: 0,
    needsSetup: 0,
    restricted: 0,
    unsupported: 0,
    notVerified: 0,
  };
  for (const row of rows) totals[row.state] += 1;
  return totals;
}

/** Capability state as a `<StatusBadge>` variant. */
export function channelCapabilityVariant(
  state: ChannelCapabilityState,
): "success" | "warning" | "error" | "muted" {
  if (state === "available") return "success";
  if (state === "needsSetup" || state === "restricted") return "warning";
  return "muted";
}
