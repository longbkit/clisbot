// The pinned-vertical import + drive-surface contract. This is the "contract
// first, deep code second" gate for the supervisor conform: the OpenClaw
// channel verticals are EXTERNAL supply (docs/audits/pinned-vertical-contracts/),
// and the shapes the supervisor drives — `plugin.gateway.startAccount`,
// `plugin.outbound.sendText`, the loader seam against real supply — must be
// verified against the pinned bytes BEFORE the supervisor is rewritten to them.
//
// Why this test exists:
//   1. IMPORT — `loadChannelVertical` loads each pinned entry + plugin chunk
//      through the Hub's own node:module hooks. If the 96-subpath Slack matrix,
//      the load-trace allowlist, or the entry's runtime setter fails against
//      real supply, that is a LOADER or PIN finding (fix the loader / re-pin
//      the supply) — not a supervisor finding.
//   2. DRIVE SURFACE — the plugin object (NOT the entry) carries
//      `gateway.startAccount` + `outbound.sendText` (§4.8 D1 / entry-and-plugin).
//      The old supervisor drove `entry.gateway` / `entry.outbound`, which do
//      not exist on the pinned entries; this test pins the correct object so
//      the conform cannot regress.
// The flat ctxPayload normalizer + the ctx.account/ctx.cfg shapes are
// Hub-side mappings of the pinned payload — they are tested with synthetic
// payloads in the supervisor tests, not here.
//
// Runs under the real Node ESM loader (the node:module customization hooks
// only manifest there; vitest's vite-node does not consult `registerHooks`) —
// same mechanism as load-channel.native.ts. Run explicitly:
// `npm run test:contract:native`. Skips cleanly when the pinned supply is not
// extracted under OPENCLAW_SCOUT (default /tmp/openclaw-scout); the live E2E
// covers the registry-fetch + integrity path.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import { loadChannelPins } from "../install/pins.js";
import { createHostRuntime, recordingInboundHandler } from "./host.js";
import { loadChannelVertical, type LoadedChannelVertical } from "./load-channel.js";
import { clearAllChannelRuntimes, getChannelRuntime } from "./runtime-store.js";

const SCOUT = process.env["OPENCLAW_SCOUT"] ?? "/tmp/openclaw-scout";
const PINS_PATH = fileURLToPath(new URL("../../../channel-pins.json", import.meta.url));
const MAIN_DIR = join(SCOUT, "main", "package");
const SLACK_DIR = join(SCOUT, "slack", "package");

/** The pinned supply is present when both verticals' entry + plugin chunks
 * exist on disk (the pin manifest itself is loaded from the repo, not the
 * scout dir). */
function supplyPresent(): boolean {
  return (
    existsSync(join(SLACK_DIR, "dist", "index.js")) &&
    existsSync(join(SLACK_DIR, "dist", "channel-plugin-api.js")) &&
    existsSync(join(MAIN_DIR, "dist", "extensions", "telegram", "index.js")) &&
    existsSync(join(MAIN_DIR, "dist", "extensions", "telegram", "channel-plugin-api.js"))
  );
}

const SKIP = supplyPresent()
  ? false
  : `pinned OpenClaw supply not extracted under ${SCOUT} (OPENCLAW_SCOUT); the live E2E covers this contract via the registry`;

// The bound seam's host module must be a real .js file the merged seam source
// can `export { … } from` (under tsx the in-repo source is .ts; the production
// path is the compiled dist). These exports stand in for hosts/channel-inbound:
// the import contract needs them to EXIST and evaluate — their dispatch
// behavior is vitest-covered in hosts/channel-inbound.test.ts.
const FAKE_HOST = [
  "export function dispatchChannelInboundReply() { return { dispatched: false }; }",
  "export function runChannelInboundEvent() { return { dispatched: false }; }",
  "export function runPreparedInboundReply() { return { dispatched: false }; }",
  "export function dispatchReplyFromConfigWithSettledDispatcher() { return { dispatched: false }; }",
  "",
].join("\n");

