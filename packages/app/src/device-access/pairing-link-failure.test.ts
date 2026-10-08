import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { pairingLinkFailureMessage } from "./pairing-link-failure";

const link = (offer: Record<string, unknown>) =>
  `https://app.clisbot.com/#offer=${Buffer.from(
    JSON.stringify({
      v: 3,
      serverId: "srv",
      daemonPublicKeyB64: "pk",
      pairing: { backendId: "srv", token: "t".repeat(43), expiresAt: Date.now() + 60_000 },
      ...offer,
    }),
  ).toString("base64url")}`;
const local = link({ direct: { endpoint: "127.0.0.1:6868", useTls: false } });
const browser = { browser: true, secure: true };

describe("pairingLinkFailureMessage", () => {
  it("names the browser block when the only route is unencrypted and there is no relay", async () => {
    await i18n.changeLanguage("en");
    expect(pairingLinkFailureMessage(local, browser)).toContain("This browser blocks");
  });

  it("keeps the general message when relay can carry the connection", () => {
    const withRelay = link({
      direct: { endpoint: "127.0.0.1:6868", useTls: false },
      relay: { endpoint: "relay.clisbot.com:443", useTls: true },
    });
    expect(pairingLinkFailureMessage(withRelay, browser)).toContain("Could not connect");
  });

  it("keeps the general message outside a secure browser page", () => {
    expect(pairingLinkFailureMessage(local, { browser: false, secure: false })).toContain(
      "Could not connect",
    );
  });
});
