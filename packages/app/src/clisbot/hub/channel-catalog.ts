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

const LOADING: ChannelCatalogState = {
  entries: [],
  availability: "loading",
  message: "Loading the channel catalog…",
};

const UNAVAILABLE: ChannelCatalogState = {
  entries: [],
  availability: "unavailable",
  message:
    "The channel catalog is not available on this Hub. Update the Hub to a build that publishes it, then set channels up from here.",
};

/** The query's three outcomes as one state the renderers switch on. */
export function channelCatalogState(input: {
  entries: readonly ChannelCatalogEntry[] | undefined;
  error: unknown;
}): ChannelCatalogState {
  if (input.error !== null && input.error !== undefined) {
    if (input.error instanceof HubApiError && input.error.status === 404) return UNAVAILABLE;
    return {
      entries: [],
      availability: "error",
      message:
        input.error instanceof Error
          ? input.error.message
          : "The channel catalog could not be read.",
    };
  }
  if (input.entries === undefined) return LOADING;
  return { entries: input.entries, availability: "available", message: null };
}

export function channelCatalogEntry(
  entries: readonly ChannelCatalogEntry[],
  channel: string,
): ChannelCatalogEntry | undefined {
  return entries.find((entry) => entry.id === channel);
}

/** A Hub may report a channel its own catalog does not carry; label it from the id. */
export function channelCatalogLabel(
  entries: readonly ChannelCatalogEntry[],
  channel: string,
): string {
  return channelCatalogEntry(entries, channel)?.label ?? channel;
}

/**
 * Whether an operator can create a Connection for this channel by supplying a
 * credential. A `planned` channel has no runtime on this Hub, and a QR channel's
 * credential is produced by a scan rather than pasted, so neither goes through
 * `POST connections`.
 */
export function isConnectableChannel(entry: ChannelCatalogEntry): boolean {
  return entry.status === "in-repo" && entry.auth !== "qr";
}

/** The one-line prerequisite an operator reads before opening the setup form. */
export function channelPrerequisiteSummary(entry: ChannelCatalogEntry): string {
  if (entry.auth === "qr") return "QR scan from the provider's own app";
  const required = entry.credentials.filter((credential) => credential.required);
  const names = (required.length > 0 ? required : entry.credentials).map(({ label }) => label);
  return names.join(" · ");
}
