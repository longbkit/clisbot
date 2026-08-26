// Per-channel supply install (implementation doc §4.2 / plan §9 step 1). The
// orchestrator turns a channel-pins entry into an on-disk install under
// `<dataDir>/channels/<accountId>/`: resolve the pinned main + channel tarball
// URLs, fetch them, verify `dist.integrity` BEFORE the bytes touch the install
// dir, extract with the traversal-safe `extractNpmTarball`, refuse when the
// channel's THIRD_PARTY_NOTICES section is missing (§4.6 notice 9), and record a
// per-channel install marker (`install-<channel>.lock` — the account root is
// shared by every channel pinned on the same main, so one marker per channel).
// Idempotent: an existing install whose pin matches
// is skipped; a pin bump gets a fresh versioned dir (cutover on restart, §4.2).
//
// A `published` channel ships two tarballs (shared main + its own channel
// package); a `bundled` channel (Telegram) ships the main package only, its
// entry living inside the main dist. All registry I/O flows through the
// injectable `fetch` so the whole install path runs offline against local bytes.
//
// An `in-repo` channel (blueprint §6.5) skips the supply path entirely: no
// tarball fetch, no integrity gate, no main-dir provisioning — the Hub drives
// its OWN workspace package (`inRepoPackage`, workspace-linked into the root
// node_modules). The install step only resolves that package's directory from
// the Hub's own node_modules, refuses when the pinned entry module is not built
// yet, and records the per-channel marker the loader reads. The pin's `channel`
// entry stays the upstream SYNC REFERENCE (integrity + gitHead intact).

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha512Integrity } from "./integrity.js";
import type { ChannelPinEntry, ChannelPins, LoadMode, MainPin } from "./pins.js";
import { fetchTarball, resolveTarballUrl } from "./registry.js";
import { extractNpmTarball } from "./tarball.js";
import { assertNoticesPresent } from "./notices.js";
import { isProvisioned, provisionMainDependencies } from "./provision-main.js";

/** The pin + integrity + install timestamp recorded next to an install (the
 * `install-<channel>.lock` role, §4.2). The loader reads `entry`/`loadMode` from
 * here. */
export interface InstallMarker {
  channel: string;
  accountId: string;
  loadMode: LoadMode;
  main: { package: string; version: string; integrity: string };
  channelPackage?: { package: string; version: string; integrity: string; gitHead?: string };
  entry: string;
  /** The resolved in-repo workspace package dir (`in-repo` loadMode only). */
  inRepoPackageDir?: string;
  installedAt: string;
}

export interface ChannelInstallResult {
  channel: string;
  accountId: string;
  /** The channel's install root (`<dataDir>/channels/<accountId>`). */
  installDir: string;
  /** The pinned main package's install dir (shared, reused across channels). */
  mainInstallDir: string;
  /** The channel's own package install dir (the dir the `entry` path is relative
   * to). Equals `mainInstallDir` for a `bundled` channel (entry inlined in the
   * main dist); the channel tarball's dir for a `published` one. */
  channelInstallDir: string;
  /** The channel entry module path relative to the channel install dir. */
  entry: string;
  loadMode: LoadMode;
  /** The in-repo workspace package's dir on disk (`in-repo` loadMode only) —
   * where the `entry` path and the loader's allowlist resolve. */
  inRepoPackageDir?: string;
  /** True when this call performed a fresh install; false when an existing,
   * pin-matching install was skipped (idempotent re-run). */
  installed: boolean;
}

export class InstallError extends Error {
  readonly channel?: string;
  constructor(message: string, options?: { channel?: string }) {
    super(message);
    this.name = "InstallError";
    if (options?.channel !== undefined) this.channel = options.channel;
  }
}

/** One fetched tarball about to be verified and extracted. */
interface TarballSource {
  buffer: Uint8Array;
  dir: string;
}

export interface InstallChannelOptions {
  /** Fetch override for tests (local bytes); defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Path to THIRD_PARTY_NOTICES; when present the notices gate runs before
   * extraction (§4.6 notice 9). Omitted in pure install tests. */
  noticesPath?: string;
}

