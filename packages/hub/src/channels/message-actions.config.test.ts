import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  clearChannelMessageActions,
  getChannelDriveConfig,
  registerChannelDriveConfig,
} from "./message-actions.js";

const SCOPE = { organizationId: "org-a", channel: "slack", accountId: "acct" };

describe("channel drive config registry", () => {
  it("hands a tool-dispatched action the same cfg the send path was driven with", () => {
    const cfg = { channels: { slack: { accounts: { acct: { botToken: "xoxb-test" } } } } };
    registerChannelDriveConfig(SCOPE, cfg);
    assert.equal(getChannelDriveConfig(SCOPE), cfg);
    assert.deepEqual(getChannelDriveConfig({ ...SCOPE, accountId: "other" }), {});
    clearChannelMessageActions(SCOPE);
    assert.deepEqual(getChannelDriveConfig(SCOPE), {});
  });

  it("keeps two organizations that name the same account apart", () => {
    const mine = { channels: { slack: { accounts: { acct: { botToken: "xoxb-mine" } } } } };
    registerChannelDriveConfig(SCOPE, mine);
    // Same channel, same account id, different tenant: the other organization
    // must not be handed this one's drive-time credentials.
    assert.deepEqual(getChannelDriveConfig({ ...SCOPE, organizationId: "org-b" }), {});
    clearChannelMessageActions(SCOPE);
  });
});
