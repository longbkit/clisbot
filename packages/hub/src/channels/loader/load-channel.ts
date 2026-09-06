import type { ResolveConversationFn } from "@getpaseo/channels-shared";
// Load a channel vertical in-process (plan §14.5 / implementation doc §4.1 + §4.8
// D1). `loadChannelVertical` applies the loader hooks for one channel, imports its
// entry module AND its plugin chunk (both through the Hub's own resolve/load hooks,
// so the bound `openclaw/plugin-sdk/*` subpaths hit the seam — NEVER through
// `entry.loadChannelPlugin()`, which would resolve them into the real main kernel
// and bypass the seam), injects the Hub's HostRuntime through the entry's runtime
// setter, runs the load-trace assertion (plan §6 — the loaded set must be a subset
// of the channel's own dist + its bundled node_modules + the allowlisted pure
// subpaths), and returns the entry + plugin objects plus a `dispose()`.
//
// The entry is a `defineBundledChannelEntry` object (verified on both pinned
// channels): it carries `runtime.{specifier,exportName}` naming the setter, and a
// `setChannelRuntime` that loads that specifier relative to the entry and calls the
// named export with the runtime. We call `entry.setChannelRuntime(hostRuntime)` —
// one uniform call, no per-channel setter-name hardcoding. The plugin chunk
// (pin's `plugin.{specifier,exportName}`, §4.8 D1) is the object the control plane
// actually drives: `plugin.gateway.startAccount` + `plugin.outbound`.
//
// The account stays in the hooks' process-lifetime routing registry after the
// active load ends, so drive-time lazy imports + the post-load runtime-setter
// import keep resolving to this channel's main dir (§4.8 D5); `dispose()` forgets
// it.

import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runtimeFile } from "../../runtime-files.js";
import { assertChannelsEnabled } from "./channel-gate.js";
import type { HostRuntime } from "./host.js";
import {
  activeLoadModules,
  beginChannelLoad,
  ChannelLoaderError,
  endChannelLoad,
  forgetChannel,
  registerChannelLoader,
} from "./hooks.js";
import { clearChannelRuntime, setChannelRuntime } from "./runtime-store.js";

/** The loaded channel entry object: a `defineBundledChannelEntry` result. We keep
 * it loose (the seam only needs `setChannelRuntime` + a register surface); the
 * control plane treats it as its richer typed entry. */
export interface ChannelEntry {
  kind?: string;
  id?: string;
  name?: string;
  /** Loads the channel's runtime setter export and calls it with the runtime. */
  setChannelRuntime?: (runtime: unknown) => void;
  /** Registration / plugin-load surface the control plane drives. */
  register?: (api: unknown) => void;
  loadChannelPlugin?: (options?: unknown) => unknown;
  [key: string]: unknown;
}

export interface LoadChannelVerticalOptions {
  channel: string;
  accountId: string;
  installDir: string;
  /** The pinned main package's install dir. */
  mainInstallDir: string;
  /** The channel's own package install dir (the dir the `entry` path is relative
   * to). Equals `mainInstallDir` for a `bundled` channel. */
  channelInstallDir: string;
  entry: string;
  /** The plugin chunk + named export to drive (pin's `plugin`, §4.8 D1). */
  plugin: { specifier: string; exportName: string };
  loadMode: "published" | "bundled" | "in-repo";
  hostRuntime: HostRuntime;
  /** Base dir of the in-repo host modules (defaults to the compiled `hosts/`). */
  hostBaseDir?: string;
}

/** The loaded plugin object (the pin's `plugin.{specifier,exportName}` export).
 * Vendor shape kept loose: the control plane drives `gateway.startAccount` and
 * reads `outbound` (§4.8 D1/D3); unknown keys stay open. */
