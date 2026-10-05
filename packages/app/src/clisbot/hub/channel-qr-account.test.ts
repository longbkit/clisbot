import { describe, expect, it, vi } from "vitest";
import type { HubApiClient } from "./api-client";
import { addQrChannelAccount } from "./channel-qr-account";

function api(accounts: Record<string, unknown>[]) {
  const configuration = {
    revision: { id: "rev-1", version: 1, createdAt: "2026-10-05T00:00:00.000Z" },
    policy: {},
    accounts,
    resource: null,
    effective: null,
  };
  const client = {
    get: vi.fn(async () => configuration),
    post: vi.fn(async () => ({ valid: true })),
    put: vi.fn(async () => configuration),
  };
  return { client, typed: client as unknown as HubApiClient };
}

describe("a QR channel's account", () => {
  it("is added with its Connection and no Routes, against the revision it read", async () => {
    const { client, typed } = api([{ channel: "slack", accountId: "team" }]);
    await addQrChannelAccount(typed, { id: "c1", provider: "zalouser", name: "main" });
    const added = {
      channel: "zalouser",
      accountId: "main",
      enabled: true,
      connectionId: "c1",
      transport: { mode: "qr" },
      routes: [],
    };
    expect(client.put).toHaveBeenCalledWith(
      "channel-configuration",
      {
        expectedRevisionId: "rev-1",
        policy: {},
        resource: {},
        accounts: [{ channel: "slack", accountId: "team" }, added],
      },
      expect.anything(),
    );
  });

  it("leaves an account the configuration already has", async () => {
    const { client, typed } = api([{ channel: "zalouser", accountId: "main" }]);
    await addQrChannelAccount(typed, { id: "c1", provider: "zalouser", name: "main" });
    expect(client.put).not.toHaveBeenCalled();
  });
});
