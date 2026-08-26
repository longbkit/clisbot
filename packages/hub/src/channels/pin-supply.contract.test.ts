// Static pin-supply contract (audit 2026-08-26-in-repo-channel-verticals.md §5).
//
// The in-repo channel verticals plan (S2) rests on structural claims about the
// PINNED OpenClaw supply: the drive surface lives on the plugin chunk, each entry
// is a defineBundledChannelEntry result, the Telegram L1 outbound closure is a
// bounded leaf set, and the pinned zalouser supply's alias subpaths classify
// against the seam matrix with exactly the known +6 gap. This test re-derives
// those claims from the pinned bytes on disk, so a re-pin or a supply change
// breaks the plan's assumptions loudly instead of silently.
//
// Static by design: it reads file text, it does not import the channel dists
// (no loader hooks, no alias routing, no process-lifetime registry). Skips
// cleanly when the pinned supply is not staged under OPENCLAW_SCOUT (default
// /tmp/openclaw-scout: main/package, slack/package, zalouser/package) — the
// same convention as vertical-contract.native.ts.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { z } from "zod";
import { BOUND_SUBPATHS, PASSTHROUGH_SUBPATHS } from "./loader/seam-matrix.js";
import { loadChannelPins } from "./install/pins.js";

const SCOUT = process.env["OPENCLAW_SCOUT"] ?? "/tmp/openclaw-scout";
const PINS_PATH = fileURLToPath(new URL("../../channel-pins.json", import.meta.url));
const MAIN_DIR = join(SCOUT, "main", "package");
const SLACK_DIR = join(SCOUT, "slack", "package");
// The zalouser pin is proposed by the audit (not yet in channel-pins.json);
// its reference pin is asserted here so the scout stage is pinned to a byte set.
const ZALOUSER_DIR = join(SCOUT, "zalouser", "package");

const SUPPLY_PRESENT =
  existsSync(join(MAIN_DIR, "dist", "extensions", "telegram", "index.js")) &&
  existsSync(join(SLACK_DIR, "dist", "index.js")) &&
  existsSync(join(ZALOUSER_DIR, "dist", "index.js"));

/** Read a package-relative file's text; every chunk here is unminified. */
function read(pkg: string, rel: string): string {
  return readFileSync(join(pkg, rel), "utf8");
}

/** The dist dir's .js chunks, package-relative (`dist/<file>`). */
function listDist(pkg: string): string[] {
  return readdirSync(join(pkg, "dist"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => `dist/${f}`);
}

/** The one dist chunk that defines `def` (content-discovered, re-pin safe). */
function findChunk(defining: string, pkg: string): string {
  const hits = listDist(pkg).filter((f) => read(pkg, f).includes(`function ${defining}(`));
  assert.equal(hits.length, 1, `exactly one chunk defines ${defining} (got ${hits.join(", ")})`);
  const chunk = hits[0];
  assert.ok(chunk !== undefined, `${defining} chunk resolved`);
  return chunk;
}

/** Import specifiers a chunk pulls in: static `from "…"` + dynamic `import("…")`. */
function importSpecifiers(text: string): string[] {
  const specs = [...text.matchAll(/from "([^"]+)"|import\("([^"]+)"\)/g)]
    .map((m) => m[1] ?? m[2])
    .filter((s): s is string => s !== undefined);
  return [...new Set(specs)];
}

/** All `openclaw/plugin-sdk/*` subpaths a package's dist chunks import. */
function sdkSubpaths(pkg: string): string[] {
  const subs = new Set<string>();
  for (const f of listDist(pkg)) {
    for (const m of read(pkg, f).matchAll(/openclaw\/plugin-sdk\/[a-zA-Z-]+/g)) {
      subs.add(m[0]);
    }
  }
  return [...subs];
}

