import { describe, expect, it } from "vitest";
import type { ChannelCatalogEntry } from "./channel-catalog";
import { CHANNEL_CATALOG_FIXTURE, catalogFixtureEntry } from "./channel-catalog.fixture";
import {
  channelCapabilityLabel,
  channelCapabilityUniverse,
  deriveChannelCapabilities,
  summarizeChannelCapabilities,
  type ChannelCapabilityAccount,
} from "./channel-capability";

function entryOf(id: string): ChannelCatalogEntry {
  return catalogFixtureEntry(id);
}

const telegram = entryOf("telegram");
const zalo = entryOf("zalo");
const zalouser = entryOf("zalouser");
const discord = entryOf("discord");

const running: ChannelCapabilityAccount = { transport: "started", enabled: true };

function rowFor(
  entry = telegram,
  account: ChannelCapabilityAccount | null = running,
  key = "poll",
) {
  const rows = deriveChannelCapabilities(entry, account, [key]);
  const row = rows[0];
  if (row === undefined) throw new Error(`no row for ${key}`);
  return row;
}

describe("capability states", () => {
  it("marks a capability the catalog does not list as unsupported", () => {
    expect(rowFor(zalo, running, "poll")).toMatchObject({
      state: "unsupported",
      reason: "Zalo Official Bot does not support this.",
      nextAction: null,
    });
  });

  it("never claims available without live evidence", () => {
    expect(rowFor()).toMatchObject({
      state: "notVerified",
      nextAction: "Exercise it in a conversation on this account.",
    });
  });

  it("promotes a capability the Hub reports evidence for", () => {
    const row = rowFor(telegram, { ...running, verified: ["poll"] });
    expect(row).toMatchObject({ state: "available", reason: "Verified on this account." });
  });

  it("reports a planned channel as needing setup rather than unsupported", () => {
    // Every catalog channel ships today, so the planned branch needs a stand-in.
    const planned = { ...zalouser, status: "planned" as const };
    expect(rowFor(planned, null, "text")).toMatchObject({
      state: "needsSetup",
      reason: "Zalo Personal has no runtime on this Hub yet.",
      nextAction: null,
    });
  });

  it("asks for an account when the channel has none", () => {
    expect(rowFor(telegram, null, "text")).toMatchObject({
      state: "needsSetup",
      nextAction: "Add a Telegram Channel account.",
    });
  });

  it("reports a disabled account before its transport", () => {
    expect(rowFor(telegram, { transport: "started", enabled: false }, "text")).toMatchObject({
      state: "needsSetup",
      reason: "The account is disabled.",
      nextAction: "Enable the account.",
    });
  });

  it("folds the status detail into a failed transport reason", () => {
    expect(
      rowFor(telegram, { transport: "failed", enabled: true, detail: "401 Unauthorized" }, "text"),
    ).toMatchObject({
      state: "needsSetup",
      reason: "The transport failed to start. 401 Unauthorized",
      nextAction: "Retry the account.",
    });
  });

  it("offers no action while a transport is still starting", () => {
    expect(rowFor(telegram, { transport: "starting", enabled: true }, "text")).toMatchObject({
      state: "needsSetup",
      nextAction: null,
    });
  });

  it("restates the catalog's own narrowing as restricted", () => {
    expect(rowFor(discord, running, "native-actions")).toMatchObject({
      state: "restricted",
      reason: "Slash commands and interaction callbacks are not wired yet.",
    });
    expect(rowFor(zalo, running, "media")).toMatchObject({
      state: "restricted",
      reason: "Inbound images only; the Zalo Bot API has no upload endpoint.",
    });
  });

  it("keeps a restriction behind the setup blocker", () => {
    expect(rowFor(discord, null, "native-actions").state).toBe("needsSetup");
  });
});

describe("matrix shape", () => {
  it("labels every capability any catalog channel claims", () => {
    for (const capability of channelCapabilityUniverse(CHANNEL_CATALOG_FIXTURE)) {
      expect(channelCapabilityLabel(capability)).not.toBe(capability);
    }
  });

  it("returns one row per requested capability, in order", () => {
    const rows = deriveChannelCapabilities(telegram, running, ["text", "poll", "topic"]);
    expect(rows.map((row) => row.capability)).toEqual(["text", "poll", "topic"]);
  });

  it("counts states for the summary line", () => {
    const rows = deriveChannelCapabilities(zalo, running, ["text", "media", "poll"]);
    expect(summarizeChannelCapabilities(rows)).toEqual({
      available: 0,
      needsSetup: 0,
      restricted: 1,
      unsupported: 1,
      notVerified: 1,
    });
  });
});
