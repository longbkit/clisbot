import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { CHANNEL_CATALOG_FIXTURE } from "./channel-catalog.fixture";
import { linkedChannelIdentities } from "./channel-identity-directory";

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

  it("says so plainly when the Connection is gone rather than showing a bare id", () => {
    const [linked] = linkedChannelIdentities([identity], [], CHANNEL_CATALOG_FIXTURE);
    assert.equal(linked?.label, "Connection unavailable");
    assert.equal(linked?.channel, undefined);
  });

  it("prefers the link's own display name over the raw provider subject", () => {
    const [linked] = linkedChannelIdentities(
      [{ ...identity, displayName: "@alex" }],
      [connection],
      CHANNEL_CATALOG_FIXTURE,
    );
    assert.equal(linked?.subject, "@alex");
  });
});
