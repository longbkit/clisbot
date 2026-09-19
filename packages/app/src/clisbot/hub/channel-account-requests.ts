// The per-account Channel requests a Channel Route Admin makes
// (docs/features/access/scoped-admins.md). Plain functions over the API client,
// shared by the Channels screen and the Automation input save.
import type { HubApiClient } from "./api-client";
import {
  HubChannelAccountConfigurationSchema,
  type HubChannelAccountConfiguration,
} from "./contracts";

export interface ChannelAccountRef {
  channel: string;
  accountId: string;
}

export function channelAccountResource(ref: ChannelAccountRef): string {
  return `${encodeURIComponent(ref.channel)}/${encodeURIComponent(ref.accountId)}`;
}

/** Save one administered account through its own endpoint; the response is that account's view. */
export function saveAdministeredAccount(
  api: HubApiClient,
  account: Record<string, unknown>,
  expectedRevisionId: string | null,
): Promise<HubChannelAccountConfiguration> {
  const ref = { channel: String(account["channel"]), accountId: String(account["accountId"]) };
  return api.put(
    `channel-configuration/accounts/${channelAccountResource(ref)}`,
    { account, expectedRevisionId },
    HubChannelAccountConfigurationSchema,
  );
}

/**
 * Save every account that differs from its saved copy, one after another, each
 * against the revision the previous save produced. Returns the last revision id.
 */
export async function saveChangedAccounts(
  api: HubApiClient,
  accounts: readonly Record<string, unknown>[],
  saved: readonly Record<string, unknown>[],
  expectedRevisionId: string | null,
): Promise<string | null> {
  const savedSources = new Set(saved.map((account) => JSON.stringify(account)));
  let revisionId = expectedRevisionId;
  for (const account of accounts) {
    if (savedSources.has(JSON.stringify(account))) continue;
    const view = await saveAdministeredAccount(api, account, revisionId);
    revisionId = view.revision?.id ?? revisionId;
  }
  return revisionId;
}
