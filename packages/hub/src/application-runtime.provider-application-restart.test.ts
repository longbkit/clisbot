import assert from "node:assert/strict";
import { it } from "vitest";
import type { ChannelControlPlaneSnapshot } from "./channels/control-plane.js";
import type { ChannelSupervisor } from "./channels/supervisor/types.js";
import type { Database } from "./db/types.js";
import { restartProviderApplicationChannelConsumers } from "./application-runtime.js";

it("restarts every active Channel account using a changed Provider Application", async () => {
  const starts: Array<{ channel: string; accountId: string }> = [];
  const database = {
    listOrganizationsForOperator: async () => [
      { id: "organization-1", name: "Organization", slug: "organization" },
    ],
    organizationConnectionUsage: async () => ({
      github: [],
      discord: [],
      linear: [],
      slack: [
        { id: "connection-a", providerApplicationId: "app-1" },
        { id: "connection-b", providerApplicationId: "app-1" },
        { id: "connection-other", providerApplicationId: "app-2" },
      ],
    }),
  } as unknown as Database;
  const supervisor = {
    startAccount: async (channel: string, accountId: string) => {
      starts.push({ channel, accountId });
      return { channel, account: accountId, installed: false, transport: "started" as const };
    },
  } as ChannelSupervisor;
  const snapshot = {
    organizationId: "organization-1",
    controlPlane: {
      enabled: true,
      accounts: [
        activeAccount("support", "connection-a"),
        activeAccount("sales", "connection-b"),
        activeAccount("other-app", "connection-other"),
        { ...activeAccount("disabled", "connection-a"), enabled: false },
        {
          ...activeAccount("telegram", "connection-a"),
          channel: "telegram",
        },
      ],
    },
  } as unknown as ChannelControlPlaneSnapshot;

  await restartProviderApplicationChannelConsumers(
    database,
    supervisor,
    { provider: "slack", providerApplicationId: "app-1" },
    async (_database, organizationId) => {
      assert.equal(organizationId, "organization-1");
      return snapshot;
    },
  );

  assert.deepEqual(starts, [
    { channel: "slack", accountId: "support" },
    { channel: "slack", accountId: "sales" },
  ]);
});

function activeAccount(accountId: string, connectionId: string) {
  return {
    channel: "slack",
    accountId,
    connectionId,
    enabled: true,
    channelEnabled: true,
  };
}