export interface ChannelPlugin {
  directory?: { resolveConversation?: ResolveConversationFn | undefined };
  gateway?: { startAccount?: (ctx: unknown) => unknown };
  outbound?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface LoadedChannelVertical {
  channel: string;
  accountId: string;
  entry: ChannelEntry;
  /** The plugin object — the drive surface (§4.8 D1). */
  plugin: ChannelPlugin;
  /** The module URLs this channel's import graph pulled in (load-trace evidence). */
  loadedModules: readonly string[];
  /** Release the load: clears the account's runtime-store entry, forgets the
   * lifetime routing registration, and clears the in-progress load. The
   * process-wide loader hooks stay registered (they serve every loaded account
   * for the process lifetime, see hooks.ts), so this is safe to call repeatedly. */
  dispose(): void;
}

/** A load-trace miss: a module the channel pulled in that is outside its
 * allowlist. Fails the account at load (plan §6). */
export class LoadTraceError extends ChannelLoaderError {
  readonly unexpected: string[];
  constructor(message: string, channel: string, accountId: string, unexpected: string[]) {
    super(message, channel, accountId, "load-trace");
    this.name = "LoadTraceError";
    this.unexpected = unexpected;
  }
}

/** Allowlist roots for a channel's load-trace: its own package install dir (dist
 * + bundled node_modules), for published channels the pinned main package dir
 * (the allowlisted pure subpaths resolve into it), and the in-repo host module
 * dir (the bound seam's own code — Hub-owned, not channel supply). For a bundled
 * channel the two install dirs are the same. The synthetic seam URL sits under
 * the channel dir, so it is admitted by the channel-root check.
 *
 * An `in-repo` channel (blueprint §6.5) adds three explicit roots: its own
 * workspace package dir (already the channel root above), the shared in-repo
 * contract package (`@getpaseo/channels-shared`, workspace-linked — its module
 * URLs are the symlink's REALPATH, which resolves OUTSIDE the channel install
 * dir), and the hoisted npm deps under the repo's root node_modules (the
 * vertical's pinned third-party deps — grammy, @slack/* — hoist to the root). */
function allowlistRoots(options: LoadChannelVerticalOptions): string[] {
  const channel = pathToFileURL(options.channelInstallDir).toString();
  const roots = [channel, pathToFileURL(options.hostBaseDir ?? defaultHostBaseDir()).toString()];
  if (options.loadMode === "published") {
    const main = pathToFileURL(options.mainInstallDir).toString();
    if (main !== channel) roots.push(main);
  }
  if (options.loadMode === "in-repo") {
    for (const root of inRepoDependencyRoots()) {
      const url = pathToFileURL(root).toString();
      if (!roots.includes(url)) roots.push(url);
    }
  }
  return roots;
}

/** The in-repo dependency roots:
 * (a) the shared in-repo contract package's dir — `require.resolve` from this
 * hub file resolves the workspace link; `realpathSync` normalizes it to the
 * real package dir, where shared's module URLs actually land;
 * (b) the repo's root `node_modules` — the hoisted npm deps (grammy,
 * @slack/*) live there, OUTSIDE the channel package dir.
 * Both are derived from this file's own location: this file sits at
 * `<root>/packages/hub/{src,dist}/channels/loader/`, so six `dirname` calls
 * on its URL path land on the repo root — the layout math holds in source/dev
 * runs (tsx, vitest) and in the compiled `dist/` run alike. A missing shared
 * package throws — the vertical cannot be admitted to an unknown supply tree
 * (fail closed at load, like every other load-trace miss). */
function inRepoDependencyRoots(): string[] {
  const require = createRequire(import.meta.url);
  const sharedPackageJson = require.resolve("@getpaseo/channels-shared/package.json");
  const sharedDir = realpathSync(dirname(sharedPackageJson));
  const repoRoot = dirname(
    dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))),
  );
  return [sharedDir, join(repoRoot, "node_modules")];
}

/** Node builtins are trusted stdlib, not third-party supply: a channel may import
 * `buffer`, `crypto`, `node:fs/promises`, `net`, … freely. They resolve to
 * `node:`-prefixed URLs and are exempt from the supply allowlist. */
function isBuiltinUrl(url: string): boolean {
  return url === "node:" || url.startsWith("node:");
}

function isAdmitted(url: string, roots: string[]): boolean {
  if (isBuiltinUrl(url)) return true;
  for (const root of roots) {
    if (url === root || url.startsWith(`${root}/`)) return true;
  }
  return false;
}

function assertLoadTrace(loaded: Set<string>, options: LoadChannelVerticalOptions): string[] {
  const roots = allowlistRoots(options);
  const unexpected = [...loaded].filter((url) => !isAdmitted(url, roots));
  if (unexpected.length > 0) {
    throw new LoadTraceError(
      `load-trace miss for channel ${options.channel}: loaded ${unexpected.length} module(s) outside its allowlist (own dist + main pkg): ${unexpected.join(", ")}`,
      options.channel,
      options.accountId,
      unexpected,
    );
  }
  return [...loaded];
}

/** Load a channel vertical in-process. Throws `LoadTraceError` on a load-trace
 * miss and `ChannelLoaderError` on an unclassified subpath (both fail the account
 * at load). On success returns the entry + `dispose()`. */
