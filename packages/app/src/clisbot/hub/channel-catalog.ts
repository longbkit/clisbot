/**
 * The client model over the Hub's channel catalog (`GET channel-catalog`).
 *
 * The catalog is the Hub's: it knows which verticals its build ships, what each
 * one is called, how it authenticates and what it claims to do. This module owns
 * none of that. It holds the load state the setup surfaces render, and the
 * derivations that read one served entry and need no further Hub data.
 *
 * A Hub older than the endpoint answers the management API's unknown-route 404.
 * That is "this Hub cannot do this", so it becomes `unavailable` — a stated
 * limit with a stated fix — and never an empty catalog, which would read as "no
 * channels exist".
 */
import { i18n } from "@/i18n/i18next";
import { HubApiError } from "./api-client";
import type { HubChannelCatalogEntry } from "./contracts";

export type ChannelCatalogEntry = HubChannelCatalogEntry;
export type ChannelCatalogStatus = ChannelCatalogEntry["status"];

/**
 * How an operator authenticates an account: a credential pasted once, or a live
 * login completed by scanning a code. The Hub defaults this to `token`.
 */
export type ChannelAuthKind = ChannelCatalogEntry["auth"];

export type ChannelCatalogAvailability = "loading" | "available" | "unavailable" | "error";

export interface ChannelCatalogState {
  entries: readonly ChannelCatalogEntry[];
  availability: ChannelCatalogAvailability;
  /** The line to render for a state that is not `available`. */
  message: string | null;
}

function loadingState(): ChannelCatalogState {
  return {
    entries: [],
    availability: "loading",
    message: i18n.t("hub.channels.catalog.loading"),
  };
}

function unavailableState(): ChannelCatalogState {
  return {
    entries: [],
    availability: "unavailable",
    message: i18n.t("hub.channels.catalog.unavailable"),
  };
}

/** The query's three outcomes as one state the renderers switch on. */
export function channelCatalogState(input: {
  entries: readonly ChannelCatalogEntry[] | undefined;
  error: unknown;
}): ChannelCatalogState {
  if (input.error !== null && input.error !== undefined) {
    if (input.error instanceof HubApiError && input.error.status === 404) return unavailableState();
    return {
      entries: [],
      availability: "error",
      message:
        input.error instanceof Error
          ? input.error.message
          : i18n.t("hub.channels.catalog.readFailed"),
    };
  }
  if (input.entries === undefined) return loadingState();
  return { entries: input.entries, availability: "available", message: null };
}

export function channelCatalogEntry(
  entries: readonly ChannelCatalogEntry[],
  channel: string,
): ChannelCatalogEntry | undefined {
  return entries.find((entry) => entry.id === channel);
}

/**
 * The Hub's own name for a Channel — "Zalo Personal", not "Zalouser".
 *
 * A Hub may report a channel its catalog does not carry, and the catalog itself
 * arrives after the surfaces that name Channels; both fall back to a readable
 * form of the id. Never use that fallback as the primary source: it is wrong for
 * every id that is not a single word (`googlechat`, `zalouser`).
 */
export function channelCatalogLabel(
  entries: readonly ChannelCatalogEntry[],
  channel: string,
): string {
  const entry = channelCatalogEntry(entries, channel);
  if (entry) return entry.label;
  return channel.length === 0 ? channel : channel[0]!.toUpperCase() + channel.slice(1);
}

/**
 * Whether an operator can create a Connection for this channel here. A
 * `planned` channel has no runtime on this Hub. A QR channel's Connection holds
 * no secret, only a name: its credential comes from the scan, once the account
 * runs (`POST connections` with `credentials: {}`).
 */
export function isConnectableChannel(entry: ChannelCatalogEntry): boolean {
  return entry.status === "in-repo";
}

type ChannelTransport = ChannelCatalogEntry["transports"][number];

/** Can a Connection use this transport today? The Hub marks the ones it cannot. */
export function isSupportedTransport(transport: ChannelTransport): boolean {
  return transport.supported !== false;
}

/** The transports a Connection can be made with, in catalog order. */
export function supportedTransports(entry: ChannelCatalogEntry): ChannelTransport[] {
  return entry.transports.filter(isSupportedTransport);
}

/**
 * The one-line prerequisite an operator reads before opening the setup form:
 * the required credentials a supported transport uses, so a webhook-only
 * secret is not listed as something to fetch.
 */
export function channelPrerequisiteSummary(entry: ChannelCatalogEntry): string {
  if (entry.auth === "qr") return i18n.t("hub.channels.catalog.qrPrerequisite");
  const used = new Set(supportedTransports(entry).flatMap(({ requiredConfig }) => requiredConfig));
  const required = entry.credentials.filter(
    (credential) => credential.required && (used.size === 0 || used.has(credential.key)),
  );
  const names = (required.length > 0 ? required : entry.credentials).map(({ label }) => label);
  return names.join(" · ");
}
