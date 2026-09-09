// Offline tests for the per-channel install orchestrator (impl doc §4.2, plan §9
// step 1). Every tarball is a tiny in-test gzip(u) ustar buffer and the registry
// is a fake `fetch` that serves local bytes, so the whole install path — URL
// resolution, integrity verification, extraction, notices gate, the managed
// package-lock, and idempotency — runs with no network and no real npm.

import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, it } from "vitest";
import { sha512Integrity } from "./integrity.js";
import { loadChannelPins, parseChannelPins } from "./pins.js";
import type { ChannelPins } from "./pins.js";
import { ensureChannelInstalled, InstallError, resolveInstallDirs } from "./install-channel.js";

// --- in-test tarball builder -------------------------------------------------
// A minimal valid ustar tarball (gzip-compressed) with a `package/` prefix, which
// the reader in tarball.ts strips. Only regular files are produced (the install
// only ever needs files).

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width, "0");
}

function fileHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(octal(0o644, 8), 100, 8, "utf8");
  header.write("0", 108, 8, "utf8");
  header.write("0", 116, 8, "utf8");
  header.write(octal(size, 12), 124, 12, "utf8");
  header.write("0", 136, 12, "utf8");
  // checksum placeholder (spaces); computed over the whole header with the
  // checksum field as spaces, per POSIX.
  header.write(" ", 148, 8, "utf8");
  header.write("0", 156, 1, "utf8");
  header.write("ustar", 184, 6, "utf8");
  header.write("00", 200, 2, "utf8");
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += header[i] ?? 0;
  const digest = octal(sum, 6);
  header.write(digest, 148, 6, "utf8");
  header.write("\0", 154, 1, "utf8");
  header.write(" ", 155, 1, "utf8");
  return header;
}

function makeTarball(files: Record<string, string>): Uint8Array {
  const blocks: Buffer[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8");
    blocks.push(fileHeader(`package/${rel}`, data.length));
    blocks.push(data);
    const pad = 512 - (data.length % 512);
    if (pad < 512) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024)); // two-zero-block terminator
  return new Uint8Array(gzipSync(Buffer.concat(blocks)));
}

// --- fake registry ------------------------------------------------------------
// Serves a packument (with a tarball URL) and the tarball bytes, both derived from
// the pins so the orchestrator's real URL flow runs against local data.

function buildFakeRegistry(
  pins: ChannelPins,
  mainTarball: Uint8Array,
  channelTarballs: Record<string, Uint8Array>,
  extraTarballs: Record<string, Uint8Array> = {},
): typeof fetch {
  const tarballUrl = (pkg: string, version: string) =>
    `https://registry.npmjs.org/${pkg.replace(/\//gu, "%2F")}/-/${pkg.replace(/\//gu, "%2F")}-${version}.tgz`;
  const bytes = new Map<string, Uint8Array>();
  bytes.set(tarballUrl(pins.main.package, pins.main.version), mainTarball);
  for (const [name, entry] of Object.entries(pins.channels)) {
    const isMain =
      entry.channel.package === pins.main.package && entry.channel.version === pins.main.version;
    const tarball = channelTarballs[name];
    if (!isMain && tarball !== undefined)
      bytes.set(tarballUrl(entry.channel.package, entry.channel.version), tarball);
  }
  for (const [url, tarball] of Object.entries(extraTarballs)) bytes.set(url, tarball);
  const versionFor = (pkg: string): string => {
    if (pkg === pins.main.package) return pins.main.version;
    for (const entry of Object.values(pins.channels))
      if (entry.channel.package === pkg) return entry.channel.version;
    throw new Error(`fake registry: unknown package ${pkg}`);
  };
  const fake = (async (input: string | URL | Request) => {
    const url = String(input);
    const tail = url.split("registry.npmjs.org/")[1];
    if (tail !== undefined && !tail.includes("/-")) {
      const pkg = decodeURIComponent(tail);
      const version = versionFor(pkg);
      const doc = { versions: { [version]: { dist: { tarball: tarballUrl(pkg, version) } } } };
      return new Response(JSON.stringify(doc), { status: 200 });
    }
    const found = bytes.get(url);
    if (found === undefined) return new Response("no such tarball", { status: 404 });
    // makeTarball copies into a fresh exact-size ArrayBuffer, so `found.buffer`
    // is the tarball body directly (a plain ArrayBuffer, not a SharedArrayBuffer).
    return new Response(found.buffer as ArrayBuffer, { status: 200 });
  }) as unknown as typeof fetch;
  return fake;
}

