import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { CHANNEL_CATALOG_FIXTURE } from "./channel-catalog.fixture";
import {
  channelConnectionDetail,
  channelIdentityLine,
  identityCoversConnection,
  linkedChannelIdentities,
} from "./channel-identity-directory";

const identity = {
  id: "i1",
  organizationId: "org",
  memberId: "member",
  connectionId: "c1",
  externalSubjectId: "0900",
  displayName: null,
  verificationMethod: "challenge",
  verifiedAt: "2026-09-16T00:00:00Z",
};
const connection = {
  id: "c1",
  provider: "zalouser",
  providerApplicationId: null,
  name: "Acme",
  externalName: null,
  status: "ready",
  consumers: [],
};

describe("linkedChannelIdentities", () => {
  it("names a Channel from the Hub catalog, never by title-casing its id", () => {
    const [linked] = linkedChannelIdentities([identity], [connection], CHANNEL_CATALOG_FIXTURE);
    // "Zalouser" is what title-casing the id produces, and it is not the Hub's name.
    assert.equal(linked?.label, "Zalo Personal · Acme");
    assert.equal(linked?.channel, "zalouser");
    assert.equal(linked?.subject, "0900");
  });

  it("falls back to a readable form of the id when the catalog does not carry it", () => {
    const [linked] = linkedChannelIdentities(
      [identity],
      [{ ...connection, provider: "matrix" }],
      CHANNEL_CATALOG_FIXTURE,
    );
    assert.equal(linked?.label, "Matrix · Acme");
  });

  it("keeps a readable label before the catalog has loaded", () => {
    const [linked] = linkedChannelIdentities([identity], [connection], []);
    assert.equal(linked?.label, "Zalouser · Acme");
  });

  it("says so plainly when the bot is gone rather than showing a bare id", () => {
    const [linked] = linkedChannelIdentities([identity], [], CHANNEL_CATALOG_FIXTURE);
    assert.equal(linked?.label, "Bot unavailable");
    assert.equal(linked?.channel, undefined);
  });

  it("names a Connection by the Channel accounts that use it, not its generated slug", () => {
    const [linked] = linkedChannelIdentities(
      [identity],
      [
        {
          ...connection,
          provider: "slack",
          name: "slack-a0123-t0456",
          externalName: "Acme",
          consumers: [
            {
              resourceKind: "channel_account",
              resourceId: "slack/acme-bot",
              name: "slack · acme-bot",
            },
            { resourceKind: "automation", resourceId: "a1", name: "Nightly" },
          ],
        },
      ],
      CHANNEL_CATALOG_FIXTURE,
    );
    assert.equal(linked?.label, "Slack · acme-bot");
  });

  it("prefers the link's own display name over the raw provider subject", () => {
    const [linked] = linkedChannelIdentities(
      [{ ...identity, displayName: "@alex" }],
      [connection],
      CHANNEL_CATALOG_FIXTURE,
    );
    assert.equal(linked?.subject, "@alex");
  });

  it("details a Connection by its workspace and its id", () => {
    assert.equal(channelConnectionDetail(connection), "Acme");
    assert.equal(
      channelConnectionDetail({ ...connection, name: "slack-a0123-t0456", externalName: "Acme" }),
      "Acme · slack-a0123-t0456",
    );
  });

  it("names a workspace link by its workspace and every bot of it, never a bot of another", () => {
    const bot = (id: string, account: string, identityRealm: string) => ({
      ...connection,
      id,
      provider: "slack",
      name: `slack-${id}`,
      externalName: identityRealm === "slack:T1" ? "Acme" : "Other",
      identityRealm,
      identityRealmScope: "tenant",
      consumers: [
        {
          resourceKind: "channel_account" as const,
          resourceId: `slack/${account}`,
          name: `slack · ${account}`,
        },
      ],
    });
    const realm = [bot("c1", "dai", "slack:T1"), bot("c2", "oai", "slack:T1")];
    const linkedIdentity = { ...identity, identityRealm: "slack:T1" };
    const [linked] = linkedChannelIdentities(
      [linkedIdentity],
      [...realm, bot("c3", "elsewhere", "slack:T2")],
      CHANNEL_CATALOG_FIXTURE,
    );
    assert.equal(linked?.label, "Slack · Acme");
    assert.equal(linked?.description, "Slack · Acme · works with dai, oai");
  });

  it("covers every Connection of the identity's realm, or only its own on a Hub without realms", () => {
    const realmIdentity = { connectionId: "c1", identityRealm: "slack:T1" };
    assert.equal(
      identityCoversConnection(realmIdentity, { id: "c2", identityRealm: "slack:T1" }),
      true,
    );
    assert.equal(
      identityCoversConnection(realmIdentity, { id: "c1", identityRealm: "slack:T2" }),
      false,
    );
    assert.equal(identityCoversConnection({ connectionId: "c1" }, { id: "c1" }), true);
    assert.equal(identityCoversConnection({ connectionId: "c1" }, { id: "c2" }), false);
  });

  it("still describes an identity whose verifying bot was removed while its workspace remains", () => {
    const remaining = {
      ...connection,
      id: "c2",
      provider: "slack",
      name: "slack-a2-t1",
      externalName: "Acme",
      identityRealm: "slack:T1",
      identityRealmScope: "tenant",
    };
    const line = channelIdentityLine(
      CHANNEL_CATALOG_FIXTURE,
      { connectionId: "removed-bot", identityRealm: "slack:T1" },
      [remaining],
    );
    assert.equal(line, "Slack · Acme · works with slack-a2-t1");
    assert.equal(
      channelIdentityLine(
        CHANNEL_CATALOG_FIXTURE,
        { connectionId: "gone", identityRealm: "slack:T9" },
        [remaining],
      ),
      "No bot left to recognize this identity",
    );
  });

  it("names a Channel-wide link by the Channel and a bot-scoped link by its bot", () => {
    const telegram = {
      ...connection,
      id: "t1",
      provider: "telegram",
      name: "support",
      externalName: "acme_bot",
      identityRealm: "telegram",
      identityRealmScope: "channel",
    };
    const feishu = {
      ...connection,
      id: "f1",
      provider: "feishu",
      name: "feishu-a",
      identityRealm: "feishu:bot:f1",
      identityRealmScope: "bot",
    };
    assert.equal(
      channelIdentityLine(
        CHANNEL_CATALOG_FIXTURE,
        { connectionId: "t1", identityRealm: "telegram" },
        [telegram],
      ),
      "Telegram · works with @acme_bot",
    );
    assert.equal(
      channelIdentityLine(
        CHANNEL_CATALOG_FIXTURE,
        { connectionId: "f1", identityRealm: "feishu:bot:f1" },
        [feishu],
      ),
      "Feishu / Lark · feishu-a",
    );
  });
});
