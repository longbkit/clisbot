// The pinned-vertical import + drive-surface contract. This is the "contract
// first, deep code second" gate for the supervisor conform: the drive surface —
// `plugin.gateway.startAccount`, `plugin.outbound.sendText` under the pinned
// export names, the loader seam against real supply — must be verified against
// the bytes the Hub actually loads BEFORE the supervisor is rewritten to them.
//
// Why this test exists:
//   1. IN-REPO LOAD (the live supply, blueprint §6.5) — `loadChannelVertical`
//      loads each in-repo workspace package with loadMode "in-repo". The
//      load-trace must admit the in-repo package dir + the shared contract
//      package + the hoisted root node_modules, and NO channel-inbound seam may
//      be exercised: the in-repo verticals import no `openclaw/*` subpath, so
//      the seam + alias-route serve only a future pin that declares a
//      published/bundled load — no channel in this hub's manifest does.
//   2. PUBLISHED/BUNDLED REGRESSION — the pinned OpenClaw supply under
//      OPENCLAW_SCOUT still loads through the unchanged published/bundled
//      paths: the alias route resolves its `openclaw/plugin-sdk/*` passthrough
//      subpaths, the drive surface sits on the plugin chunk (NOT the entry),
//      and the bound seam host module is still present + wired (the fake host
//      below must EXIST and evaluate; its dispatch behavior is vitest-covered
//      in hosts/channel-inbound.test.ts).
// The flat ctxPayload normalizer + the ctx.account/ctx.cfg shapes are
// Hub-side mappings of the pinned payload — they are tested with synthetic
// payloads in the supervisor tests, not here.
//
// Runs under the real Node ESM loader (the node:module customization hooks
// only manifest there; vitest's vite-node does not consult `registerHooks`) —
// same mechanism as load-channel.native.ts. Run explicitly:
// `npm run test:contract:native`. Skips cleanly per supply: the in-repo cases
// when the workspace verticals are not built, the published/bundled regression
// when the pinned supply is not extracted under OPENCLAW_SCOUT (default
// /tmp/openclaw-scout).

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, describe, it } from "node:test";
import { loadChannelPins } from "../install/pins.js";
import { createHostRuntime, recordingInboundHandler } from "./host.js";
import { loadChannelVertical, type LoadedChannelVertical } from "./load-channel.js";
import { clearAllChannelRuntimes, getChannelRuntime } from "./runtime-store.js";

const SCOUT = process.env["OPENCLAW_SCOUT"] ?? "/tmp/openclaw-scout";
const PINS_PATH = fileURLToPath(new URL("../../../channel-pins.json", import.meta.url));
// The test file's location: packages/hub/src/channels/loader/ — five up (the
// file itself is the first level) reaches the repo root.
const REPO_ROOT = fileURLToPath(new URL("../../../../..", import.meta.url));
const MAIN_DIR = join(SCOUT, "main", "package");
const SLACK_DIR = join(SCOUT, "slack", "package");

/** The in-repo workspace package dir (the workspace symlink's REALPATH — the
 * same resolution the installer's `resolveInRepoPackageDir` lands on). */
function inRepoPackageDir(packageName: string): string {
  return realpathSync(join(REPO_ROOT, "node_modules", packageName));
}

const SLACK_IN_REPO = inRepoPackageDir("@getpaseo/channels-slack");
const TELEGRAM_IN_REPO = inRepoPackageDir("@getpaseo/channels-telegram");
const DISCORD_IN_REPO = inRepoPackageDir("@getpaseo/channels-discord");
const SHARED_IN_REPO = inRepoPackageDir("@getpaseo/channels-shared");
/** The verticals wired in slices 14b/15b/16b, with the drive verbs each one
 * actually publishes. They share one case body: the contract is identical and
 * only the surface differs, so a fourth copy of the Slack case would only be a
 * fourth place to forget an assertion. */
