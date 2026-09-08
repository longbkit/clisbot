// COMPAT(clisbot-channels): the channel catalog on the management contract.
//
// The Hub owns the catalog (`channels/catalog.ts`) and, until this endpoint,
// published none of it: `channel-configuration` returns the organization's
// authored accounts and `channel-accounts/status` returns runtime state, but a
// setup screen also needs to know what a channel is called, how it is
// authenticated, what its transports require and what it can do. The app
// carried a hand-maintained mirror for that; this is the read that replaces it.
//
// Organization-scoped only by its guard: the catalog is the same for every
// organization, and it carries no credential, no account and no secret — only
// the metadata a setup surface renders.

import { CHANNEL_CATALOG, type ChannelAuthKind } from "../channels/catalog.js";
import { requireChannelPlane } from "./channel-plane-gate.js";

/** One catalog entry as the contract publishes it. Deliberately not the whole
 * `ChannelCatalogEntry`: `sdkPackages` and `upstreamPackage` are developer facts
 * about how the vertical is built, and no client surface renders them. */
export interface ManagementChannelCatalogEntry {
  id: string;
  label: string;
  status: "in-repo" | "planned";
  /** Defaulted here rather than in the catalog, so every client reads a value. */
  auth: ChannelAuthKind;
  transports: readonly {
    id: string;
    label: string;
    requiredConfig: readonly string[];
    setup: string;
  }[];
  credentials: readonly {
    key: string;
    label: string;
    secret: boolean;
    required: boolean;
    help: string;
  }[];
  capabilities: readonly string[];
  extraTools: readonly string[];
  notes: readonly string[];
}

/** The catalog this Hub can actually run. With the channel kill-switch off it
 * runs none, so the resource answers `not_found` rather than advertising
 * channels the process will never start. */
export function channelCatalogView(): readonly ManagementChannelCatalogEntry[] {
  requireChannelPlane();
  return CHANNEL_CATALOG.map((entry) => ({
    id: entry.id,
    label: entry.label,
    status: entry.status,
    auth: entry.auth ?? "token",
    transports: entry.transports.map((transport) => ({
      id: transport.id,
      label: transport.label,
      requiredConfig: [...transport.requiredConfig],
      setup: transport.setup,
    })),
    credentials: entry.credentials.map((credential) => ({ ...credential })),
    capabilities: [...entry.capabilities],
    extraTools: [...entry.extraTools],
    notes: [...entry.notes],
  }));
}
