// A channel account's file in the Channel configuration, as a newly added
// Connection gets it: enabled, on its Connection, on the channel's first
// transport, with no Routes yet. Shared by the CLI's `channels add`
// (`channels/http/operations.ts`) and the app's Add Connection
// (`management-api/index.ts`), so an account comes into being one way.

import { dump, load } from "js-yaml";
import { CHANNELS_DIRECTORY } from "../../config/bundle-contract.js";
import type { HubBundleFile } from "../../config/bundle.js";
import type { SupportedChannelName } from "../catalog.js";

/** Every supported channel's default transport mode for a freshly added account. */
export const DEFAULT_TRANSPORT_MODE: Record<SupportedChannelName, string> = {
  slack: "socket",
  telegram: "polling",
  discord: "gateway",
  // Pub/Sub needs no public URL; the webhook needs a reverse proxy in front of
  // the account's listener (packages/channels/googlechat/HUB-WIRING.md).
  googlechat: "pubsub",
  // The long connection and the long poll need no public URL, so they lead.
  feishu: "websocket",
  zalo: "polling",
  // Zalo Personal has one mode; the account is linked afterwards by a QR scan.
  zalouser: "qr",
};

export function channelAccountFilePath(channel: SupportedChannelName, account: string): string {
  return `${CHANNELS_DIRECTORY}/${channel}/${account}.yml`;
}

/** Write/replace the account file into a copy of the active revision's files. */
export function upsertAccountFile(
  files: readonly HubBundleFile[],
  channel: SupportedChannelName,
  account: string,
  connectionId: string,
): HubBundleFile[] {
  const path = channelAccountFilePath(channel, account);
  const previous = files.find((file) => file.path === path);
  const retained = previous ? (load(previous.content) as Record<string, unknown>) : {};
  const content = dump(
    {
      ...retained,
      channel,
      accountId: account,
      enabled: true,
      connectionId,
      transport: retained["transport"] ?? { mode: DEFAULT_TRANSPORT_MODE[channel] },
    },
    { lineWidth: -1 },
  );
  const next = files.filter((file) => file.path !== path);
  next.push({ path, content });
  return next;
}