// --- pin fixture --------------------------------------------------------------

/** An in-repo (blueprint §6.5) pin document: slack points at the Hub's OWN
 * workspace package (`@getpaseo/channels-shared` — the one with a built
 * `dist/` in this repo), no tarball supply; the `channel` pin stays the
 * upstream sync reference. Parsed through the real manifest schema so the
 * in-repo entry validation (inRepoPackage ⇔ loadMode) runs. */
function makeInRepoPins(mainIntegrity: string, channelIntegrity: string): ChannelPins {
  return parseChannelPins({
    registry: "https://registry.npmjs.org/",
    main: { package: "openclaw", version: "2026.7.1-2", dist: { integrity: mainIntegrity } },
    channels: {
      slack: {
        channel: {
          package: "@openclaw/slack",
          version: "2026.7.1",
          dist: {
            integrity: channelIntegrity,
            gitHead: "2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4",
          },
        },
        loadMode: "in-repo",
        inRepoPackage: "@getpaseo/channels-shared",
        entry: "./dist/index.js",
        plugin: { specifier: "./dist/plugin.js", exportName: "slackPlugin" },
        notices: "slack",
      },
    },
  });
}

function makePins(overrides: {
  mainIntegrity?: string;
  slackIntegrity?: string;
  telegramIntegrity?: string;
  mainVersion?: string;
}): ChannelPins {
  const mainIntegrity = overrides.mainIntegrity ?? "sha512-" + "A".repeat(86) + "==";
  return {
    registry: "https://registry.npmjs.org/",
    main: {
      package: "openclaw",
      version: overrides.mainVersion ?? "2026.7.1-2",
      dist: { integrity: mainIntegrity },
    },
    channels: {
      slack: {
        channel: {
          package: "@openclaw/slack",
          version: "2026.7.1",
          dist: {
            integrity: overrides.slackIntegrity ?? "sha512-" + "B".repeat(86) + "==",
            gitHead: "2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4",
          },
        },
        loadMode: "published",
        entry: "./dist/index.js",
        plugin: { specifier: "./dist/channel-plugin-api.js", exportName: "slackPlugin" },
        notices: "slack",
      },
      telegram: {
        channel: {
          package: "openclaw",
          version: overrides.mainVersion ?? "2026.7.1-2",
          dist: { integrity: overrides.telegramIntegrity ?? mainIntegrity },
        },
        loadMode: "bundled",
        entry: "./dist/extensions/telegram/index.js",
        plugin: {
          specifier: "./dist/extensions/telegram/channel-plugin-api.js",
          exportName: "telegramPlugin",
        },
        notices: "telegram",
      },
    },
  };
}

const MAIN_FILES = { "package.json": '{"name":"openclaw","type":"module"}' };
const SLACK_FILES = {
  "package.json": '{"name":"@openclaw/slack","type":"module"}',
  "dist/index.js": "export default {};",
};
const TEL_FILES = {
  "dist/extensions/telegram/index.js": "export default {};",
};

function integrityOf(buffer: Uint8Array): string {
  return sha512Integrity(buffer);
}