/** Resolve the install dirs for the pinned main + channel packages. The main
 * dir is keyed by main package + version (shared across channels that pin the
 * same main); the channel dir is keyed by the channel's own package + version
 * (published) or reuses the main dir (bundled). */
export function resolveInstallDirs(
  dataDir: string,
  accountId: string,
  pins: ChannelPins,
  channel: string,
): { root: string; mainDir: string; channelDir: string } {
  const root = resolve(dataDir, "channels", accountId);
  const main = pins.main;
  const entry = pins.channels[channel];
  if (!entry) throw new InstallError(`unknown channel: ${channel}`, { channel });
  const mainDir = join(root, `${main.package}@${main.version}`);
  const channelDir =
    entry.channel.package === main.package && entry.channel.version === main.version
      ? mainDir
      : join(root, `${entry.channel.package}@${entry.channel.version}`);
  return { root, mainDir, channelDir };
}

/** True when a recorded install exists and its pin matches the desired pin
 * (package + version + integrity + gitHead for channel packages). */
function installMatches(
  marker: InstallMarker,
  loadMode: LoadMode,
  mainPin: MainPin,
  channelPin: {
    package: string;
    version: string;
    dist: { integrity: string; gitHead?: string | undefined };
  },
  channelIsMain: boolean,
): boolean {
  if (marker.loadMode !== loadMode) return false;
  if (marker.main.package !== mainPin.package || marker.main.integrity !== mainPin.dist.integrity)
    return false;
  if (channelIsMain) return marker.channelPackage === undefined;
  const got = marker.channelPackage;
  if (got === undefined) return false;
  if (got.package !== channelPin.package || got.version !== channelPin.version) return false;
  if (got.integrity !== channelPin.dist.integrity) return false;
  const desiredHead = channelPin.dist.gitHead;
  if (desiredHead === undefined) return got.gitHead === undefined;
  return got.gitHead === desiredHead;
}

/**
 * Resolve the in-repo channel's workspace package dir from the Hub's own
 * node_modules (blueprint §6.5: the vertical is workspace-linked into the root
 * node_modules, so `createRequire` from this hub file resolves the symlink;
 * `realpath` follows it to the package dir). Falls back to the repo's
 * `node_modules/<pkg>` when the require resolution misses (a hub installed
 * without its workspace links).
 */
function resolveInRepoPackageDir(packageName: string): string {
  const require = createRequire(import.meta.url);
  try {
    // `dirname` of the resolved `<pkg>/package.json` IS the package dir;
    // `realpath` follows the workspace symlink out of node_modules.
    return realpathSync(dirname(require.resolve(`${packageName}/package.json`)));
  } catch {
    return realpathSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "..",
        "..",
        "..",
        "node_modules",
        packageName,
      ),
    );
  }
}

/** An in-repo marker matches when its loadMode + sync-reference pin + resolved
 * package dir are all the ones the desired pin carries. */
function inRepoInstallMatches(
  marker: InstallMarker,
  entry: ChannelPinEntry,
  mainPin: MainPin,
  packageDir: string,
): boolean {
  if (marker.loadMode !== "in-repo" || marker.inRepoPackageDir !== packageDir) return false;
  if (marker.main.package !== mainPin.package || marker.main.integrity !== mainPin.dist.integrity)
    return false;
  const got = marker.channelPackage;
  if (got === undefined) return false;
  if (got.package !== entry.channel.package || got.version !== entry.channel.version) return false;
  if (got.integrity !== entry.channel.dist.integrity) return false;
  return got.gitHead === entry.channel.dist.gitHead;
}

/**
 * The in-repo install (blueprint §6.5): no tarball, no integrity, no main-dir
 * provisioning. Resolve the workspace package dir, REFUSE when the pinned
 * entry module is not built yet (the vertical's dist is missing), and record
 * the per-channel marker the loader reads. Idempotent: a matching marker
 * skips the write; the result is `installed: false` either way — there is
 * nothing to install.
 */
