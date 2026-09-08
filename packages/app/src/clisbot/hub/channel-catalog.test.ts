import { describe, expect, it } from "vitest";
import { HubApiError } from "./api-client";
import {
  channelCatalogEntry,
  channelCatalogLabel,
  channelCatalogState,
  channelPrerequisiteSummary,
  isConnectableChannel,
} from "./channel-catalog";
import { CHANNEL_CATALOG_FIXTURE, CHANNEL_CATALOG_RESPONSE } from "./channel-catalog.fixture";
import { HubChannelCatalogSchema } from "./contracts";

/**
 * The catalog is the Hub's. These are contract tests against a captured
 * `GET channel-catalog` body, not a drift check: the app carries no copy of the
 * catalog to drift from. What has to hold is that the contract accepts the shape
 * the Hub serves, keeps accepting names this build has never heard of, and turns
 * the three answers a Hub can give into the three states the setup surfaces
 * render.
 */
describe("channel catalog contract", () => {
  it("parses the response the Hub serves", () => {
    const parsed = HubChannelCatalogSchema.parse(CHANNEL_CATALOG_RESPONSE);
    expect(parsed.channels.map((entry) => entry.id)).toEqual([
      "slack",
      "telegram",
      "discord",
      "googlechat",
      "feishu",
      "zalouser",
      "zalo",
    ]);
    expect(parsed.channels.every((entry) => entry.auth === "token" || entry.auth === "qr")).toBe(
      true,
    );
  });

  it("accepts a channel, capability and tool this build has never heard of", () => {
    const parsed = HubChannelCatalogSchema.parse({
      channels: [
        {
          id: "matrix",
          label: "Matrix",
          status: "in-repo",
          auth: "token",
          transports: [
            {
              id: "sync",
              label: "Sync",
              requiredConfig: ["accessToken"],
              setup: "Register a bot.",
            },
          ],
          credentials: [
            { key: "accessToken", label: "Access token", secret: true, required: true, help: "" },
          ],
          capabilities: ["text", "space-jump"],
          extraTools: ["matrix.room-list"],
          notes: [],
        },
      ],
    });
    expect(parsed.channels[0]?.capabilities).toContain("space-jump");
  });

  it("rejects an entry missing an id, rather than rendering a nameless channel", () => {
    expect(() =>
      HubChannelCatalogSchema.parse({
        channels: [
          {
            id: "",
            label: "Nameless",
            status: "in-repo",
            auth: "token",
            transports: [],
            credentials: [],
            capabilities: [],
            extraTools: [],
            notes: [],
          },
        ],
      }),
    ).toThrow();
  });
});

describe("catalog load state", () => {
  it("is loading until the Hub answers", () => {
    expect(channelCatalogState({ entries: undefined, error: null })).toMatchObject({
      availability: "loading",
      entries: [],
    });
  });

  it("reads the unknown-route 404 as a Hub that cannot publish a catalog", () => {
    const state = channelCatalogState({
      entries: undefined,
      error: new HubApiError(404, "not_found", "Unknown resource."),
    });
    expect(state.availability).toBe("unavailable");
    expect(state.message).toContain("not available on this Hub");
    expect(state.entries).toEqual([]);
  });

  it("keeps any other failure distinct from an absent endpoint", () => {
    const state = channelCatalogState({
      entries: undefined,
      error: new HubApiError(403, "forbidden", "You cannot manage channels."),
    });
    expect(state.availability).toBe("error");
    expect(state.message).toBe("You cannot manage channels.");
  });

  it("publishes the served entries once they arrive", () => {
    const state = channelCatalogState({ entries: CHANNEL_CATALOG_FIXTURE, error: null });
    expect(state).toMatchObject({ availability: "available", message: null });
    expect(state.entries).toHaveLength(CHANNEL_CATALOG_FIXTURE.length);
  });
});

describe("catalog accessors", () => {
  it("labels a channel the catalog does not carry from its id", () => {
    expect(channelCatalogLabel(CHANNEL_CATALOG_FIXTURE, "matrix")).toBe("matrix");
    expect(channelCatalogLabel(CHANNEL_CATALOG_FIXTURE, "telegram")).toBe("Telegram");
    expect(channelCatalogLabel([], "telegram")).toBe("telegram");
  });

  it("treats a QR channel as not connectable through the credential form", () => {
    const zalouser = channelCatalogEntry(CHANNEL_CATALOG_FIXTURE, "zalouser");
    expect(zalouser).toBeDefined();
    expect(zalouser && isConnectableChannel(zalouser)).toBe(false);
    const telegram = channelCatalogEntry(CHANNEL_CATALOG_FIXTURE, "telegram");
    expect(telegram && isConnectableChannel(telegram)).toBe(true);
  });

  it("treats a planned channel as not connectable", () => {
    const planned = { ...CHANNEL_CATALOG_FIXTURE[1]!, status: "planned" as const };
    expect(isConnectableChannel(planned)).toBe(false);
  });

  it("summarizes prerequisites from the required credentials", () => {
    const feishu = channelCatalogEntry(CHANNEL_CATALOG_FIXTURE, "feishu");
    expect(feishu && channelPrerequisiteSummary(feishu)).toBe(
      "App ID · App secret · Verification token",
    );
    const zalouser = channelCatalogEntry(CHANNEL_CATALOG_FIXTURE, "zalouser");
    expect(zalouser && channelPrerequisiteSummary(zalouser)).toBe(
      "QR scan from the provider's own app",
    );
  });

  it("falls back to every credential when none is marked required", () => {
    const credentials = CHANNEL_CATALOG_FIXTURE[0]!.credentials.map((credential) =>
      Object.assign({}, credential, { required: false }),
    );
    const optional = { ...CHANNEL_CATALOG_FIXTURE[0]!, credentials };
    expect(channelPrerequisiteSummary(optional)).toBe("Bot token · App token · Signing secret");
  });
});
