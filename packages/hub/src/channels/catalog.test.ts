import { describe, expect, it } from "vitest";
import {
  CHANNEL_CATALOG,
  getChannelCatalogEntry,
  isKnownChannel,
  isSupportedChannel,
  SUPPORTED_CHANNEL_NAMES,
} from "./catalog.js";

describe("channel catalog", () => {
  it("covers the target channel identifiers without claiming planned runtime support", () => {
    expect(CHANNEL_CATALOG.map((entry) => entry.id)).toEqual([
      "slack",
      "telegram",
      "discord",
      "googlechat",
      "feishu",
      "zalouser",
      "zalo",
    ]);
    expect(
      CHANNEL_CATALOG.filter((entry) => entry.status === "in-repo").map((entry) => entry.id),
    ).toEqual(["slack", "telegram", "discord", "googlechat", "feishu", "zalouser", "zalo"]);
    // Every catalogued channel now has an in-repo vertical.
    expect(CHANNEL_CATALOG.filter((entry) => entry.status === "planned").map((e) => e.id)).toEqual(
      [],
    );
  });

  it("derives the Hub's supported-channel tuple from the in-repo entries", () => {
    // The tuple is the Hub's one channel-name vocabulary (unions, zod enums,
    // `Record` keys, DB check constraints). It is written out for the literal
    // types, so this is the guard that it never drifts from the catalog.
    expect(SUPPORTED_CHANNEL_NAMES).toEqual(
      CHANNEL_CATALOG.filter((entry) => entry.status === "in-repo").map((entry) => entry.id),
    );
    expect(isSupportedChannel("discord")).toBe(true);
    expect(isSupportedChannel("googlechat")).toBe(true);
    expect(isKnownChannel("zalouser")).toBe(true);
    expect(isSupportedChannel("zalouser")).toBe(true);
    // A channel that is not in the catalog at all is neither.
    expect(isKnownChannel("whatsapp")).toBe(false);
    expect(isSupportedChannel("whatsapp")).toBe(false);
  });

  it("exposes setup metadata and direct third-party SDK references", () => {
    const telegram = getChannelCatalogEntry("telegram");
    expect(telegram?.sdkPackages).toContain("grammy");
    expect(telegram?.transports.map((transport) => transport.id)).toEqual(["polling", "webhook"]);
    expect(telegram?.credentials.find((credential) => credential.key === "botToken")?.secret).toBe(
      true,
    );

    const discord = getChannelCatalogEntry("discord");
    // Upstream hand-rolls its Discord client rather than depending on discord.js.
    expect(discord?.sdkPackages).toContain("discord-api-types");
    expect(discord?.sdkPackages).toContain("ws");
    expect(discord?.transports.map((transport) => transport.id)).toEqual(["gateway"]);
    // Voice, video and Activities are omitted with `send.voice` and
    // `src/activities`; the catalog must not advertise them.
    expect(discord?.capabilities).not.toContain("voice");
    expect(discord?.capabilities).not.toContain("video");
    expect(discord?.capabilities).not.toContain("activities");
    expect(discord?.capabilities).toContain("thread");
    expect(discord?.capabilities).toContain("buttons");
  });

  // `extraTools` is the UI's "Channel tools" line: what an agent can call that
  // is NOT the universal `message` tool. Slack's `read` and `upload` were
  // listed there while being ordinary message actions
  // (`CHANNEL_MESSAGE_TOOL_DISCOVERY`), so the catalog advertised the same
  // capability twice under two different names.
  it("lists no ordinary message action as a channel tool", () => {
    const slack = getChannelCatalogEntry("slack");
    expect(slack?.extraTools).toEqual(["slack.emoji-list"]);
    for (const entry of CHANNEL_CATALOG) {
      for (const tool of entry.extraTools) {
        const action = tool.startsWith(`${entry.id}.`) ? tool.slice(entry.id.length + 1) : tool;
        expect(
          ["send", "read", "edit", "delete", "react", "pin", "unpin", "upload"],
          `${entry.id} advertises the ${action} message action as a channel tool`,
        ).not.toContain(action);
      }
    }
  });

  it("advertises only the capabilities each later vertical has on its production path", () => {
    const feishu = getChannelCatalogEntry("feishu");
    expect(feishu?.sdkPackages).toEqual(["@larksuiteoapi/node-sdk"]);
    expect(feishu?.credentials.map((credential) => credential.key)).toContain("appSecret");
    // The long connection needs no public URL, so it leads.
    expect(feishu?.transports.map((transport) => transport.id)).toEqual(["websocket", "webhook"]);
    // The registered tool names, not the collapsed `feishu_bitable` label.
    expect(feishu?.extraTools).toContain("feishu_bitable_create_record");
    expect(feishu?.extraTools).not.toContain("feishu_bitable");
    // The Hub renders no Lark card; card clicks are inbound only.
    expect(feishu?.capabilities).not.toContain("approval");
    expect(feishu?.capabilities).not.toContain("native-actions");

    const googlechat = getChannelCatalogEntry("googlechat");
    expect(googlechat?.transports.map((transport) => transport.id)).toEqual(["webhook"]);
    expect(googlechat?.transports[0]?.requiredConfig).toEqual([
      "serviceAccount",
      "audienceType",
      "audience",
      "webhookUrl",
    ]);
    // Attachment upload is user-OAuth only and inbound media is not downloaded.
    expect(googlechat?.capabilities).not.toContain("media");
    expect(googlechat?.capabilities).not.toContain("file");
    expect(googlechat?.capabilities).toContain("buttons");

    const zalo = getChannelCatalogEntry("zalo");
    // Zalo ships no SDK; upstream hand-rolls its client over fetch.
    expect(zalo?.sdkPackages).toEqual([]);
    expect(zalo?.transports.map((transport) => transport.id)).toEqual(["polling", "webhook"]);
    // The Bot API has no endpoint for any of these.
    for (const absent of ["thread", "reaction", "edit", "delete", "buttons", "poll"]) {
      expect(zalo?.capabilities).not.toContain(absent);
    }
    expect(zalo?.capabilities).toEqual(["text", "mention", "format", "chunk", "media"]);
  });

  it("marks Zalo Personal as the QR-auth channel with no operator secret", () => {
    const zalouser = getChannelCatalogEntry("zalouser");
    // The discriminator the setup UI switches on; every other channel is token-shaped.
    expect(zalouser?.auth).toBe("qr");
    expect(CHANNEL_CATALOG.filter((entry) => entry.auth === "qr").map((entry) => entry.id)).toEqual(
      ["zalouser"],
    );
    expect(zalouser?.sdkPackages).toEqual(["zca-js"]);
    // The transport needs the profile label, not a session directory: the
    // session lives in the Hub's encrypted keyed-store namespace.
    expect(zalouser?.transports.map((transport) => transport.id)).toEqual(["qr"]);
    expect(zalouser?.transports[0]?.requiredConfig).toEqual(["profile"]);
    // The one credential entry is the non-secret, optional profile.
    expect(zalouser?.credentials).toEqual([
      {
        key: "profile",
        label: "Credential profile",
        secret: false,
        required: false,
        help: "Non-secret label for the stored session; defaults to the account id.",
      },
    ]);
    // No threads, no inbound media download, no edit/delete/pin/poll, no cards.
    for (const absent of ["thread", "edit", "delete", "poll", "buttons", "presentation"]) {
      expect(zalouser?.capabilities).not.toContain(absent);
    }
    expect(zalouser?.capabilities).toEqual([
      "text",
      "mention",
      "format",
      "chunk",
      "media",
      "file",
      "reaction",
      "voice",
    ]);
    expect(zalouser?.extraTools).toEqual(["zalouser"]);
  });

  it("fails closed for unknown channel ids", () => {
    expect(isKnownChannel("discord")).toBe(true);
    expect(isKnownChannel("openclaw-internal")).toBe(false);
    expect(getChannelCatalogEntry("openclaw-internal")).toBeUndefined();
  });
});
