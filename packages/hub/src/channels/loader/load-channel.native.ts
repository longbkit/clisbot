// Native-ESM integration tests for `loadChannelVertical` (plan §14.5 / impl doc
// §4.1). The loader's defining behavior — redirecting a channel's `openclaw/*`
// imports to the Hub seam via `node:module` customization hooks — ONLY manifests
// under the real Node ESM loader. Vitest's vite-node module runner loads the entry
// through its own resolver, which does NOT consult `registerHooks`, so these tests
// run under the real Node ESM loader with tsx's type-stripping (`node --import tsx`),
// using `node:test`, not vitest. Run them explicitly:
// `npm run test:loader:native`. The filename intentionally avoids `.test.` / `.spec.`
// so the default `vitest run` glob never picks it up.
//
// The fixture is a `published` channel: a main package (with the pure plugin-sdk
// subpaths the channel's dist imports), the channel's own package (whose
// `dist/index.js` is the entry), and a fake in-repo host module so the seam merge
// is proven against a known "HOST" value without depending on the real host's
// relative `../runtime-store` import.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { ChannelsDisabledError, isChannelsEnabled } from "./channel-gate.js";
import { ChannelLoaderError } from "./hooks.js";
import {
  loadChannelVertical,
  LoadTraceError,
  type LoadChannelVerticalOptions,
} from "./load-channel.js";
import { createHostRuntime, recordingInboundHandler } from "./host.js";
import { getChannelRuntime } from "./runtime-store.js";

// The main package's pure subpaths. `channel-inbound` also exports a seam name so
// the merge must prefer the host's version; `account-id` is a pure passthrough.
const MAIN_CHANNEL_INBOUND = [
  "export function normalizeInbound(x) { return x; }",
  "export function dispatchChannelInboundReply() { return 'MAIN'; }",
  "",
].join("\n");
const MAIN_ACCOUNT_ID = "export function accountHelper() { return 'MAIN-ACCT'; }\n";

// The channel's own entry (a `defineBundledChannelEntry`-shaped object). It imports
// the bound seam + a passthrough subpath and records the injected runtime. The
// entry is NOT the drive surface — that lives on the separate PLUGIN chunk.
const ENTRY = [
  "import { dispatchChannelInboundReply, normalizeInbound } from 'openclaw/plugin-sdk/channel-inbound';",
  "import { accountHelper } from 'openclaw/plugin-sdk/account-id';",
  "const entry = {",
  "  id: 'fake-channel',",
  "  setChannelRuntime(runtime) { entry.__runtime = runtime; },",
  "  dispatchChannelInboundReply,",
  "  normalizeInbound,",
  "  accountHelper,",
  "};",
  "export default entry;",
  "",
].join("\n");

// The plugin chunk the loader must import through the same active load and
// drive: `gateway.startAccount` + `outbound` (§4.8 D1 — the entry is NOT the
// plugin; the pinned verticals carry the drive surface on a separate chunk).
const PLUGIN = [
  "export const fakePlugin = {",
  "  gateway: { startAccount(ctx) { return { accountId: ctx.accountId }; } },",
  "  outbound: { sendText: async (params) => ({ ok: true, to: params.to }) },",
  "};",
  "",
].join("\n");

// The fake Hub host module the bound seam re-exports from (matches the seam-matrix
// hostExports for the bound subpath).
const FAKE_HOST = [
  "export function dispatchChannelInboundReply() { return 'HOST'; }",
  "export function runChannelInboundEvent() { return 'HOST-EVENT'; }",
  "export function runPreparedInboundReply() { return 'HOST-PREP'; }",
  "export function dispatchReplyFromConfigWithSettledDispatcher() { return 'HOST-CONF'; }",
  "",
].join("\n");

const PKG = JSON.stringify({ type: "module" }, null, 2);

function writeTree(base: string): {
  mainDir: string;
  channelDir: string;
  hostBaseDir: string;
} {
  const mainDir = join(base, "main");
  const channelDir = join(base, "channel");
  const hostBaseDir = join(base, "host");
  const mainSdk = join(mainDir, "dist", "plugin-sdk");
  const channelDist = join(channelDir, "dist");
  const hostDir = join(hostBaseDir, "hosts");
  mkdirSync(mainSdk, { recursive: true });
  mkdirSync(channelDist, { recursive: true });
  mkdirSync(hostDir, { recursive: true });
  writeFileSync(join(mainDir, "package.json"), PKG);
  writeFileSync(join(mainSdk, "channel-inbound.js"), MAIN_CHANNEL_INBOUND);
  writeFileSync(join(mainSdk, "account-id.js"), MAIN_ACCOUNT_ID);
  writeFileSync(join(channelDir, "package.json"), PKG);
  writeFileSync(join(channelDir, "dist", "index.js"), ENTRY);
  writeFileSync(join(channelDir, "dist", "__hub__plugin.js"), PLUGIN);
  writeFileSync(join(hostBaseDir, "package.json"), PKG);
  writeFileSync(join(hostDir, "channel-inbound.js"), FAKE_HOST);
  return { mainDir, channelDir, hostBaseDir };
}

