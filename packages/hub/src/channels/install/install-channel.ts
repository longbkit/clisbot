// Channel package installation. Published and bundled packages are installed once
// per Hub under `<dataDir>/plugins/channels`, an npm-style managed project with
// package.json, package-lock.json, and node_modules. Accounts share immutable
// package code; account configuration and runtime state remain elsewhere under
// CLISBOT_HOME. Integrity is verified before extraction. In-repo channels keep
// loading their workspace package directly and write no installation metadata.

import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha512Integrity } from "./integrity.js";
import type { ChannelPinEntry, ChannelPins, LoadMode, MainPin } from "./pins.js";
import { fetchTarball, resolveTarballUrl } from "./registry.js";
import { extractNpmTarball } from "./tarball.js";
import { assertNoticesPresent } from "./notices.js";
import { isProvisioned, provisionMainDependencies } from "./provision-main.js";

export interface ChannelInstallResult {
  channel: string;
  accountId: string;
  /** Shared managed project root (`<dataDir>/plugins/channels`). */
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
  /** Registry URL resolved for this exact tarball.  A package-lock records the
   * concrete artifact URL as well as its integrity, so a future npm command
   * sees the same immutable package identity we verified before extraction. */
  url: string;
  package: string;
  version: string;
  integrity: string;
  dir: string;
}

export interface InstallChannelOptions {
  /** Fetch override for tests (local bytes); defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Path to THIRD_PARTY_NOTICES; when present the notices gate runs before
   * extraction (§4.6 notice 9). Omitted in pure install tests. */
  noticesPath?: string;
}

/** Resolve package dirs in the shared npm-style managed project. accountId
 * remains in the public signature for callers but deliberately does not affect
 * package placement. */
export function resolveInstallDirs(
  dataDir: string,
  _accountId: string,
  pins: ChannelPins,
  channel: string,
): { root: string; mainDir: string; channelDir: string } {
  const root = resolve(dataDir, "plugins", "channels");
  const main = pins.main;
  const entry = pins.channels[channel];
  if (!entry) throw new InstallError(`unknown channel: ${channel}`, { channel });
  const packageDir = (name: string): string => join(root, "node_modules", ...name.split("/"));
  const mainDir = packageDir(main.package);
  const channelDir =
    entry.channel.package === main.package && entry.channel.version === main.version
      ? mainDir
      : packageDir(entry.channel.package);
  return { root, mainDir, channelDir };
}

interface ManagedPackageLock {
  name: string;
  version: string;
  lockfileVersion: 3;
  requires: true;
  packages: Record<string, Record<string, unknown>>;
}

function packageKey(name: string): string {
  return `node_modules/${name}`;
}

function readManagedLock(root: string): ManagedPackageLock | undefined {
  try {
    return JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as ManagedPackageLock;
  } catch {
    return undefined;
  }
}

function managedInstallMatches(
  root: string,
  pins: ChannelPins,
  entry: ChannelPinEntry,
  mainDir: string,
  channelDir: string,
): boolean {
  const lock = readManagedLock(root);
  if (lock?.lockfileVersion !== 3) return false;
  const main = lock.packages[packageKey(pins.main.package)];
  if (main?.["version"] !== pins.main.version || main?.["integrity"] !== pins.main.dist.integrity)
    return false;
  if (!existsSync(join(mainDir, "package.json"))) return false;
  const channelIsMain =
    entry.channel.package === pins.main.package && entry.channel.version === pins.main.version;
  if (channelIsMain) return true;
  const channel = lock.packages[packageKey(entry.channel.package)];
  return (
    channel?.["version"] === entry.channel.version &&
    channel?.["integrity"] === entry.channel.dist.integrity &&
    existsSync(join(channelDir, "package.json"))
  );
}

