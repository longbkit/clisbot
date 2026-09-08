// COMPAT(clisbot-channels): the Channel plane's own Connection tables — the
// per-channel credential owners the Hub encrypts on the shared envelope service.
//
// One table per channel rather than one shared table, because each is an
// organization-scoped `(organization, accountId)` credential owner with its own
// lifecycle, and because the upstream `discord_connections` /
// `slack_connections` tables already mean something else (the per-guild /
// per-team trigger link). See `schema.ts` for the per-table rationale.
//
// Every one of them carries the SAME columns, so one query body serves all of
// them. That is what this module exists to state once: the table map, the
// credential field vocabulary, and the projection that seals only string
// credential fields into the envelope.

import * as schema from "./schema.js";
import type { ChannelConnectionChannel, ChannelConnectionCredentials } from "./types.js";

/**
 * The shared shape of every channel Connection table. The tables are declared
 * separately (drizzle types a table by its name), so the map below coerces each
 * to this one type: the columns are identical by construction and drizzle
 * generates SQL from the runtime table object, never from the static type. A
 * column added to one table and not the others would break at the migration,
 * which is where it should break.
 */
export type ChannelConnectionTable = typeof schema.telegramConnections;

/** The Connection table owning each channel's credential, in listing order. */
export const CHANNEL_CONNECTION_TABLES: Record<ChannelConnectionChannel, ChannelConnectionTable> = {
  telegram: schema.telegramConnections,
  discord: schema.discordBotConnections as unknown as ChannelConnectionTable,
  googlechat: schema.googlechatConnections as unknown as ChannelConnectionTable,
  feishu: schema.feishuConnections as unknown as ChannelConnectionTable,
  zalo: schema.zaloConnections as unknown as ChannelConnectionTable,
  zalouser: schema.zalouserConnections as unknown as ChannelConnectionTable,
};

/** The same map as entries, for the listing and delete sweeps. */
export const CHANNEL_CONNECTION_TABLE_ENTRIES = Object.entries(CHANNEL_CONNECTION_TABLES) as [
  ChannelConnectionChannel,
  ChannelConnectionTable,
][];

/**
 * The credential field names a channel envelope may carry. This is the
 * vocabulary shared with `supervisor/account-carriers.ts`: the field name a
 * vertical reads is the field name stored. `providerApplicationId` is absent on
 * purpose — it is Slack's, it is not a secret, and it is read from the Slack
 * Connection row rather than from an envelope.
 */
export const CHANNEL_CREDENTIAL_FIELDS = [
  "botToken",
  "appToken",
  "webhookSecret",
  "appId",
  "appSecret",
  "verificationToken",
  "encryptKey",
  "serviceAccount",
  "serviceAccountFile",
  "profile",
] as const;

/**
 * The credential fields to seal, with absent and empty ones dropped. Storing an
 * empty string would look like a configured credential to every reader.
 */
export function sealableChannelCredentials(
  credentials: ChannelConnectionCredentials,
): Record<string, string> {
  const sealed: Record<string, string> = {};
  for (const field of CHANNEL_CREDENTIAL_FIELDS) {
    const value = credentials[field];
    if (typeof value === "string" && value !== "") sealed[field] = value;
  }
  if (Object.keys(sealed).length === 0) {
    throw new Error("a channel connection needs at least one credential field");
  }
  return sealed;
}