describe.skipIf(!SUPPLY_PRESENT)("pin-supply contract (static, audit 2026-08-26)", () => {
  it("carries the pin manifest: both verticals pulled in-repo, drive pins intact, sync references kept", () => {
    const pins = loadChannelPins(PINS_PATH);
    const slack = pins.channels["slack"];
    const telegram = pins.channels["telegram"];
    assert.ok(slack !== undefined && telegram !== undefined, "both verticals pinned");
    // In-repo pull (blueprint §6.5): the Hub drives its OWN workspace packages
    // — no tarball fetch, no integrity gate at load.
    assert.equal(slack.loadMode, "in-repo");
    assert.equal(telegram.loadMode, "in-repo");
    assert.equal(slack.inRepoPackage, "@getpaseo/channels-slack");
    assert.equal(telegram.inRepoPackage, "@getpaseo/channels-telegram");
    // The loader's import targets: the built workspace package's entry + a
    // separate plugin chunk under the pinned export names.
    assert.equal(slack.entry, "./dist/index.js");
    assert.equal(telegram.entry, "./dist/index.js");
    assert.equal(slack.plugin.specifier, "./dist/plugin.js");
    assert.equal(telegram.plugin.specifier, "./dist/plugin.js");
    assert.equal(slack.plugin.exportName, "slackPlugin");
    assert.equal(telegram.plugin.exportName, "telegramPlugin");
    // The `channel` pins stay the UPSTREAM SYNC REFERENCES (integrity +
    // gitHead for the published channel package) for the re-sync loop: Slack's
    // is a separate package; Telegram's pin IS the main package (its supply
    // shape stays bundled — no alias surface, table-top finding #0).
    assert.equal(slack.channel.package, "@openclaw/slack");
    assert.equal(slack.channel.version, "2026.7.1");
    assert.match(slack.channel.dist.integrity, /^sha512-/u, "slack sync reference integrity");
    assert.match(
      slack.channel.dist.gitHead ?? "",
      /^[0-9a-f]{40}$/u,
      "slack sync reference gitHead",
    );
    assert.equal(telegram.channel.package, pins.main.package);
    assert.equal(telegram.channel.version, pins.main.version);
    assert.equal(telegram.channel.dist.integrity, pins.main.dist.integrity);
  });

  it("slack entry is a defineBundledChannelEntry result; plugin chunk re-exports the drive surface", () => {
    const entry = read(SLACK_DIR, "dist/index.js");
    assert.ok(entry.includes("defineBundledChannelEntry"), "entry uses defineBundledChannelEntry");
    assert.ok(entry.includes('id: "slack"'), "entry id is slack");
    assert.ok(
      entry.includes('specifier: "./channel-plugin-api.js"') &&
        entry.includes('exportName: "slackPlugin"'),
      "entry's plugin pin matches the manifest",
    );
    assert.ok(entry.includes("setSlackRuntime"), "entry names the runtime setter");
    const pluginChunk = read(SLACK_DIR, "dist/channel-plugin-api.js");
    assert.ok(pluginChunk.includes("slackPlugin"), "plugin chunk re-exports slackPlugin");
    // Drive surface: gateway.startAccount (an object property, not a function
    // declaration) + outbound.sendText, co-located in one chunk.
    const driveHits = listDist(SLACK_DIR).filter(
      (f) => read(SLACK_DIR, f).includes("startAccount") && read(SLACK_DIR, f).includes("sendText"),
    );
    assert.ok(driveHits.length > 0, "a slack chunk carries gateway.startAccount + sendText");
  });

  it("bundled telegram entry + plugin chunk carry the drive pins; closure is alias-free", () => {
    const entry = read(MAIN_DIR, "dist/extensions/telegram/index.js");
    assert.ok(entry.includes("defineBundledChannelEntry"), "entry uses defineBundledChannelEntry");
    assert.ok(entry.includes('id: "telegram"'), "entry id is telegram");
    assert.ok(
      entry.includes('exportName: "telegramPlugin"') && entry.includes("setTelegramRuntime"),
      "entry names the plugin export + runtime setter",
    );
    const pluginChunk = read(MAIN_DIR, "dist/extensions/telegram/channel-plugin-api.js");
    assert.ok(pluginChunk.includes("telegramPlugin"), "plugin chunk re-exports telegramPlugin");
    // The bundled telegram closure imports zero SDK subpaths (table-top finding #0):
    // every specifier it pulls is relative or bare — the seam cannot intercept it.
    for (const file of readdirSync(join(MAIN_DIR, "dist", "extensions", "telegram")).filter((n) =>
      n.endsWith(".js"),
    )) {
      assert.ok(
        !read(MAIN_DIR, `dist/extensions/telegram/${file}`).includes("openclaw/plugin-sdk/"),
        `bundled telegram ${file} must not import the SDK`,
      );
    }
  });

  it("telegram L1 outbound closure is bounded: leaf relatives + the grammy stack, and it owns the sent-message cache", () => {
    const chunk = findChunk("sendMessageTelegram", MAIN_DIR);
    const specs = importSpecifiers(read(MAIN_DIR, chunk));
    const bare = specs.filter((s) => !s.startsWith("."));
    const relative = specs.filter((s) => s.startsWith("./"));
    // L1 is a leaf closure: 30 relative leaf chunks + a small bare set. No SDK.
    assert.deepEqual(
      bare.sort(),
      ["@grammyjs/runner", "@grammyjs/transformer-throttler", "grammy"].sort(),
    );
    assert.equal(
      relative.length,
      30,
      `L1 pulls ${relative.length} relative leaf chunks (expected 30)`,
    );
    // The cache chunk is the storage seam: it opens both store flavors.
    const cacheRel = relative.find((s) => s.includes("sent-message-cache"));
    assert.ok(cacheRel !== undefined, "L1 imports the sent-message cache chunk");
    const cache = read(MAIN_DIR, `dist/${cacheRel.slice(2)}`);
    assert.ok(
      cache.includes("openKeyedStore") && cache.includes("openSyncKeyedStore"),
      "cache opens sync + async stores",
    );
    assert.ok(
      cache.includes("telegram.sent-messages") && cache.includes("telegram.message-cache"),
      "cache namespaces",
    );
    // The config write-back the in-repo port re-targets (audit §2.1.4).
    const text = read(MAIN_DIR, chunk);
    assert.ok(
      text.includes("resolveAndPersistChatId") && text.includes("replaceConfigFile"),
      "chatid write-back",
    );
  });

  it("pinned zalouser supply: published shape, seam-routable, with exactly the known +6 unclassified subpaths", () => {
    // The reference pin (audit §2.2): byte-identical staging is what the rest
    // of this test asserts against.
    const pkg = z
      .object({ version: z.string() })
      .parse(JSON.parse(read(ZALOUSER_DIR, "package.json")));
    assert.equal(pkg.version, "2026.7.1", "zalouser staged at the audit reference version");

    const entry = read(ZALOUSER_DIR, "dist/index.js");
    assert.ok(entry.includes("defineBundledChannelEntry"), "entry uses defineBundledChannelEntry");
    assert.ok(entry.includes('id: "zalouser"'), "entry id is zalouser");
    assert.ok(
      entry.includes('specifier: "./channel-plugin-api.js"') &&
        entry.includes('exportName: "zalouserPlugin"'),
      "entry's plugin pin",
    );
    assert.ok(entry.includes("setZalouserRuntime"), "entry names the runtime setter");
    const pluginChunk = read(ZALOUSER_DIR, "dist/channel-plugin-api.js");
    assert.ok(pluginChunk.includes("zalouserPlugin"), "plugin chunk re-exports zalouserPlugin");
    // Drive surface present in the zalouser dist.
    const driveHits = listDist(ZALOUSER_DIR).filter((f) =>
      read(ZALOUSER_DIR, f).includes("startAccount"),
    );
    assert.ok(driveHits.length > 0, "a zalouser chunk carries startAccount");
    assert.ok(
      driveHits.some((f) => read(ZALOUSER_DIR, f).includes("sendText")),
      "a zalouser chunk carries sendText",
    );

    // The alias surface: 37 subpaths, one of which is the BOUND seam.
    const subs = sdkSubpaths(ZALOUSER_DIR);
    assert.equal(subs.length, 37, `zalouser imports ${subs.length} SDK subpaths (expected 37)`);
    const bound = subs.filter((s) => s in BOUND_SUBPATHS);
    assert.deepEqual(
      bound,
      ["openclaw/plugin-sdk/channel-inbound"],
      "the bound seam is in zalouser's closure",
    );
    const passthrough = subs.filter((s) => PASSTHROUGH_SUBPATHS.includes(s));
    const unclassified = subs.filter(
      (s) => !(s in BOUND_SUBPATHS) && !PASSTHROUGH_SUBPATHS.includes(s),
    );
    assert.equal(passthrough.length, 30, "30 subpaths already passthrough-class");
    assert.deepEqual(
      unclassified.sort(),
      [
        "openclaw/plugin-sdk/channel-config-schema",
        "openclaw/plugin-sdk/core",
        "openclaw/plugin-sdk/setup",
        "openclaw/plugin-sdk/state-paths",
        "openclaw/plugin-sdk/temp-path",
        "openclaw/plugin-sdk/tool-results",
      ].sort(),
      "the +6 passthrough additions named in the audit",
    );

    // The +6 are real main-package exports (passthrough-class, not typos).
    const mainPkg = z
      .object({ exports: z.record(z.string(), z.unknown()).optional() })
      .parse(JSON.parse(read(MAIN_DIR, "package.json")));
    for (const sub of unclassified) {
      const exportKey = `./plugin-sdk/${sub.split("/").pop()}`;
      assert.ok(
        mainPkg.exports !== undefined && exportKey in mainPkg.exports,
        `main exports ${exportKey}`,
      );
    }
  });
});
