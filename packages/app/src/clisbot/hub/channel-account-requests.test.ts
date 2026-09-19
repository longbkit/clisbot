import { describe, expect, it, vi } from "vitest";
import type { HubApiClient } from "./api-client";
import { saveAutomationWithInputs } from "./automation-input-save";
import { saveChangedAccounts } from "./channel-account-requests";

const support = { channel: "slack", accountId: "support", routes: [] as unknown[] };
const ops = { channel: "telegram", accountId: "ops", routes: [] as unknown[] };

function api() {
  let version = 1;
  const put = vi.fn(async (path: string, body: unknown) => {
    void body;
    version += 1;
    return { revision: { id: `revision-${String(version)}`, version }, account: {}, warnings: [] };
  });
  const post = vi.fn(async () => ({
    id: "automation",
    name: "support",
    yaml: "",
    enabled: true,
    activeRevisionId: "automation-1",
  }));
  return { put, post, client: { put, post, get: vi.fn() } as unknown as HubApiClient };
}

describe("per-account Channel saves", () => {
  it("saves only the changed accounts, each against the previous save's revision", async () => {
    const { put, client } = api();
    const changed = { ...ops, routes: [{ workflow: "support" }] };
    const last = await saveChangedAccounts(
      client,
      [support, changed],
      [support, ops],
      "revision-1",
    );
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith(
      "channel-configuration/accounts/telegram/ops",
      { account: changed, expectedRevisionId: "revision-1" },
      expect.anything(),
    );
    expect(last).toBe("revision-2");
  });

  it("routes a Channel Route Admin's Automation inputs through the account endpoint", async () => {
    const { put, client } = api();
    const changed = { ...support, routes: [{ workflow: "support" }] };
    await saveAutomationWithInputs(
      client,
      "name: support\nenabled: true\n",
      {
        expectedRevisionId: "revision-1",
        accounts: [changed],
        resource: {},
        policy: {},
        scope: "accounts",
        savedAccounts: [support],
        grants: [],
      },
      {},
    );
    expect(put.mock.calls.map(([path]) => path)).toEqual([
      "channel-configuration/accounts/slack/support",
    ]);
  });
});