const LATER_IN_REPO_CHANNELS = [
  {
    channel: "googlechat",
    dir: inRepoPackageDir("@getpaseo/channels-googlechat"),
    exportName: "googlechatPlugin",
    // No `typing`: Google Chat has no typing-indicator API.
    outbound: ["sendText", "updateText"],
  },
  {
    channel: "feishu",
    dir: inRepoPackageDir("@getpaseo/channels-feishu"),
    exportName: "feishuPlugin",
    outbound: ["sendText", "updateText"],
  },
  {
    channel: "zalo",
    dir: inRepoPackageDir("@getpaseo/channels-zalo"),
    exportName: "zaloPlugin",
    // The Zalo Bot API has no edit endpoint, so there is no `updateText`.
    outbound: ["sendText"],
  },
  {
    channel: "zalouser",
    dir: inRepoPackageDir("@getpaseo/channels-zalouser"),
    exportName: "zalouserPlugin",
    // Zalo Personal has no edit endpoint either; `sendMedia` is its native
    // outbound file upload.
    outbound: ["sendText", "sendMedia"],
  },
] as const;
const HOISTED_DEPS = join(REPO_ROOT, "node_modules");

function inRepoSupplyPresent(): boolean {
  return (
    existsSync(join(SLACK_IN_REPO, "dist", "index.js")) &&
    existsSync(join(SLACK_IN_REPO, "dist", "plugin.js")) &&
    existsSync(join(TELEGRAM_IN_REPO, "dist", "index.js")) &&
    existsSync(join(TELEGRAM_IN_REPO, "dist", "plugin.js")) &&
    existsSync(join(DISCORD_IN_REPO, "dist", "index.js")) &&
    existsSync(join(DISCORD_IN_REPO, "dist", "plugin.js")) &&
    existsSync(join(SHARED_IN_REPO, "dist", "index.js")) &&
    LATER_IN_REPO_CHANNELS.every(
      (entry) =>
        existsSync(join(entry.dir, "dist", "index.js")) &&
        existsSync(join(entry.dir, "dist", "plugin.js")),
    )
  );
}

/** The pinned OpenClaw supply is present when both verticals' entry + plugin
 * chunks exist on disk (the pin manifest itself is loaded from the repo, not
 * the scout dir). */
function scoutSupplyPresent(): boolean {
  return (
    existsSync(join(SLACK_DIR, "dist", "index.js")) &&
    existsSync(join(SLACK_DIR, "dist", "channel-plugin-api.js")) &&
    existsSync(join(MAIN_DIR, "dist", "extensions", "telegram", "index.js")) &&
    existsSync(join(MAIN_DIR, "dist", "extensions", "telegram", "channel-plugin-api.js"))
  );
}

const SKIP_IN_REPO = inRepoSupplyPresent()
  ? false
  : "the in-repo channel verticals are not built (@getpaseo/channels-{slack,telegram,discord,googlechat,feishu,zalo,zalouser,shared} dist missing)";