function hostRuntime() {
  return createHostRuntime({
    onInboundReply: recordingInboundHandler(() => undefined),
  });
}

describe("loadChannelVertical (native ESM loader)", () => {
  let workDir: string;
  before(() => {
    workDir = mkdtempSync(join(tmpdir(), "hub-loader-native-"));
  });
  after(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("loads a published channel: entry returned, seam picks the host, passthrough uses main", async () => {
    const base = join(workDir, "happy");
    const { mainDir, channelDir, hostBaseDir } = writeTree(base);
    const runtime = hostRuntime();
    const options: LoadChannelVerticalOptions = {
      channel: "fake",
      accountId: "acc1",
      installDir: base,
      mainInstallDir: mainDir,
      channelInstallDir: channelDir,
      entry: "dist/index.js",
      plugin: { specifier: "dist/__hub__plugin.js", exportName: "fakePlugin" },
      loadMode: "published",
      hostRuntime: runtime,
      hostBaseDir,
    };
    const loaded = await loadChannelVertical(options);
    assert.equal(loaded.channel, "fake");
    assert.equal(loaded.accountId, "acc1");
    // The entry's uniform runtime setter received the host runtime.
    assert.equal(loaded.entry["__runtime"], runtime);
    // The plugin chunk is the drive surface (§4.8 D1): loaded through the same
    // active load, distinct from the entry.
    assert.equal(typeof loaded.plugin.gateway?.startAccount, "function");
    assert.equal(typeof loaded.plugin.outbound?.["sendText"], "function");
    // The bound seam resolves to the HOST's named export (wins over the main
    // package's `export *`), while the pure normalizer stays OpenClaw's.
    const dispatch = loaded.entry["dispatchChannelInboundReply"] as () => unknown;
    const normalize = loaded.entry["normalizeInbound"] as (x: string) => unknown;
    assert.equal(dispatch(), "HOST");
    assert.equal(normalize("x"), "x");
    // The passthrough subpath resolves to the main package's real file.
    const accountHelper = loaded.entry["accountHelper"] as () => unknown;
    assert.equal(accountHelper(), "MAIN-ACCT");
    // The Hub runtime store is populated for the account so the real seam can find
    // the runtime on dispatch.
    assert.equal(getChannelRuntime("fake", "acc1"), runtime);
    // The load-trace recorded the entry + the synthetic seam URL (both admitted).
    assert.ok(loaded.loadedModules.length >= 3);
    assert.ok(loaded.loadedModules.some((u) => u.endsWith("channel/dist/index.js")));
    assert.ok(loaded.loadedModules.some((u) => u.endsWith("__hub__/channel-inbound.mjs")));
    loaded.dispose();
    // dispose() clears the account's runtime store entry.
    assert.equal(getChannelRuntime("fake", "acc1"), undefined);
  });

  it("fails the account at load when a subpath is unclassified (matrix miss)", async () => {
    const base = join(workDir, "unclassified");
    const { mainDir, channelDir, hostBaseDir } = writeTree(base);
    writeFileSync(
      join(channelDir, "dist", "index.js"),
      "import { nope } from 'openclaw/plugin-sdk/not-in-matrix';\nexport default { setChannelRuntime() {} };\n",
    );
    await assert.rejects(
      () =>
        loadChannelVertical({
          channel: "fake",
          accountId: "acc2",
          installDir: base,
          mainInstallDir: mainDir,
          channelInstallDir: channelDir,
          entry: "dist/index.js",
          plugin: { specifier: "dist/__hub__plugin.js", exportName: "fakePlugin" },
          loadMode: "published",
          hostRuntime: hostRuntime(),
          hostBaseDir,
        }),
      (error: unknown) =>
        error instanceof ChannelLoaderError && /not-in-matrix/u.test(error.message),
    );
  });

  it("fails the account at load when the channel pulls in un-allowlisted supply", async () => {
    const base = join(workDir, "loadtrace");
    const { mainDir, channelDir, hostBaseDir } = writeTree(base);
    // A sibling-of-the-channel dir that is NOT under channelInstallDir / mainDir /
    // hostBaseDir: the entry imports a file that escapes the channel's own dir.
    const rogueDir = join(base, "rogue");
    mkdirSync(rogueDir, { recursive: true });
    writeFileSync(join(rogueDir, "package.json"), PKG);
    writeFileSync(join(rogueDir, "evil.js"), "export const evil = 1;\n");
    writeFileSync(
      join(channelDir, "dist", "index.js"),
      "import { evil } from '../../rogue/evil.js';\nexport default { setChannelRuntime() {}, evil };\n",
    );
    const load = () =>
      loadChannelVertical({
        channel: "fake",
        accountId: "acc3",
        installDir: base,
        mainInstallDir: mainDir,
        channelInstallDir: channelDir,
        entry: "dist/index.js",
        plugin: { specifier: "dist/__hub__plugin.js", exportName: "fakePlugin" },
        loadMode: "published",
        hostRuntime: hostRuntime(),
        hostBaseDir,
      });
    const isRogueMiss = (error: unknown): boolean =>
      error instanceof LoadTraceError && error.unexpected.some((u) => u.includes("rogue/evil.js"));
    await assert.rejects(load, isRogueMiss);
  });

  it("refuses to load any vertical while the kill-switch is off", async () => {
    const base = join(workDir, "gate");
    const { mainDir, channelDir, hostBaseDir } = writeTree(base);
    const prior = process.env["PASEO_HUB_CHANNELS_ENABLED"];
    process.env["PASEO_HUB_CHANNELS_ENABLED"] = "0";
    try {
      await assert.rejects(
        () =>
          loadChannelVertical({
            channel: "fake",
            accountId: "acc4",
            installDir: base,
            mainInstallDir: mainDir,
            channelInstallDir: channelDir,
            entry: "dist/index.js",
            plugin: { specifier: "dist/__hub__plugin.js", exportName: "fakePlugin" },
            loadMode: "published",
            hostRuntime: hostRuntime(),
            hostBaseDir,
          }),
        (error: unknown) =>
          error instanceof ChannelsDisabledError && /disabled/u.test(error.message),
      );
    } finally {
      if (prior === undefined) delete process.env["PASEO_HUB_CHANNELS_ENABLED"];
      else process.env["PASEO_HUB_CHANNELS_ENABLED"] = prior;
    }
  });

  it("fails when the entry has no default export", async () => {
    const base = join(workDir, "nodefault");
    const { mainDir, channelDir, hostBaseDir } = writeTree(base);
    writeFileSync(join(channelDir, "dist", "index.js"), "export const x = 1;\n");
    await assert.rejects(
      () =>
        loadChannelVertical({
          channel: "fake",
          accountId: "acc5",
          installDir: base,
          mainInstallDir: mainDir,
          channelInstallDir: channelDir,
          entry: "dist/index.js",
          plugin: { specifier: "dist/__hub__plugin.js", exportName: "fakePlugin" },
          loadMode: "published",
          hostRuntime: hostRuntime(),
          hostBaseDir,
        }),
      (error: unknown) =>
        error instanceof ChannelLoaderError && /no default export/u.test(error.message),
    );
  });

  it("fails when the entry exposes no setChannelRuntime", async () => {
    const base = join(workDir, "noset");
    const { mainDir, channelDir, hostBaseDir } = writeTree(base);
    writeFileSync(join(channelDir, "dist", "index.js"), "export default { id: 'x' };\n");
    await assert.rejects(
      () =>
        loadChannelVertical({
          channel: "fake",
          accountId: "acc6",
          installDir: base,
          mainInstallDir: mainDir,
          channelInstallDir: channelDir,
          entry: "dist/index.js",
          plugin: { specifier: "dist/__hub__plugin.js", exportName: "fakePlugin" },
          loadMode: "published",
          hostRuntime: hostRuntime(),
          hostBaseDir,
        }),
      (error: unknown) =>
        error instanceof ChannelLoaderError && /no setChannelRuntime/u.test(error.message),
    );
  });

  it("isChannelsEnabled reads the operator-facing env name", () => {
    assert.equal(isChannelsEnabled({ PASEO_HUB_CHANNELS_ENABLED: "1" }), true);
    assert.equal(isChannelsEnabled({ PASEO_HUB_CHANNELS_ENABLED: "0" }), false);
    assert.equal(isChannelsEnabled({}), true);
  });
});
