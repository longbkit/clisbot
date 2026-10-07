import { expect, test } from "vitest";
import { hubPairingOfferUrl, parseHubPairingOfferFromUrl } from "./device-pairing-offer.js";

test("a Hub pairing link round-trips through the parser, including non-ASCII routes", () => {
  const hub = {
    hubId: "hub-1",
    publicKey: "pinned-key",
    origin: "https://mac.tail1.ts.net:8443",
    relay: { endpoint: "relay.clisbot.com:443", useTls: true },
    pairing: { backendId: "hub-1", token: "t".repeat(43), expiresAt: 1_900_000_000_000 },
  };
  const url = hubPairingOfferUrl(hub);
  expect(url.startsWith("https://app.clisbot.com/#offer=")).toBe(true);
  // base64url: safe in a URL fragment without escaping.
  expect(url.split("#offer=")[1]).not.toMatch(/[+/=]/);
  expect(parseHubPairingOfferFromUrl(url)).toEqual({ v: 4, hub });
  const named = hubPairingOfferUrl({ ...hub, origin: "https://máy.tail1.ts.net" });
  expect(parseHubPairingOfferFromUrl(named)?.hub.origin).toBe("https://máy.tail1.ts.net");
});
