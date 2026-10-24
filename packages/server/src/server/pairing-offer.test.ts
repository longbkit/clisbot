import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateLocalPairingOffer } from "./pairing-offer.js";
import { parseDevicePairingOfferFromUrl } from "@clisbot/protocol/device-pairing-offer";
import { parseConnectionOfferFromUrl } from "@clisbot/protocol/connection-offer";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

test.each([false, true])(
  "pairing links preserve an explicit strict floor without changing the default (device pairing=%s)",
  async (devicePairingEnabled) => {
    const clisbotHome = await mkdtemp(join(tmpdir(), "clisbot-pairing-security-"));
    homes.push(clisbotHome);
    for (const strict of [undefined, false, true]) {
      const result = await generateLocalPairingOffer({
        clisbotHome,
        devicePairingEnabled,
        relayEnabled: true,
        includeQr: false,
        relayPublicEndpoint: "relay.example:8443",
        relayPublicUseTls: false,
        direct: { endpoint: "direct.example:443", useTls: true },
        relayRequireProtectedSecurity: strict,
      });
      if (!result.url) throw new Error("Missing pairing link");
      const offer = devicePairingEnabled
        ? parseDevicePairingOfferFromUrl(result.url)
        : parseConnectionOfferFromUrl(result.url);
      expect(offer?.relay).toEqual({ endpoint: "relay.example:8443", useTls: false });
      if (strict) expect(offer?.minimumSecurityMode).toBe("protected");
      else expect(offer).not.toHaveProperty("minimumSecurityMode");
      if (devicePairingEnabled)
        expect(offer?.direct).toEqual({ endpoint: "direct.example:443", useTls: true });
    }
  },
);
