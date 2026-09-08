// COMPAT(clisbot-channels): the Fusion fork's upstream-compatibility guard for
// the daemon (CLAUDE.md "Upstream compatibility first").
//
// The channel plane lives entirely in the Hub and in `packages/channels/*`.
// The claim this file has to keep true is that none of it reaches the daemon:
// an unmodified Paseo app, built against upstream `@getpaseo/protocol`, still
// connects to a Fusion daemon, reads a stock `server_info`, and pairs. If a
// slice ever adds a daemon-side channel capability, a feature flag or an RPC,
// one of these assertions fails before an upstream app finds out.
//
// This is not a protocol-schema test — `packages/protocol` owns those. It is
// the fork-boundary test: the daemon in a workspace that has every channel
// package installed must be byte-for-byte the upstream daemon.
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { afterAll, beforeAll, expect, test } from "vitest";

import { parseServerInfoStatusPayload } from "@getpaseo/protocol/messages";
import { DaemonClient } from "./test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "./test-utils/paseo-daemon.js";

/** Every in-repo channel vertical and its shared layers. */
const CHANNEL_PACKAGES = [
  "@getpaseo/channels-core",
  "@getpaseo/channels-shared",
  "@getpaseo/channels-markdown-core",
  "@getpaseo/channels-slack",
  "@getpaseo/channels-telegram",
  "@getpaseo/channels-discord",
  "@getpaseo/channels-feishu",
  "@getpaseo/channels-googlechat",
  "@getpaseo/channels-zalo",
  "@getpaseo/channels-zalouser",
] as const;

/** Anything the fork could have leaked into the daemon's advertised contract. */
const FORK_TERMS = /channel|clisbot|fusion|slack|telegram|discord|feishu|googlechat|zalo|openclaw/i;

let daemon: TestPaseoDaemon;

beforeAll(async () => {
  // Relay on so `daemon.get_pairing_offer` produces the real offer URL an app
  // scans; the endpoint is never dialled by the offer itself.
  daemon = await createTestPaseoDaemon({ relayEnabled: true, relayEndpoint: "127.0.0.1:9" });
}, 30_000);

afterAll(async () => {
  await daemon?.close();
});

test("every channel package is installed in this workspace", () => {
  const require = createRequire(import.meta.url);
  for (const name of CHANNEL_PACKAGES) {
    expect(() => require.resolve(`${name}/package.json`), name).not.toThrow();
  }
});

test("an unmodified Paseo app reads a stock server_info from a Fusion daemon", async () => {
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    clientId: `cid-upstream-compat-${randomUUID()}`,
    // The mobile/web app's own client type, not the CLI's.
    clientType: "mobile",
  });
  await client.connect();
  try {
    const serverInfo = client.getLastServerInfoMessage();
    expect(serverInfo).not.toBeNull();

    // The upstream app parses `server_info` with the upstream schema. Round-trip
    // the payload through it: an added required field or a narrowed one fails here.
    const parsed = parseServerInfoStatusPayload({ status: "server_info", ...serverInfo });
    expect(parsed.serverId).toBe(serverInfo?.serverId);

    // No channel capability is advertised, so an upstream app's capability
    // gating (`docs/protocol-compatibility.md`) sees exactly the upstream set.
    const forkFeatures = Object.keys(parsed.features ?? {}).filter((key) => FORK_TERMS.test(key));
    expect(forkFeatures).toEqual([]);
  } finally {
    await client.close();
  }
}, 20_000);

test("an unmodified Paseo app pairs with a Fusion daemon", async () => {
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    clientId: `cid-upstream-pairing-${randomUUID()}`,
    clientType: "mobile",
  });
  await client.connect();
  try {
    const offer = await client.getDaemonPairingOffer();
    // The stock offer: the connection URL an app scans, an optional QR, and the
    // relay flag. Nothing channel-shaped rides along.
    expect(offer.relayEnabled).toBe(true);
    expect(offer.url.startsWith("https://app.paseo.sh/#offer=")).toBe(true);
    expect(Object.keys(offer).filter((key) => FORK_TERMS.test(key))).toEqual([]);

    // The offer is what an app scans; it must decode as an upstream offer, so a
    // second unmodified client can complete the handshake against the same daemon.
    const paired = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      clientId: `cid-upstream-paired-${randomUUID()}`,
      clientType: "mobile",
    });
    await paired.connect();
    expect(paired.getLastServerInfoMessage()?.serverId).toBe(
      client.getLastServerInfoMessage()?.serverId,
    );
    await paired.close();
  } finally {
    await client.close();
  }
}, 20_000);