const SKIP_SCOUT = scoutSupplyPresent()
  ? false
  : `pinned OpenClaw supply not extracted under ${SCOUT} (OPENCLAW_SCOUT); the live E2E covers the published/bundled regression via the registry`;

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

  it("the pin manifest carries every vertical's in-repo pin, sync references intact", () => {
    const slack = pins.channels["slack"];
    const telegram = pins.channels["telegram"];
    const discord = pins.channels["discord"];
    assert.ok(slack !== undefined, "slack pin entry");
    assert.ok(telegram !== undefined, "telegram pin entry");
    assert.ok(discord !== undefined, "discord pin entry");
    assert.equal(discord.loadMode, "in-repo");
    assert.equal(discord.inRepoPackage, "@getpaseo/channels-discord");
    assert.equal(discord.entry, "./dist/index.js");
    assert.equal(discord.plugin.specifier, "./dist/plugin.js");
    assert.equal(discord.plugin.exportName, "discordPlugin");
    assert.equal(discord.channel.package, "@openclaw/discord");
    assert.match(discord.channel.dist.integrity, /^sha512-/u);
    // In-repo pull (blueprint §6.5): the Hub drives its OWN workspace packages
    // — no tarball fetch, no integrity gate at load.
    assert.equal(slack.loadMode, "in-repo");
    assert.equal(telegram.loadMode, "in-repo");
    assert.equal(slack.inRepoPackage, "@getpaseo/channels-slack");
    assert.equal(telegram.inRepoPackage, "@getpaseo/channels-telegram");
    assert.equal(slack.entry, "./dist/index.js");
    assert.equal(telegram.entry, "./dist/index.js");
    // The drive pins: a separate plugin chunk under the pinned export names.
    assert.equal(slack.plugin.specifier, "./dist/plugin.js");
    assert.equal(slack.plugin.exportName, "slackPlugin");
    assert.equal(telegram.plugin.specifier, "./dist/plugin.js");
    assert.equal(telegram.plugin.exportName, "telegramPlugin");
    // The `channel` pins stay the UPSTREAM SYNC REFERENCES (integrity +
    // gitHead for the published channel package) for the re-sync loop: Slack's
    // is a separate package, Telegram's IS the main package.
    assert.equal(slack.channel.package, "@openclaw/slack");
    assert.match(slack.channel.dist.integrity, /^sha512-/u);
    assert.match(slack.channel.dist.gitHead ?? "", /^[0-9a-f]{40}$/u);
    assert.equal(telegram.channel.package, pins.main.package);
    assert.equal(telegram.channel.version, pins.main.version);
    assert.equal(telegram.channel.dist.integrity, pins.main.dist.integrity);
    // The later in-repo verticals carry the same pin shape.
    for (const entry of LATER_IN_REPO_CHANNELS) {
      const pin = pins.channels[entry.channel];
      assert.ok(pin !== undefined, `${entry.channel} pin entry`);
      assert.equal(pin.loadMode, "in-repo");
      assert.equal(pin.inRepoPackage, `@getpaseo/channels-${entry.channel}`);
      assert.equal(pin.entry, "./dist/index.js");
      assert.equal(pin.plugin.specifier, "./dist/plugin.js");
      assert.equal(pin.plugin.exportName, entry.exportName);
      assert.equal(pin.channel.package, `@openclaw/${entry.channel}`);
      assert.equal(pin.notices, entry.channel);
    }
  });

  for (const entry of LATER_IN_REPO_CHANNELS) {
    it(
      `loads the in-repo ${entry.channel} vertical seam-free: drive surface under the pinned export name`,
      { skip: SKIP_IN_REPO },
      async () => {
        const pin = pins.channels[entry.channel];
        assert.ok(pin !== undefined, `${entry.channel} pin entry`);
        hostBaseDir = writeFakeHost(
          hostBaseDir ?? mkdtempSync(join(tmpdir(), "hub-contract-host-")),
        );
        const runtime = createHostRuntime({
          onInboundReply: recordingInboundHandler(() => undefined),
        });
        const loaded: LoadedChannelVertical = await loadChannelVertical({
          channel: entry.channel,
          accountId: "contract-inrepo",
          organizationId: "org",
          installDir: entry.dir,
          mainInstallDir: entry.dir,
          channelInstallDir: entry.dir,
          entry: pin.entry,
          plugin: pin.plugin,
          loadMode: pin.loadMode,
          hostRuntime: runtime,
          hostBaseDir,
        });
        assert.equal(
          typeof loaded.plugin.gateway?.startAccount,
          "function",
          `plugin.gateway.startAccount (${entry.exportName})`,
        );
        for (const verb of entry.outbound) {
          assert.equal(
            typeof loaded.plugin.outbound?.[verb],
            "function",
            `plugin.outbound.${verb} (${entry.exportName})`,
          );
        }
        // The channel-owned action adapter behind the shared `message` tool.
        assert.equal(
          typeof (loaded.plugin["actions"] as { handleAction?: unknown } | undefined)?.handleAction,
          "function",
          `plugin.actions.handleAction (${entry.exportName})`,
        );
        assert.equal(loaded.entry["gateway"], undefined, "the entry is not the plugin");
        for (const root of [entry.dir, SHARED_IN_REPO, HOISTED_DEPS]) {
          assert.ok(
            loaded.loadedModules.some((url) =>
              url.startsWith(`${pathToFileURL(root).toString()}/`),
            ),
            `${root} was admitted by the load-trace`,
          );
        }
        assert.ok(
          !loaded.loadedModules.some((url) => url.includes("__hub__/")),
          "no channel-inbound seam in the in-repo load-trace",
        );
        assert.ok(
          !loaded.loadedModules.some((url) => url.includes("openclaw")),
          "no openclaw supply in the in-repo load-trace",
        );
        assert.equal(getChannelRuntime(entry.channel, "contract-inrepo"), runtime);
        loaded.dispose();
        assert.equal(getChannelRuntime(entry.channel, "contract-inrepo"), undefined);
      },
    );
  }

  it(
    "loads the in-repo Slack vertical seam-free: drive surface under the pinned export name",
    {
      skip: SKIP_IN_REPO,
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
        accountId: "contract-inrepo",
        organizationId: "org",
        // In-repo: the entry path + the loader's allowlist resolve against the
        // workspace package dir (all three install dirs are that dir here; the
        // supervisor passes the account root as `installDir` — routing-only).
        installDir: SLACK_IN_REPO,
        mainInstallDir: SLACK_IN_REPO,
        channelInstallDir: SLACK_IN_REPO,
        entry: pin.entry,
        plugin: pin.plugin,
        loadMode: pin.loadMode,
        hostRuntime: runtime,
        hostBaseDir,
      });
      assert.equal(pin.loadMode, "in-repo", "the manifest drives the in-repo loadMode");
      // D1: the drive surface lives on the PLUGINS, under the pinned export
      // name `slackPlugin` — not the entry.
      assert.equal(
        typeof loaded.plugin.gateway?.startAccount,
        "function",
        "plugin.gateway.startAccount (slackPlugin)",
      );
      assert.equal(
        typeof loaded.plugin.outbound?.["sendText"],
        "function",
        "plugin.outbound.sendText (slackPlugin)",
      );
      // The liveness seam the Hub mounts as `typingFor` (plane/processing.ts). A
      // plugin that ships without it silently loses the whole `sync.progress`
      // typing surface — the Hub treats an absent drive as "no capability", so
      // nothing else ever says it is missing.
      assert.equal(
        typeof loaded.plugin.outbound?.["typing"],
        "function",
        "plugin.outbound.typing (slackPlugin)",
      );
      assert.equal(loaded.entry["gateway"], undefined, "the entry is not the plugin");
      // The load-trace admitted the in-repo supply: the package dir + the
      // shared contract package (the workspace link's REALPATH, OUTSIDE the
      // package dir) + the hoisted npm deps under the repo root. The loader's
      // own allowlist already failed closed on any unclassified module, so a
      // completed load IS the load-time import contract.
      assert.ok(
        loaded.loadedModules.some((url) =>
          url.startsWith(`${pathToFileURL(SLACK_IN_REPO).toString()}/`),
        ),
        "the in-repo package dir was admitted by the load-trace",
      );
      assert.ok(
        loaded.loadedModules.some((url) =>
          url.startsWith(`${pathToFileURL(SHARED_IN_REPO).toString()}/`),
        ),
        "the shared in-repo contract package was admitted by the load-trace",
      );
      assert.ok(
        loaded.loadedModules.some((url) =>
          url.startsWith(`${pathToFileURL(HOISTED_DEPS).toString()}/`),
        ),
        "the hoisted npm deps were admitted by the load-trace",
      );
      // Seam-free: the in-repo verticals import no `openclaw/*` subpath, so the
      // bound channel-inbound seam (and its alias route) is never in the
      // load-time trace.
      assert.ok(
        !loaded.loadedModules.some((url) => url.includes("__hub__/")),
        "no channel-inbound seam in the in-repo load-trace",
      );
      assert.ok(
        !loaded.loadedModules.some((url) => url.includes("openclaw")),
        "no openclaw supply in the in-repo load-trace",
      );
      // The Hub runtime store is populated for the account (the seam's read
      // site).
      assert.equal(getChannelRuntime("slack", "contract-inrepo"), runtime);
      loaded.dispose();
      assert.equal(getChannelRuntime("slack", "contract-inrepo"), undefined);
    },
  );

  it(
    "loads the in-repo Telegram vertical seam-free: drive surface under the pinned export name",
    {
      skip: SKIP_IN_REPO,
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
        accountId: "contract-inrepo",
        organizationId: "org",
        installDir: TELEGRAM_IN_REPO,
        mainInstallDir: TELEGRAM_IN_REPO,
        channelInstallDir: TELEGRAM_IN_REPO,
        entry: pin.entry,
        plugin: pin.plugin,
        loadMode: pin.loadMode,
        hostRuntime: runtime,
        hostBaseDir,
      });
      assert.equal(pin.loadMode, "in-repo", "the manifest drives the in-repo loadMode");
      assert.equal(
        typeof loaded.plugin.gateway?.startAccount,
        "function",
        "plugin.gateway.startAccount (telegramPlugin)",
      );
      assert.equal(
        typeof loaded.plugin.outbound?.["sendText"],
        "function",
        "plugin.outbound.sendText (telegramPlugin)",
      );
      assert.equal(
        typeof loaded.plugin.outbound?.["typing"],
        "function",
        "plugin.outbound.typing (telegramPlugin)",
      );
      assert.equal(loaded.entry["gateway"], undefined, "the entry is not the plugin");
      assert.ok(
        loaded.loadedModules.some((url) =>
          url.startsWith(`${pathToFileURL(TELEGRAM_IN_REPO).toString()}/`),
        ),
        "the in-repo package dir was admitted by the load-trace",
      );
      assert.ok(
        loaded.loadedModules.some((url) =>
          url.startsWith(`${pathToFileURL(SHARED_IN_REPO).toString()}/`),
        ),
        "the shared in-repo contract package was admitted by the load-trace",
      );
      assert.ok(
        loaded.loadedModules.some((url) =>
          url.startsWith(`${pathToFileURL(HOISTED_DEPS).toString()}/`),
        ),
        "the hoisted npm deps were admitted by the load-trace",
      );
      assert.ok(
        !loaded.loadedModules.some((url) => url.includes("__hub__/")),
        "no channel-inbound seam in the in-repo load-trace",
      );
      assert.ok(
        !loaded.loadedModules.some((url) => url.includes("openclaw")),
        "no openclaw supply in the in-repo load-trace",
      );
      assert.equal(getChannelRuntime("telegram", "contract-inrepo"), runtime);
      loaded.dispose();
      assert.equal(getChannelRuntime("telegram", "contract-inrepo"), undefined);
    },
  );

  it(
    "loads the in-repo Discord vertical seam-free: drive surface under the pinned export name",
    {
      skip: SKIP_IN_REPO,
    },
    async () => {
      const pin = pins.channels["discord"];
      assert.ok(pin !== undefined, "discord pin entry");
      hostBaseDir = writeFakeHost(hostBaseDir ?? mkdtempSync(join(tmpdir(), "hub-contract-host-")));
      const runtime = createHostRuntime({
        onInboundReply: recordingInboundHandler(() => undefined),
      });
      const loaded: LoadedChannelVertical = await loadChannelVertical({
        channel: "discord",
        accountId: "contract-inrepo",
        organizationId: "org",
        installDir: DISCORD_IN_REPO,
        mainInstallDir: DISCORD_IN_REPO,
        channelInstallDir: DISCORD_IN_REPO,
        entry: pin.entry,
        plugin: pin.plugin,
        loadMode: pin.loadMode,
        hostRuntime: runtime,
        hostBaseDir,
      });
      assert.equal(pin.loadMode, "in-repo", "the manifest drives the in-repo loadMode");
      assert.equal(
        typeof loaded.plugin.gateway?.startAccount,
        "function",
        "plugin.gateway.startAccount (discordPlugin)",
      );
      assert.equal(
        typeof loaded.plugin.outbound?.["sendText"],
        "function",
        "plugin.outbound.sendText (discordPlugin)",
      );
      assert.equal(
        typeof loaded.plugin.outbound?.["sendMedia"],
        "function",
        "plugin.outbound.sendMedia (discordPlugin)",
      );
      assert.equal(
        typeof loaded.plugin.outbound?.["typing"],
        "function",
        "plugin.outbound.typing (discordPlugin)",
      );
      // The channel-owned action adapter for the shared `message` tool.
      assert.equal(
        typeof (loaded.plugin["actions"] as { handleAction?: unknown } | undefined)?.handleAction,
        "function",
        "plugin.actions.handleAction (discordPlugin)",
      );
      assert.equal(loaded.entry["gateway"], undefined, "the entry is not the plugin");
      assert.ok(
        loaded.loadedModules.some((url) =>
          url.startsWith(`${pathToFileURL(DISCORD_IN_REPO).toString()}/`),
        ),
        "the in-repo package dir was admitted by the load-trace",
      );
      assert.ok(
        loaded.loadedModules.some((url) =>
          url.startsWith(`${pathToFileURL(SHARED_IN_REPO).toString()}/`),
        ),
        "the shared in-repo contract package was admitted by the load-trace",
      );
      assert.ok(
        loaded.loadedModules.some((url) =>
          url.startsWith(`${pathToFileURL(HOISTED_DEPS).toString()}/`),
        ),
        "the hoisted npm deps were admitted by the load-trace",
      );
      assert.ok(
        !loaded.loadedModules.some((url) => url.includes("__hub__/")),
        "no channel-inbound seam in the in-repo load-trace",
      );
      assert.ok(
        !loaded.loadedModules.some((url) => url.includes("openclaw")),
        "no openclaw supply in the in-repo load-trace",
      );
      assert.equal(getChannelRuntime("discord", "contract-inrepo"), runtime);
      loaded.dispose();
      assert.equal(getChannelRuntime("discord", "contract-inrepo"), undefined);
    },
  );

  it(
    "regression: the published load path still drives the pinned OpenClaw Slack supply",
    {
      skip: SKIP_SCOUT,
    },
    async () => {
      // The manifest now pulls Slack in-repo; the published shape below is the
      // PINNED SUPPLY's shape (the upstream sync reference) — the loader's
      // published path + alias route must stay intact for a pin that declares
      // it; every channel in this hub's manifest is now in-repo.
      hostBaseDir = writeFakeHost(mkdtempSync(join(tmpdir(), "hub-contract-host-")));
      const runtime = createHostRuntime({
        onInboundReply: recordingInboundHandler(() => undefined),
      });
      const loaded: LoadedChannelVertical = await loadChannelVertical({
        channel: "slack",
        accountId: "contract-published",
        organizationId: "org",
        // Routing root: every module of this account nests under the scout root
        // (main + slack package dirs both live under it).
        installDir: SCOUT,
        mainInstallDir: MAIN_DIR,
        channelInstallDir: SLACK_DIR,
        entry: "./dist/index.js",
        plugin: { specifier: "./dist/channel-plugin-api.js", exportName: "slackPlugin" },
        loadMode: "published",
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
      const pluginChunk = "channel-plugin-api.js";
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
      assert.equal(getChannelRuntime("slack", "contract-published"), runtime);
      loaded.dispose();
      assert.equal(getChannelRuntime("slack", "contract-published"), undefined);
    },
  );

  it(
    "regression: the bundled load path still drives the pinned OpenClaw Telegram supply (alias-free)",
    {
      skip: SKIP_SCOUT,
    },
    async () => {
      hostBaseDir = writeFakeHost(hostBaseDir ?? mkdtempSync(join(tmpdir(), "hub-contract-host-")));
      const runtime = createHostRuntime({
        onInboundReply: recordingInboundHandler(() => undefined),
      });
      const loaded: LoadedChannelVertical = await loadChannelVertical({
        channel: "telegram",
        accountId: "contract-bundled",
        organizationId: "org",
        // Bundled: the entry + plugin chunk live inside the main dist, so the
        // channel dir IS the main dir; the routing root is the main dir's parent.
        installDir: join(SCOUT, "main"),
        mainInstallDir: MAIN_DIR,
        channelInstallDir: MAIN_DIR,
        entry: "./dist/extensions/telegram/index.js",
        plugin: {
          specifier: "./dist/extensions/telegram/channel-plugin-api.js",
          exportName: "telegramPlugin",
        },
        loadMode: "bundled",
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
      assert.equal(getChannelRuntime("telegram", "contract-bundled"), runtime);
      loaded.dispose();
      assert.equal(getChannelRuntime("telegram", "contract-bundled"), undefined);
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
