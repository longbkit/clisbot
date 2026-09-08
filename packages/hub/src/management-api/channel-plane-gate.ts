// COMPAT(clisbot-channels): the management contract's half of the channel
// kill-switch (`PASEO_HUB_CHANNELS_ENABLED`, operator name
// `CLISBOT_HUB_CHANNELS_ENABLED`; `channels/loader/channel-gate.ts`).
//
// The `/api/v1/channels` operator surface gates itself per request
// (`channels/http/operations.ts` `gate`), and the supervisor, the vertical
// loader and the channel-reply MCP server never come into existence with the
// switch off. The organization-scoped management contract had no such gate:
// its channel resources answered — and mutated — with the plane off, which is
// how a Hub that "loads no channel code" could still deploy a channel
// configuration revision or prune the durable ingress queue.
//
// Off is `not_found`, not `forbidden`: the resource does not exist on this Hub,
// and a 403 would tell an unauthorized caller that it does. That matches the
// `/api/v1/channels` ops layer, which answers a flag-off request with 404.

import { ProductRequestError } from "../auth/organization-access.js";
import {
  loadChannelControlPlane,
  type ChannelControlPlaneSnapshot,
} from "../channels/control-plane.js";
import { isChannelsEnabled } from "../channels/loader/channel-gate.js";
import type { ChannelConfigurationRevisionRecord, Database } from "../db/types.js";

/** Refuse a channel management resource when the kill-switch is off. */
export function requireChannelPlane(): void {
  if (isChannelsEnabled()) return;
  throw new ProductRequestError(404, "channels_disabled");
}

/** The organization's compiled channel control plane, gated. Every management
 * handler under `channel-configuration` and `channel-accounts` starts from this
 * read, so gating it here refuses the whole family before the first query. */
export async function channelControlPlaneView(
  database: Database,
  organizationId: string,
): Promise<ChannelControlPlaneSnapshot> {
  requireChannelPlane();
  return loadChannelControlPlane(database, organizationId);
}

/** The organization's channel configuration history, gated. The one
 * `channel-configuration` branch that answers without the snapshot above. */
export async function channelConfigurationRevisionList(
  database: Database,
  organizationId: string,
  limit: number,
): Promise<ChannelConfigurationRevisionRecord[]> {
  requireChannelPlane();
  return database.listChannelConfigurationRevisions(organizationId, limit);
}