function packageMetadata(dir: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    // These are the package-lock fields npm derives from a package manifest.
    // Keep only dependency graph fields; package scripts and arbitrary package
    // metadata do not belong in a lock.
    const fields = [
      "dependencies",
      "optionalDependencies",
      "peerDependencies",
      "peerDependenciesMeta",
      "bundledDependencies",
      "bundleDependencies",
      "bin",
      "engines",
      "os",
      "cpu",
      "hasInstallScript",
    ] as const;
    return Object.fromEntries(
      fields.flatMap((field) => (parsed[field] === undefined ? [] : [[field, parsed[field]]])),
    );
  } catch (error) {
    throw new InstallError(
      `installed package at ${dir} has no readable package.json: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Merge an npm-shrinkwrap embedded in a pinned package into the managed root
 * lock.  `openclaw` ships one, and its production dependencies are extracted
 * below `node_modules/openclaw/node_modules`; preserving those paths yields a
 * lock which describes the files actually installed, rather than a handwritten
 * top-level-only approximation.
 */
function nestedShrinkwrapEntries(
  dir: string,
  packageName: string,
): Record<string, Record<string, unknown>> {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, "npm-shrinkwrap.json"), "utf8")) as {
      lockfileVersion?: unknown;
      packages?: Record<string, Record<string, unknown>>;
    };
    if (parsed.lockfileVersion !== 3 || parsed.packages === undefined) return {};
    const prefix = packageKey(packageName);
    return Object.fromEntries(
      Object.entries(parsed.packages)
        .filter(([key]) => key !== "")
        .map(([key, value]) => [`${prefix}/${key}`, value]),
    );
  } catch {
    // Published channel tarballs commonly bundle their dependency tree and do
    // not include a shrinkwrap. Its contents are covered by the verified parent
    // tarball, so there is no separate npm lock entry to invent.
    return {};
  }
}

function removePackageLockTree(
  packages: Record<string, Record<string, unknown>>,
  name: string,
): void {
  const key = packageKey(name);
  for (const existing of Object.keys(packages)) {
    if (existing === key || existing.startsWith(`${key}/`)) delete packages[existing];
  }
}

function writeManagedProject(root: string, sources: readonly TarballSource[]): void {
  mkdirSync(root, { recursive: true });
  const prior = readManagedLock(root);
  const packages = { ...prior?.packages };
  const dependencies: Record<string, string> = {};
  for (const [key, value] of Object.entries(packages)) {
    if (
      key.startsWith("node_modules/") &&
      !key.slice("node_modules/".length).includes("/node_modules/")
    ) {
      const version = value["version"];
      if (typeof version === "string") dependencies[key.slice("node_modules/".length)] = version;
    }
  }
  for (const source of sources) {
    removePackageLockTree(packages, source.package);
    dependencies[source.package] = source.version;
    packages[packageKey(source.package)] = {
      version: source.version,
      resolved: source.url,
      integrity: source.integrity,
      ...packageMetadata(source.dir),
    };
    Object.assign(packages, nestedShrinkwrapEntries(source.dir, source.package));
  }
  packages[""] = {
    name: "clisbot-channel-plugins",
    version: "0.0.0",
    dependencies,
  };
  const packageJson = {
    name: "clisbot-channel-plugins",
    version: "0.0.0",
    private: true,
    dependencies,
  };
  const lock: ManagedPackageLock = {
    name: packageJson.name,
    version: packageJson.version,
    lockfileVersion: 3,
    requires: true,
    packages,
  };
  writeFileSync(join(root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, {
    mode: 0o600,
  });
  writeFileSync(join(root, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`, {
    mode: 0o600,
  });
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

/**
 * The in-repo install (blueprint §6.5): no tarball, no integrity, no main-dir
 * provisioning. Resolve the workspace package dir, REFUSE when the pinned
 * entry module is not built yet (the vertical's dist is missing), and record
 * no install metadata. The result is always `installed: false` because there is
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
  // Remove markers written by pre-managed-project revisions. They are no
  // longer read and leaving them behind makes the account state look like an
  // install root. Only the exact legacy marker is removed; channel runtime
  // state under the account directory is untouched.
  rmSync(join(resolve(dataDir, "channels", accountId), `install-${channel}.lock`), {
    force: true,
  });
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
): Promise<{ buffer: Uint8Array; url: string }> {
  const url = await resolveTarballUrl(pins.registry, pin, fetchImpl);
  const buffer = await fetchTarball(url, fetchImpl);
  const actual = sha512Integrity(buffer);
  if (actual !== pin.dist.integrity) {
    throw new InstallError(
      `integrity mismatch for ${pin.package}@${pin.version}: expected ${pin.dist.integrity}, got ${actual}`,
      { channel },
    );
  }
  return { buffer, url };
}

/** Fetch every tarball the pin names (main always, the channel's own package
 * when it is not the main) and verify each before returning. */
async function fetchTarballSources(
  pins: ChannelPins,
  entry: ChannelPinEntry,
  channelIsMain: boolean,
  mainDir: string,
  channelDir: string,
  fetchImpl: typeof fetch,
  channel: string,
): Promise<TarballSource[]> {
  const mainPin = pins.main;
  const mainSource = await fetchVerifiedTarball(pins, mainPin, fetchImpl, channel);
  const sources: TarballSource[] = [
    {
      ...mainSource,
      package: mainPin.package,
      version: mainPin.version,
      integrity: mainPin.dist.integrity,
      dir: mainDir,
    },
  ];
  if (!channelIsMain) {
    const channelSource = await fetchVerifiedTarball(pins, entry.channel, fetchImpl, channel);
    sources.push({
      ...channelSource,
      package: entry.channel.package,
      version: entry.channel.version,
      integrity: entry.channel.dist.integrity,
      dir: channelDir,
    });
  }
  return sources;
}

/** Extract every verified source, provision the main tree, and record the
 * managed project. Integrity has already been verified on every source before
 * this runs, so extraction is the first step allowed to write (plan §14.4,
 * §9 step 1). */
async function extractAndRecord(
  root: string,
  mainDir: string,
  mainPin: MainPin,
  sources: readonly TarballSource[],
  fetchImpl: typeof fetch,
  channel: string,
): Promise<void> {
  for (const source of sources) {
    rmSync(source.dir, { recursive: true, force: true });
    mkdirSync(dirname(source.dir), { recursive: true });
    extractNpmTarball(source.buffer, source.dir);
  }
  await maybeProvisionMain(mainDir, mainPin, fetchImpl, channel);
  writeManagedProject(root, sources);
}

/** The shared install orchestrator. Returns the install result (dirs + entry +
 * loadMode) and whether a fresh install happened. Idempotent: re-running with an
 * unchanged pin is a no-op; a pin bump re-fetches and re-records the same dirs. */
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

  const fetchImpl = options.fetchImpl ?? fetch;
  if (managedInstallMatches(root, pins, entry, mainDir, channelDir)) {
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

  const sources = await fetchTarballSources(
    pins,
    entry,
    channelIsMain,
    mainDir,
    channelDir,
    fetchImpl,
    channel,
  );
  if (options.noticesPath !== undefined) assertNoticesPresent(options.noticesPath, entry, channel);
  await extractAndRecord(root, mainDir, mainPin, sources, fetchImpl, channel);
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
