// A QR channel's account is added the moment its Connection is: there is no
// credential to wait for, and the QR login runs on the account, so the scan can
// follow straight away. Routes come after (public-docs/hub/channels/zalouser.md).

import type { HubApiClient } from "./api-client";
import { channelAccountRecord } from "./channel-configuration";
import { HubChannelConfigurationSchema, HubChannelValidationSchema } from "./contracts";

/** Adds the Connection's account, with no Routes, unless the configuration has it. */
export async function addQrChannelAccount(
  api: HubApiClient,
  connection: { id: string; provider: string; name: string },
): Promise<void> {
  const current = await api.get("channel-configuration", HubChannelConfigurationSchema);
  const exists = current.accounts.some(
    (account) =>
      account["channel"] === connection.provider && account["accountId"] === connection.name,
  );
  if (exists) return;
  const candidate = {
    policy: current.policy,
    resource: current.resource ?? {},
    accounts: [...current.accounts, channelAccountRecord(connection, connection.name, [])],
  };
  await api.post("channel-configuration/validate", candidate, HubChannelValidationSchema);
  await api.put(
    "channel-configuration",
    { expectedRevisionId: current.revision?.id ?? null, ...candidate },
    HubChannelConfigurationSchema,
  );
}