function ensureInRepoChannel(
  pins: ChannelPins,
  channel: string,
  entry: ChannelPinEntry,
  accountId: string,
  dataDir: string,
): ChannelInstallResult {
  const packageName = entry.inRepoPackage;
  if (packageName === undefined) {
    // Unreachable — the caller only routes here for `in-repo`, whose pin schema
    // sets `inRepoPackage` — but guard so a malformed pin fails closed, not at
    // `resolveInRepoPackageDir(undefined)`.
    throw new InstallError(`in-repo channel ${channel}: pin is missing inRepoPackage`, { channel });
  }
  const { root } = resolveInstallDirs(dataDir, accountId, pins, channel);
  const mainPin = pins.main;
  const packageDir = resolveInRepoPackageDir(packageName);
  // The entry path is relative to the package root; refuse before the marker
  // when the vertical's dist has not been built yet (`npm run build` pending).
  const entryPath = join(packageDir, entry.entry.replace(/^\.?\/?/u, ""));
  if (!existsSync(entryPath)) {
    throw new InstallError(
      `in-repo channel ${channel}: entry module ${entryPath} is not built yet (build the ${entry.inRepoPackage} workspace package first)`,
      { channel },
    );
  }
  const existing = readMarker(root, channel);
  const skipped =
    existing !== undefined && inRepoInstallMatches(existing, entry, mainPin, packageDir);
  if (!skipped) {
    writeMarker(root, channel, {
      channel,
      accountId,
      loadMode: "in-repo",
      main: {
        package: mainPin.package,
        version: mainPin.version,
        integrity: mainPin.dist.integrity,
      },
      channelPackage: {
        package: entry.channel.package,
        version: entry.channel.version,
        integrity: entry.channel.dist.integrity,
        ...(entry.channel.dist.gitHead !== undefined
          ? { gitHead: entry.channel.dist.gitHead }
          : {}),
      },
      entry: entry.entry,
      inRepoPackageDir: packageDir,
      installedAt: new Date().toISOString(),
    });
  }
  return {
    channel,
    accountId,
    installDir: root,
    mainInstallDir: packageDir,
    channelInstallDir: packageDir,
    entry: entry.entry,
    loadMode: "in-repo",
    inRepoPackageDir: packageDir,
    installed: false,
  };
}

/** Fetch one pinned tarball and verify its integrity before returning the
 * buffer. Refuses on any digest mismatch (plan §14.4 — the pin is the boundary). */
async function fetchVerifiedTarball(
  pins: ChannelPins,
  pin: {
    package: string;
    version: string;
    dist: { integrity: string; gitHead?: string | undefined };
  },
  fetchImpl: typeof fetch,
  channel: string,
): Promise<Uint8Array> {
  const url = await resolveTarballUrl(pins.registry, pin, fetchImpl);
  const buffer = await fetchTarball(url, fetchImpl);
  const actual = sha512Integrity(buffer);
  if (actual !== pin.dist.integrity) {
    throw new InstallError(
      `integrity mismatch for ${pin.package}@${pin.version}: expected ${pin.dist.integrity}, got ${actual}`,
      { channel },
    );
  }
  return buffer;
}

function readMarker(root: string, channel: string): InstallMarker | undefined {
  try {
    return JSON.parse(readFileSync(markerPath(root, channel), "utf8")) as InstallMarker;
  } catch {
    return undefined;
  }
}

function writeMarker(root: string, channel: string, marker: InstallMarker): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(markerPath(root, channel), `${JSON.stringify(marker, null, 2)}\n`, {
    mode: 0o600,
  });
}

/**
 * The per-channel marker under the shared account root. The root holds the main
 * package + every channel pinned on it, so the marker must be per-channel: a
 * single `install.lock` clobbered between verticals (slack vs telegram pin
 * different channel packages) and forced the clobbered channel into a full
 * re-fetch + re-extract on every boot.
 */
function markerPath(root: string, channel: string): string {
  return join(root, `install-${channel}.lock`);
}

/** The shared install orchestrator. Returns the install result (dirs + entry +
 * loadMode) and whether a fresh install happened. Idempotent: re-running with an
 * unchanged pin is a no-op; a pin bump installs a fresh versioned dir. */