export async function loadChannelVertical(
  options: LoadChannelVerticalOptions,
): Promise<LoadedChannelVertical> {
  // Kill-switch gate: refuse before touching any channel code (no hook register,
  // no entry import, no runtime injection). The index.ts wiring consults
  // `isChannelsEnabled` first; this assertion is the loader's own backstop so a
  // direct call cannot load a vertical while the plane is off.
  assertChannelsEnabled();
  // Ensure the process-wide loader hooks are registered (idempotent — the first
  // load registers them, later loads reuse the set). The hooks are inert with no
  // active load, so calling per account is safe; `dispose()` clears the active
  // load, not the process-wide hooks.
  const { dispose } = registerChannelLoader();

  const info = {
    channel: options.channel,
    accountId: options.accountId,
    loadMode: options.loadMode,
    installRoot: options.installDir,
    mainDir: options.mainInstallDir,
    channelDir: options.channelInstallDir,
    hostBaseDir: options.hostBaseDir ?? defaultHostBaseDir(),
  };
  beginChannelLoad(info);
  let entry: ChannelEntry;
  let plugin: ChannelPlugin;
  let loaded: string[];
  try {
    const mod = await importInstalledModule(options, options.entry);
    const entryValue = mod["default"] as ChannelEntry | undefined;
    if (entryValue === undefined) {
      throw new ChannelLoaderError(
        `channel ${options.channel} entry has no default export`,
        options.channel,
        options.accountId,
        options.entry,
      );
    }
    entry = entryValue;
    // The plugin chunk is a SEPARATE module from the entry (§4.8 D1) — import it
    // through the same active load so its aliased subpaths hit the seam and its
    // modules count toward the load-trace.
    const pluginMod = await importInstalledModule(options, options.plugin.specifier);
    plugin = pluginMod[options.plugin.exportName] as ChannelPlugin;
    if (plugin === undefined) {
      throw new ChannelLoaderError(
        `channel ${options.channel} plugin chunk has no "${options.plugin.exportName}" export`,
        options.channel,
        options.accountId,
        options.plugin.specifier,
      );
    }
    const loadedModules = activeLoadModules();
    if (loadedModules === undefined)
      throw new ChannelLoaderError(
        "no active load",
        options.channel,
        options.accountId,
        "load-trace",
      );
    loaded = assertLoadTrace(loadedModules, options);
  } finally {
    endChannelLoad();
  }

  // Inject the Hub runtime through the entry's uniform setter. The entry's
  // `setChannelRuntime` loads its `runtime.specifier` relative to the entry and
  // calls the named export with the runtime — one call covers both pinned channels.
  const set = entry.setChannelRuntime;
  if (typeof set !== "function")
    throw new ChannelLoaderError(
      `channel ${options.channel} entry exposes no setChannelRuntime`,
      options.channel,
      options.accountId,
      options.entry,
    );
  // The entry's setter fills the CHANNEL's own runtime store (createPluginRuntimeStore:
  // `state.openKeyedStore`, `logging.getChildLogger`, `channel.<id>.<fn>`). The Hub's
  // bound seam (hosts/channel-inbound.ts) reads a SEPARATE store keyed by
  // channel:accountId to find `onInboundReply`, so populate that one too — same
  // runtime object, so both surfaces see the identical HostRuntime.
  set(options.hostRuntime);
  setChannelRuntime(options.channel, options.accountId, options.hostRuntime);

  return {
    channel: options.channel,
    accountId: options.accountId,
    entry,
    plugin,
    loadedModules: loaded,
    dispose(): void {
      clearChannelRuntime(options.channel, options.accountId);
      // Forget the lifetime routing registration so this account's drive-time
      // imports no longer resolve through the seam (the account is stopped).
      forgetChannel(options.channel, options.accountId);
      dispose();
    },
  };
}

/** Import an installed module (the entry or the plugin chunk) by its
 * package-relative path, through the Hub's own loader hooks (the active load is
 * set, so its aliased subpaths hit the seam and its modules record into the
 * load-trace). */
async function importInstalledModule(
  options: LoadChannelVerticalOptions,
  specifier: string,
): Promise<Record<string, unknown>> {
  const url = pathToFileURL(`${options.channelInstallDir}/${normalizeEntry(specifier)}`).toString();
  return (await import(url)) as Record<string, unknown>;
}

function normalizeEntry(entry: string): string {
  return entry.replace(/^\.?\/?/u, "");
}

function defaultHostBaseDir(): string {
  // `hostBaseDir` is the dir that CONTAINS `hosts/`: the bound seam source is
  // built as `hostBaseDir + "hosts/channel-inbound.js"`, so at hub runtime this
  // is the compiled `loader/` dir. In the Vite bundle `import.meta.url` points
  // into `.output/`, which ships no host modules — the compiled ones live at
  // `dist/channels/loader/` under the package root the bin pins as the runtime
  // root (runtime-files.ts, same mechanism as `channel-pins.json`).
  const bundled = runtimeFile("dist", "channels", "loader");
  if (existsSync(join(bundled, "hosts", "channel-inbound.js"))) return bundled;
  // Source / dev runs (tsx, vitest, ts-node) fall back to this file's own dir.
  return fileURLToPath(new URL("./", import.meta.url));
}
