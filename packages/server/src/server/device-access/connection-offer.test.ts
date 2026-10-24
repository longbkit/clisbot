import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfigFromPersisted } from "../config.js";
import { createPublishedConnectionOffer } from "./connection-offer.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function config(devicePairingEnabled: boolean, requireProtectedSecurity?: boolean) {
  const home = await mkdtemp(join(tmpdir(), "clisbot-published-security-"));
  homes.push(home);
  return {
    ...resolveConfigFromPersisted(home, { version: 1 }, { env: {} }),
    devicePairingEnabled,
    relayRequireProtectedSecurity: requireProtectedSecurity,
    relayPublicEndpoint: "public-relay.example:8443",
    relayPublicUseTls: false,
    directEndpoint: "private-direct.example:443",
    directUseTls: true,
  };
}

test.each([false, true])(
  "published offer carries configured floor and existing routes (device pairing=%s)",
  async (devicePairing) => {
    const daemon = await config(devicePairing, true);
    expect(
      await createPublishedConnectionOffer(daemon, true, "daemon-id", "daemon-key"),
    ).toMatchObject({
      v: devicePairing ? 5 : 2,
      serverId: "daemon-id",
      daemonPublicKeyB64: "daemon-key",
      minimumSecurityMode: "protected",
      relay: { endpoint: "public-relay.example:8443", useTls: false },
      direct: { endpoint: "private-direct.example:443", useTls: true },
    });
  },
);

test.each([false, true])(
  "effective runtime floor overrides startup without inventing a default (device pairing=%s)",
  async (devicePairing) => {
    const daemon = await config(devicePairing);
    const relaxed = await createPublishedConnectionOffer(daemon, true, "daemon-id", "daemon-key");
    expect(relaxed).not.toHaveProperty("minimumSecurityMode");
    expect(
      await createPublishedConnectionOffer(daemon, true, "daemon-id", "daemon-key", true),
    ).toHaveProperty("minimumSecurityMode", "protected");
    daemon.relayRequireProtectedSecurity = true;
    expect(
      await createPublishedConnectionOffer(daemon, true, "daemon-id", "daemon-key", false),
    ).not.toHaveProperty("minimumSecurityMode");
  },
);

test("strict direct-only device offer preserves persisted direct route and omits relay", async () => {
  const daemon = await config(true, true);
  await writeFile(
    join(daemon.clisbotHome, "config.json"),
    JSON.stringify({
      version: 1,
      daemon: { direct: { endpoint: "saved-private.example:8080", useTls: false } },
    }),
  );
  expect(await createPublishedConnectionOffer(daemon, false, "daemon-id", "daemon-key")).toEqual({
    v: 5,
    encrypted: true,
    serverId: "daemon-id",
    daemonPublicKeyB64: "daemon-key",
    minimumSecurityMode: "protected",
    relay: undefined,
    direct: { endpoint: "saved-private.example:8080", useTls: false },
  });
});