describe("pinned vertical contract (import + drive surface)", () => {
  const pins = loadChannelPins(PINS_PATH);
  let hostBaseDir: string;

  after(() => {
    if (hostBaseDir !== undefined) rmSync(hostBaseDir, { recursive: true, force: true });
    clearAllChannelRuntimes();
  });

  it("the pin manifest carries both verticals' plugin pins", () => {
    const slack = pins.channels["slack"];
    const telegram = pins.channels["telegram"];
    assert.ok(slack !== undefined, "slack pin entry");
    assert.ok(telegram !== undefined, "telegram pin entry");
    assert.equal(slack.loadMode, "published");
    assert.equal(telegram.loadMode, "bundled");
  });

  it(
    "loads the pinned Slack vertical: plugin carries the drive surface, entry does not",
    {
      skip: SKIP,
    },
    async () => {
      const pin = pins.channels["slack"];
      assert.ok(pin !== undefined, "slack pin entry");
      hostBaseDir = writeFakeHost(mkdtempSync(join(tmpdir(), "hub-contract-host-")));
      const runtime = createHostRuntime({
        onInboundReply: recordingInboundHandler(() => undefined),
      });
      const loaded: LoadedChannelVertical = await loadChannelVertical({
        channel: "slack",
        accountId: "contract",
        // Routing root: every module of this account nests under the scout root
        // (main + slack package dirs both live under it).
        installDir: SCOUT,
        mainInstallDir: MAIN_DIR,
        channelInstallDir: SLACK_DIR,
        entry: pin.entry,
        plugin: pin.plugin,
        loadMode: pin.loadMode,
        hostRuntime: runtime,
        hostBaseDir,
      });
      // D1: the drive surface lives on the PLUGINS, not the entry.
      assert.equal(
        typeof loaded.plugin.gateway?.startAccount,
        "function",
        "plugin.gateway.startAccount",
      );
      assert.equal(
        typeof loaded.plugin.outbound?.["sendText"],
        "function",
        "plugin.outbound.sendText",
      );
      assert.equal(loaded.entry["gateway"], undefined, "the entry is not the plugin");
      // The load-trace admitted the full real graph: the loader's own matrix +
      // allowlist assertions already failed closed on any unclassified subpath,
      // so a completed load IS the load-time import contract. The plugin chunk
      // (the drive surface) must be in the trace — the pin's specifier.
      assert.ok(
        loaded.loadedModules.length > 500,
        `expected the full Slack import graph, got ${loaded.loadedModules.length} modules`,
      );
      const pluginChunk = pin.plugin.specifier.split("/").pop() ?? "";
      assert.ok(
        loaded.loadedModules.some((url) => url.endsWith(pluginChunk)),
        `the plugin chunk ${pluginChunk} was loaded through the Hub hooks`,
      );
      // The bound `channel-inbound` subpath's importers (the inbound pipeline +
      // provider chunks) load LAZILY at drive time, not at entry/plugin import
      // (loader-routing.md D5: the lifetime routing registry exists precisely
      // for this). The seam URL is therefore NOT expected in the load-time
      // trace; drive-time seam dispatch is the live E2E's acceptance case.
      // The Hub runtime store is populated for the account (the seam's read site).
      assert.equal(getChannelRuntime("slack", "contract"), runtime);
      loaded.dispose();
      assert.equal(getChannelRuntime("slack", "contract"), undefined);
    },
  );

  it(
    "loads the pinned Telegram vertical (bundled): drive surface present, no alias surface",
    {
      skip: SKIP,
    },
    async () => {
      const pin = pins.channels["telegram"];
      assert.ok(pin !== undefined, "telegram pin entry");
      hostBaseDir = writeFakeHost(hostBaseDir ?? mkdtempSync(join(tmpdir(), "hub-contract-host-")));
      const runtime = createHostRuntime({
        onInboundReply: recordingInboundHandler(() => undefined),
      });
      const loaded: LoadedChannelVertical = await loadChannelVertical({
        channel: "telegram",
        accountId: "contract",
        // Bundled: the entry + plugin chunk live inside the main dist, so the
        // channel dir IS the main dir; the routing root is the main dir's parent.
        installDir: join(SCOUT, "main"),
        mainInstallDir: MAIN_DIR,
        channelInstallDir: MAIN_DIR,
        entry: pin.entry,
        plugin: pin.plugin,
        loadMode: pin.loadMode,
        hostRuntime: runtime,
        hostBaseDir,
      });
      assert.equal(
        typeof loaded.plugin.gateway?.startAccount,
        "function",
        "plugin.gateway.startAccount",
      );
      assert.equal(
        typeof loaded.plugin.outbound?.["sendText"],
        "function",
        "plugin.outbound.sendText",
      );
      assert.ok(
        loaded.loadedModules.length > 50,
        `expected the bundled Telegram import graph, got ${loaded.loadedModules.length} modules`,
      );
      // Bundled Telegram's closure imports zero aliased subpaths (table-top
      // finding #0): the seam is never in its trace.
      assert.ok(
        !loaded.loadedModules.some((url) => url.includes("__hub__/")),
        "the bundled Telegram closure must not pull in the seam",
      );
      assert.equal(getChannelRuntime("telegram", "contract"), runtime);
      loaded.dispose();
      assert.equal(getChannelRuntime("telegram", "contract"), undefined);
    },
  );
});

function writeFakeHost(baseDir: string): string {
  const hostBaseDir = join(baseDir, "host");
  mkdirSync(join(hostBaseDir, "hosts"), { recursive: true });
  writeFileSync(join(hostBaseDir, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(hostBaseDir, "hosts", "channel-inbound.js"), FAKE_HOST);
  return hostBaseDir;
}