export async function ensureChannelInstalled(
  pins: ChannelPins,
  channel: string,
  accountId: string,
  dataDir: string,
  options: InstallChannelOptions = {},
): Promise<ChannelInstallResult> {
  const entry = pins.channels[channel];
  if (!entry) throw new InstallError(`unknown channel: ${channel}`, { channel });
  // The in-repo vertical (blueprint §6.5) skips the supply path entirely: it
  // resolves the Hub's own workspace package instead of fetching tarballs.
  if (entry.loadMode === "in-repo") {
    return ensureInRepoChannel(pins, channel, entry, accountId, dataDir);
  }
  const mainPin = pins.main;
  const channelIsMain =
    entry.channel.package === mainPin.package && entry.channel.version === mainPin.version;
  const { root, mainDir, channelDir } = resolveInstallDirs(dataDir, accountId, pins, channel);

  const existing = readMarker(root, channel);
  const fetchImpl = options.fetchImpl ?? fetch;
  if (
    existing !== undefined &&
    installMatches(existing, entry.loadMode, mainPin, entry.channel, channelIsMain)
  ) {
    // Pin unchanged: the existing install is authoritative. Self-heal the
    // dependency tree if it was deleted out from under the install.
    await maybeProvisionMain(mainDir, mainPin, fetchImpl, channel);
    return {
      channel,
      accountId,
      installDir: root,
      mainInstallDir: mainDir,
      channelInstallDir: channelDir,
      entry: entry.entry,
      loadMode: entry.loadMode,
      installed: false,
    };
  }

  const sources: TarballSource[] = [
    { buffer: await fetchVerifiedTarball(pins, mainPin, fetchImpl, channel), dir: mainDir },
  ];
  if (!channelIsMain) {
    sources.push({
      buffer: await fetchVerifiedTarball(pins, entry.channel, fetchImpl, channel),
      dir: channelDir,
    });
  }
  // Integrity is verified on every source before any byte reaches the install
  // dir; only then is extraction allowed to write (plan §14.4, §9 step 1).
  if (options.noticesPath !== undefined) assertNoticesPresent(options.noticesPath, entry, channel);
  for (const source of sources) {
    mkdirSync(dirname(source.dir), { recursive: true });
    extractNpmTarball(source.buffer, source.dir);
  }
  await maybeProvisionMain(mainDir, mainPin, fetchImpl, channel);
  const now = new Date().toISOString();
  writeMarker(root, channel, {
    channel,
    accountId,
    loadMode: entry.loadMode,
    main: {
      package: mainPin.package,
      version: mainPin.version,
      integrity: mainPin.dist.integrity,
    },
    ...(channelIsMain
      ? {}
      : {
          channelPackage: {
            package: entry.channel.package,
            version: entry.channel.version,
            integrity: entry.channel.dist.integrity,
            ...(entry.channel.dist.gitHead !== undefined
              ? { gitHead: entry.channel.dist.gitHead }
              : {}),
          },
        }),
    entry: entry.entry,
    installedAt: now,
  });
  return {
    channel,
    accountId,
    installDir: root,
    mainInstallDir: mainDir,
    channelInstallDir: channelDir,
    entry: entry.entry,
    loadMode: entry.loadMode,
    installed: true,
  };
}

/**
 * Provision the main dir's dependency tree when the pinned main package
 * declares one: a main tarball that ships `npm-shrinkwrap.json` ships no
 * `node_modules` (verified against the pinned `openclaw` tarball), while one
 * that ships its own `node_modules` (the Slack tarball shape) is left alone.
 * Idempotent through the provision marker; a tree deleted out from under a
 * matching install is rebuilt on the next call.
 */
async function maybeProvisionMain(
  mainDir: string,
  mainPin: MainPin,
  fetchImpl: typeof fetch,
  channel: string,
): Promise<void> {
  if (!existsSync(join(mainDir, "npm-shrinkwrap.json"))) return;
  if (isProvisioned(mainDir, mainPin)) return;
  await provisionMainDependencies(mainDir, mainPin, fetchImpl, channel);
}