describe("ensureChannelInstalled", () => {
  let workDir: string;
  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "hub-install-"));
  });
  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("installs a published channel into the shared managed project: two tarballs, lockfile, entry, loadMode", async () => {
    const mainTarball = makeTarball(MAIN_FILES);
    const slackTarball = makeTarball(SLACK_FILES);
    const pins = makePins({
      mainIntegrity: integrityOf(mainTarball),
      slackIntegrity: integrityOf(slackTarball),
    });
    const dataDir = join(workDir, "acc1");
    const result = await ensureChannelInstalled(pins, "slack", "acc1", dataDir, {
      fetchImpl: buildFakeRegistry(pins, mainTarball, { slack: slackTarball }),
    });
    assert.equal(result.installed, true);
    assert.equal(result.loadMode, "published");
    assert.equal(result.entry, "./dist/index.js");
    const root = join(dataDir, "plugins", "channels");
    const mainDir = join(root, "node_modules", "openclaw");
    const channelDir = join(root, "node_modules", "@openclaw", "slack");
    assert.equal(result.installDir, root);
    assert.equal(result.mainInstallDir, mainDir);
    assert.equal(result.channelInstallDir, channelDir);
    assert.ok(existsSync(join(mainDir, "package.json")));
    assert.ok(existsSync(join(channelDir, "dist", "index.js")));
    // The shared root is one npm-style managed project: a private manifest and
    // a lock that records version, integrity, and the resolved artifact URL
    // for every pinned package.
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(manifest.name, "clisbot-channel-plugins");
    assert.equal(manifest.private, true);
    assert.deepEqual(manifest.dependencies, {
      openclaw: "2026.7.1-2",
      "@openclaw/slack": "2026.7.1",
    });
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    assert.equal(lock.lockfileVersion, 3);
    assert.equal(lock.packages["node_modules/openclaw"].version, "2026.7.1-2");
    assert.equal(lock.packages["node_modules/openclaw"].integrity, integrityOf(mainTarball));
    assert.match(lock.packages["node_modules/openclaw"].resolved, /openclaw-2026\.7\.1-2\.tgz/u);
    assert.equal(lock.packages["node_modules/@openclaw/slack"].version, "2026.7.1");
    assert.equal(
      lock.packages["node_modules/@openclaw/slack"].integrity,
      integrityOf(slackTarball),
    );
    // No custom install marker, and no per-account copy of the package code.
    assert.ok(!existsSync(join(root, "install-slack.lock")));
    assert.ok(!existsSync(join(dataDir, "channels", "acc1")));
  });

  it("is idempotent: a second run with the same pin skips the fetch", async () => {
    const mainTarball = makeTarball(MAIN_FILES);
    const slackTarball = makeTarball(SLACK_FILES);
    const pins = makePins({
      mainIntegrity: integrityOf(mainTarball),
      slackIntegrity: integrityOf(slackTarball),
    });
    const dataDir = join(workDir, "acc2");
    const fetch = buildFakeRegistry(pins, mainTarball, { slack: slackTarball });
    let calls = 0;
    const counting = ((input: string | URL | Request) => {
      calls += 1;
      return fetch(input);
    }) as typeof fetch;
    const first = await ensureChannelInstalled(pins, "slack", "acc2", dataDir, {
      fetchImpl: counting,
    });
    // A published channel fetches two tarballs; each does a URL-resolve fetch + a
    // tarball fetch, so the first install makes 4 registry calls.
    assert.equal(first.installed, true);
    assert.equal(calls, 4);
    const second = await ensureChannelInstalled(pins, "slack", "acc2", dataDir, {
      fetchImpl: counting,
    });
    assert.equal(second.installed, false);
    // Second run performs zero registry fetches (idempotent no-op).
    assert.equal(calls, 4);
  });

  it("reinstalls when the pin integrity changes", async () => {
    const mainA = makeTarball({ ...MAIN_FILES, "a.txt": "v1" });
    const slackTarball = makeTarball(SLACK_FILES);
    const dataDir = join(workDir, "acc3");
    const pinsA = makePins({
      mainIntegrity: integrityOf(mainA),
      slackIntegrity: integrityOf(slackTarball),
    });
    await ensureChannelInstalled(pinsA, "slack", "acc3", dataDir, {
      fetchImpl: buildFakeRegistry(pinsA, mainA, { slack: slackTarball }),
    });
    // Bump the main pin: new integrity → fresh install.
    const mainB = makeTarball({ ...MAIN_FILES, "a.txt": "v2" });
    const pinsB = makePins({
      mainIntegrity: integrityOf(mainB),
      slackIntegrity: integrityOf(slackTarball),
    });
    const result = await ensureChannelInstalled(pinsB, "slack", "acc3", dataDir, {
      fetchImpl: buildFakeRegistry(pinsB, mainB, { slack: slackTarball }),
    });
    assert.equal(result.installed, true);
  });

  it("refuses when the fetched bytes do not match the pinned integrity", async () => {
    const realMain = makeTarball(MAIN_FILES);
    const slackTarball = makeTarball(SLACK_FILES);
    // Pin a different integrity than the bytes actually served.
    const pins = makePins({
      mainIntegrity: integrityOf(realMain),
      slackIntegrity: integrityOf(slackTarball),
    });
    const tamperedMain = makeTarball({ ...MAIN_FILES, "evil.txt": "x" });
    await assert.rejects(
      () =>
        ensureChannelInstalled(pins, "slack", "acc4", join(workDir, "acc4"), {
          fetchImpl: buildFakeRegistry(pins, tamperedMain, { slack: slackTarball }),
        }),
      (error: unknown) =>
        error instanceof InstallError && /integrity mismatch/u.test(error.message),
    );
    // Refused before extraction: the install dir is not created.
    assert.ok(!existsSync(join(workDir, "acc4", "channels", "acc4", "openclaw@2026.7.1-2")));
  });

  it("installs a bundled channel with the main tarball only", async () => {
    const mainTarball = makeTarball({ ...MAIN_FILES, ...TEL_FILES });
    const pins = makePins({
      mainIntegrity: integrityOf(mainTarball),
      telegramIntegrity: integrityOf(mainTarball),
    });
    const dataDir = join(workDir, "acc5");
    const result = await ensureChannelInstalled(pins, "telegram", "acc5", dataDir, {
      fetchImpl: buildFakeRegistry(pins, mainTarball, {}),
    });
    assert.equal(result.installed, true);
    assert.equal(result.loadMode, "bundled");
    assert.equal(result.channelInstallDir, result.mainInstallDir);
    assert.ok(
      existsSync(join(result.mainInstallDir, "dist", "extensions", "telegram", "index.js")),
    );
    // Bundled: one tarball, one lock entry — the lock records only the main.
    const lock = JSON.parse(
      readFileSync(join(dataDir, "plugins", "channels", "package-lock.json"), "utf8"),
    );
    assert.equal(Object.keys(lock.packages).filter((key) => key !== "").length, 1);
    assert.ok(!existsSync(join(dataDir, "plugins", "channels", "install-telegram.lock")));
  });

  it("refuses to install when the channel's THIRD_PARTY_NOTICES section is missing", async () => {
    const mainTarball = makeTarball(MAIN_FILES);
    const slackTarball = makeTarball(SLACK_FILES);
    const pins = makePins({
      mainIntegrity: integrityOf(mainTarball),
      slackIntegrity: integrityOf(slackTarball),
    });
    // noticesPath that has no "slack" heading.
    const noticesPath = join(workDir, "missing-notices.md");
    writeFileSync(noticesPath, "# Nothing relevant here\n");
    await assert.rejects(
      () =>
        ensureChannelInstalled(pins, "slack", "acc6", join(workDir, "acc6"), {
          fetchImpl: buildFakeRegistry(pins, mainTarball, { slack: slackTarball }),
          noticesPath,
        }),
      /THIRD_PARTY_NOTICES section missing/u,
    );
  });

  it("provisions the main dir's dependencies when the main tarball ships a shrinkwrap", async () => {
    const typeboxTarball = makeTarball({
      "package.json": '{"name":"typebox","version":"1.3.3"}',
      "index.js": "module.exports = {};",
    });
    const shrinkwrap = JSON.stringify({
      name: "openclaw",
      lockfileVersion: 3,
      packages: {
        "": { name: "openclaw", version: "2026.7.1-2", dependencies: { typebox: "1.3.3" } },
        "node_modules/typebox": {
          version: "1.3.3",
          resolved: "https://registry.npmjs.org/typebox/-/typebox-1.3.3.tgz",
          integrity: integrityOf(typeboxTarball),
        },
      },
    });
    const mainTarball = makeTarball({ ...MAIN_FILES, "npm-shrinkwrap.json": shrinkwrap });
    const pins = makePins({ mainIntegrity: integrityOf(mainTarball) });
    const dataDir = join(workDir, "acc7");
    const fetchImpl = buildFakeRegistry(
      pins,
      mainTarball,
      {},
      {
        "https://registry.npmjs.org/typebox/-/typebox-1.3.3.tgz": typeboxTarball,
      },
    );
    const result = await ensureChannelInstalled(pins, "telegram", "acc7", dataDir, {
      fetchImpl,
    });
    assert.equal(result.installed, true);
    const mainDir = join(dataDir, "plugins", "channels", "node_modules", "openclaw");
    assert.ok(existsSync(join(mainDir, "node_modules", "typebox", "index.js")));
    // A deleted tree self-heals on the next install.
    rmSync(join(mainDir, "node_modules"), { recursive: true, force: true });
    let calls = 0;
    const counting = ((input: string | URL | Request) => {
      calls += 1;
      return fetchImpl(input);
    }) as typeof fetch;
    const second = await ensureChannelInstalled(pins, "telegram", "acc7", dataDir, {
      fetchImpl: counting,
    });
    assert.equal(second.installed, false);
    // One dependency tarball fetch, no packument lookups.
    assert.equal(calls, 1);
  });

  it("leaves a main tarball with its own node_modules alone", async () => {
    // No shrinkwrap in the main tarball → no provisioning, zero extra fetches.
    const mainTarball = makeTarball({ ...MAIN_FILES, "package.json": '{"name":"openclaw"}' });
    const slackTarball = makeTarball(SLACK_FILES);
    const pins = makePins({
      mainIntegrity: integrityOf(mainTarball),
      slackIntegrity: integrityOf(slackTarball),
    });
    const dataDir = join(workDir, "acc8");
    let calls = 0;
    const counting = ((input: string | URL | Request) => {
      calls += 1;
      return buildFakeRegistry(pins, mainTarball, { slack: slackTarball })(input);
    }) as typeof fetch;
    const result = await ensureChannelInstalled(pins, "slack", "acc8", dataDir, {
      fetchImpl: counting,
    });
    assert.equal(result.installed, true);
    // 4 calls: two packument lookups + two tarballs; no dependency fetches.
    assert.equal(calls, 4);
    // No shrinkwrap in the main tarball, so no dependency tree under it.
    assert.ok(
      !existsSync(join(dataDir, "plugins", "channels", "node_modules", "openclaw", "node_modules")),
    );
  });

  it("shares one managed project across channels and accounts: both verticals skip, none reinstalls", async () => {
    // slack (published) and telegram (bundled) pin the same main, so both
    // resolve into the ONE shared managed project. The lock must keep both
    // channels idempotent against each other, and a second account must reuse
    // the same tree without re-fetching.
    const mainTarball = makeTarball({ ...MAIN_FILES, ...TEL_FILES });
    const slackTarball = makeTarball(SLACK_FILES);
    const pins = makePins({
      mainIntegrity: integrityOf(mainTarball),
      slackIntegrity: integrityOf(slackTarball),
      telegramIntegrity: integrityOf(mainTarball),
    });
    const dataDir = join(workDir, "acc9");
    let calls = 0;
    const counting = ((input: string | URL | Request) => {
      calls += 1;
      return buildFakeRegistry(pins, mainTarball, { slack: slackTarball })(input);
    }) as typeof fetch;
    const slack = await ensureChannelInstalled(pins, "slack", "acc9", dataDir, {
      fetchImpl: counting,
    });
    assert.equal(slack.installed, true);
    const afterSlack = calls; // 4 calls: two packuments + two tarballs
    const telegram = await ensureChannelInstalled(pins, "telegram", "acc9", dataDir, {
      fetchImpl: counting,
    });
    // Bundled Telegram reuses the already-installed main package.
    assert.equal(telegram.installed, false);
    assert.equal(calls, afterSlack);
    // Simulate the next boot: both channels match the shared package lock.
    const slackAgain = await ensureChannelInstalled(pins, "slack", "acc9", dataDir, {
      fetchImpl: counting,
    });
    const telegramAgain = await ensureChannelInstalled(pins, "telegram", "acc9", dataDir, {
      fetchImpl: counting,
    });
    assert.equal(slackAgain.installed, false);
    assert.equal(telegramAgain.installed, false);
    assert.equal(calls, afterSlack);
    // A different account on the same Hub sees the same shared tree: the pin
    // matches the managed project, so resolution is a no-op with zero fetches
    // and no per-account copy.
    const otherAccount = await ensureChannelInstalled(pins, "slack", "acc9-other", dataDir, {
      fetchImpl: counting,
    });
    assert.equal(otherAccount.installed, false);
    assert.equal(otherAccount.mainInstallDir, slack.mainInstallDir);
    assert.equal(calls, afterSlack);
    assert.ok(!existsSync(join(dataDir, "channels", "acc9-other")));
    const root = join(dataDir, "plugins", "channels");
    assert.ok(existsSync(join(root, "package-lock.json")));
    assert.ok(!existsSync(join(root, "install-slack.lock")));
    assert.ok(!existsSync(join(root, "install-telegram.lock")));
  });

  it("resolves an in-repo channel from the dependency tree without mutable install state", async () => {
    // in-repo (blueprint §6.5): the Hub drives its OWN workspace package — no
    // tarball fetch, no integrity gate, no main-dir provisioning. The entry
    // module must already be built. Package-manager metadata is authoritative;
    // the Hub must not create a per-account install marker.
    const mainIntegrity = "sha512-" + "D".repeat(86) + "==";
    const slackIntegrity = "sha512-" + "C".repeat(86) + "==";
    const inRepoPins = makeInRepoPins(mainIntegrity, slackIntegrity);
    const dataDir = join(workDir, "acc-inrepo");
    rmSync(dataDir, { recursive: true, force: true });
    let calls = 0;
    const counting = ((input: string | URL | Request) => {
      calls += 1;
      return buildFakeRegistry(inRepoPins, makeTarball(MAIN_FILES), {
        slack: makeTarball(SLACK_FILES),
      })(input);
    }) as typeof fetch;
    const first = await ensureChannelInstalled(inRepoPins, "slack", "acc-inrepo", dataDir, {
      fetchImpl: counting,
    });
    assert.equal(first.installed, false); // nothing to install — resolution only
    assert.equal(first.loadMode, "in-repo");
    assert.equal(first.inRepoPackageDir, first.channelInstallDir);
    // The workspace link's realpath: packages/channels/shared (4 up from this
    // file's dir is the repo's packages/).
    assert.equal(
      first.inRepoPackageDir,
      realpathSync(new URL("../../../..", import.meta.url).pathname + join("channels", "shared")),
    );
    assert.equal(calls, 0); // zero registry fetches (no tarball path at all)
    // In-repo writes no installation metadata at all: no account dir, no
    // managed-project entry, no lockfile.
    assert.ok(!existsSync(join(dataDir, "channels", "acc-inrepo")));
    assert.ok(!existsSync(join(dataDir, "plugins", "channels", "package-lock.json")));
    assert.ok(!existsSync(join(dataDir, "plugins", "channels", "node_modules")));
    // Re-resolution is an idempotent no-op with no fetch or mutable file.
    const second = await ensureChannelInstalled(inRepoPins, "slack", "acc-inrepo", dataDir, {
      fetchImpl: counting,
    });
    assert.equal(second.installed, false);
    assert.equal(calls, 0);
    assert.ok(!existsSync(join(dataDir, "channels", "acc-inrepo")));
  });

  it("removes the legacy install-<channel>.lock marker from the account dir", async () => {
    // Pre-managed-project revisions recorded a per-account
    // `channels/<accountId>/install-<channel>.lock` even for in-repo channels.
    // The install path removes that stale marker so the account dir no longer
    // looks like an install root — nothing else in the account dir is touched.
    const inRepoPins = makeInRepoPins(
      "sha512-" + "E".repeat(86) + "==",
      "sha512-" + "F".repeat(86) + "==",
    );
    const dataDir = join(workDir, "acc-legacy");
    const accountDir = join(dataDir, "channels", "acc-legacy");
    mkdirSync(accountDir, { recursive: true });
    const legacyMarker = join(accountDir, "install-slack.lock");
    writeFileSync(legacyMarker, JSON.stringify({ channel: "slack", installedAt: "1970-01-01" }));
    const kept = join(accountDir, "state", "offset.json");
    mkdirSync(dirname(kept), { recursive: true });
    writeFileSync(kept, JSON.stringify({ offset: 123 }));

    const result = await ensureChannelInstalled(inRepoPins, "slack", "acc-legacy", dataDir, {});
    assert.equal(result.installed, false);
    assert.ok(!existsSync(legacyMarker));
    // Runtime state next to the marker survives.
    assert.ok(existsSync(kept));
  });

  it("resolves the real channel-pins.json manifest clean (trust boundary)", () => {
    const pins = loadChannelPins(new URL("../../../channel-pins.json", import.meta.url).pathname);
    assert.equal(pins.main.package, "openclaw");
    // Both verticals are pulled in-repo (blueprint §6.5): the `channel` pins
    // stay the upstream SYNC REFERENCES, but the loadMode + inRepoPackage point
    // at the Hub's own workspace packages.
    assert.equal(pins.channels["slack"]?.loadMode, "in-repo");
    assert.equal(pins.channels["slack"]?.inRepoPackage, "@getpaseo/channels-slack");
    assert.equal(pins.channels["telegram"]?.loadMode, "in-repo");
    assert.equal(pins.channels["telegram"]?.inRepoPackage, "@getpaseo/channels-telegram");
    // The entry the loader will import for the in-repo channel.
    assert.equal(pins.channels["slack"]?.entry, "./dist/index.js");
  });

  it("resolveInstallDirs keys the channel dir by its own package (published) and reuses main (bundled)", () => {
    const pins = makePins({});
    const published = resolveInstallDirs("/data", "a", pins, "slack");
    assert.ok(published.channelDir.endsWith("node_modules/@openclaw/slack"));
    const bundled = resolveInstallDirs("/data", "b", pins, "telegram");
    assert.equal(bundled.channelDir, bundled.mainDir);
  });
});
