// The node:module customization hooks that alias a channel's `openclaw/*` import
// surface to the Hub seam (plan §7 / §14.5, implementation doc §4.1 + §4.8 D5).
// One hook set per Hub process.
//
// Routing is a **process-lifetime registry**, not a single active-load slot.
// The aliased `openclaw/plugin-sdk/*` specifiers a channel's dist imports are
// resolved at three distinct times:
//   1. entry + plugin-chunk import — during the active load (load-trace window);
//   2. `entry.setChannelRuntime` — its runtime-setter chunk's `runtime-store`
//      import lands after the entry import;
//   3. drive-time lazy imports — the vertical's monitor and other modules load
//      aliased subpaths only when the account is driven (Slack loads ~42 of them
//      lazily; see §4.8 D5). These happen long after the active load is cleared.
// So the resolve hook routes aliased specifiers by matching the importing
// module's `parentURL` against every loaded channel's install root, for the
// lifetime of the process. The active load is still tracked, but only to (a)
// guard against concurrent loads and (b) record the load-trace set.
//
// Mechanism choice: the programmatic `node:module` `registerHooks({resolve,load})`
// (stable on Node 22.20) rather than `register()` + a separate hooks file. The
// difference that matters for tests: `registerHooks` runs in-process and returns a
// `ModuleHooks` handle with `deregister()`, so a test can point the loader at a fake
// channel dir + fake host module with no subprocess and no `--import` flag, and
// `dispose()` deregisters the hooks cleanly.
//
// Resolve rules for a channel's external SDK imports (`openclaw/plugin-sdk/<sub>`):
//   - BOUND subpath (seam matrix) -> a synthetic URL under the channel's install dir;
//     the load hook serves a merged module = `export *` from the pinned main's real
//     subpath (the pure normalizers, kept OpenClaw's) with the seam names re-exported
//     from the in-repo host module.
//   - PASSTHROUGH subpath (allowlisted pure) -> the pinned main package's real file
//     inside THIS channel's install dir (per-channel instance isolation).
//   - anything else -> typed throw: a matrix miss fails the account, never a
//     mid-conversation crash (§14.5).

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import type { LoadHookSync, ModuleHooks, ResolveHookSync } from "node:module";
import { BOUND_SUBPATHS, PASSTHROUGH_SUBPATHS, type BoundSubpath } from "./seam-matrix.js";

/** The plugin-sdk specifier prefix a channel's dist imports under. */
const PLUGIN_SDK_PREFIX = "openclaw/plugin-sdk/";

/** A module the loader refused to load because it is outside the channel's
 * allowlist — a matrix miss. It fails the account (plan §6 / §14.5). */
export class ChannelLoaderError extends Error {
  readonly channel: string;
  readonly accountId: string;
  readonly specifier: string;
  constructor(message: string, channel: string, accountId: string, specifier: string) {
    super(message);
    this.name = "ChannelLoaderError";
    this.channel = channel;
    this.accountId = accountId;
    this.specifier = specifier;
  }
}

/** One loaded channel account's install layout (paths; file URLs are derived at
 * the hook boundary). Registered at `beginChannelLoad` and retained for the
 * process lifetime so drive-time + post-load imports keep routing (§4.8 D5). */
export interface LoadedChannelInfo {
  channel: string;
  accountId: string;
  loadMode: "published" | "bundled";
  /** The channel's install root (`<dataDir>/channels/<accountId>`). */
  installRoot: string;
  /** The pinned main package's install dir (shared across channels pinning it). */
  mainDir: string;
  /** The channel's own package install dir (== mainDir for bundled). */
  channelDir: string;
  /** Base dir of the in-repo host modules (where `channel-inbound.js` lives). */
  hostBaseDir: string;
}

// The lifetime routing registry: `${channel}:${accountId}` -> channel info.
// Keyed by the account, NOT by the install root: the root
// (`<dataDir>/channels/<accountId>`) is shared by every channel pinned on the
// same main (slack + telegram live under one root), so a root key would make
// the second loaded channel's `beginChannelLoad` overwrite the first's entry —
// and a later `forgetChannel` of one channel would drop routing for the
// sibling still loaded under the same root. Routing itself is root-based:
// `channelForParentURL` prefix-matches the importer against each entry's
// install root, which stays exact because every entry is a distinct account.
const registry = new Map<string, LoadedChannelInfo>();
// The in-progress load (concurrency guard + load-trace set). Undefined when no
// channel is currently importing its entry/plugin.
let active: { info: LoadedChannelInfo; loaded: Set<string> } | undefined;
// Synthetic seam URL -> the info + bound subpath needed to serve its merged source.
// Populated at resolve time; consulted at load time (which may be drive-time, after
// the active load is cleared).
const seamSources = new Map<string, { info: LoadedChannelInfo; bound: BoundSubpath }>();

function isAliasedSpecifier(specifier: string): boolean {
  return specifier.startsWith(PLUGIN_SDK_PREFIX);
}

/** The resolve context for a pass-through resolution: only `parentURL` is
 * forwarded (other context fields are not part of the hook's contract). Built
 * as a separate object (rather than spread at the call site) so `parentURL` is
 * only present when defined — required under `exactOptionalPropertyTypes`. */
function resolveContext(parentURL: string | undefined): { parentURL?: string | undefined } {
  return parentURL !== undefined ? { parentURL } : {};
}

/** Match the importing module's `parentURL` against every loaded channel's
 * install root. Every module belonging to an account lives under that account's
 * install root (its channel dir and its main dir both nest under it), so a
 * prefix match on the install-root file URL identifies the owning channel. */
function channelForParentURL(parentURL: string | undefined): LoadedChannelInfo | undefined {
  if (parentURL === undefined) return undefined;
  for (const info of registry.values()) {
    const rootUrl = pathToFileURL(info.installRoot).toString();
    if (parentURL === rootUrl || parentURL.startsWith(`${rootUrl}/`)) return info;
  }
  return undefined;
}

function syntheticSeamUrlFor(info: LoadedChannelInfo): string {
  // Under the channel's install dir so the load-trace allowlist (its own dir +
  // main dir) admits the seam automatically. The `__hub__` marker dir sits inside
  // the channel dir; it does not exist on disk — the load hook serves its source.
  return pathToFileURL(join(info.channelDir, "__hub__", "channel-inbound.mjs")).toString();
}

function passthroughFileUrl(info: LoadedChannelInfo, specifier: string): string {
  const sub = specifier.slice(PLUGIN_SDK_PREFIX.length);
  return pathToFileURL(`${info.mainDir}/dist/plugin-sdk/${sub}.js`).toString();
}

/** Build the merged source for a bound subpath: the pinned main's pure subpath
 * (everything except the seam names) with the seam names re-exported from the
 * in-repo host module. `export *` + an explicit named re-export: the named export
 * wins over the star (verified ES semantics), so the seam is the Hub's and the
 * pure normalizers stay OpenClaw's. The bound subpath's main file is the one whose
 * name matches the host module path without its `hosts/` prefix. */
function boundSeamSource(info: LoadedChannelInfo, bound: BoundSubpath): string {
  const hostFile = bound.hostModule.replace(/^hosts\//u, "").replace(/\.ts$/u, ".js");
  const mainSub = pathToFileURL(join(info.mainDir, "dist", "plugin-sdk", hostFile)).toString();
  // `hostBaseDir` is the dir that CONTAINS `hosts/` (the bound hostModule path is
  // relative to it, e.g. `hosts/channel-inbound.ts`); join it so the path is
  // correct whether or not `hostBaseDir` carries a trailing separator.
  const hostUrl = pathToFileURL(
    join(info.hostBaseDir, bound.hostModule.replace(/\.ts$/u, ".js")),
  ).toString();
  const seams = bound.hostExports.map((n) => `  ${n},`).join("\n");
  return [`export * from "${mainSub}";`, `export {`, seams, `} from "${hostUrl}";`, ``].join("\n");
}

/** The resolve hook. Intercepts the channel's aliased SDK specifiers and routes
 * them for the process lifetime (registry match on `parentURL`); everything else
 * resolves normally. Every resolution is recorded into the active load's trace set
 * (only while a load is in progress) so `loadChannelVertical` can run the load-trace
 * assertion (plan §6) at load completion. */
const resolveHook: ResolveHookSync = (specifier, context, nextResolve) => {
  if (isAliasedSpecifier(specifier)) {
    const info = channelForParentURL(context.parentURL);
    if (info !== undefined) {
      const bound = BOUND_SUBPATHS[specifier];
      if (bound !== undefined) {
        const url = syntheticSeamUrlFor(info);
        seamSources.set(url, { info, bound });
        active?.loaded.add(url);
        return { url, shortCircuit: true };
      }
      if (PASSTHROUGH_SUBPATHS.includes(specifier)) {
        const url = passthroughFileUrl(info, specifier);
        active?.loaded.add(url);
        return { url, shortCircuit: true };
      }
      throw new ChannelLoaderError(
        `unclassified openclaw subpath "${specifier}" for channel ${info.channel}: not bound, not allowlisted as passthrough. Fail the account.`,
        info.channel,
        info.accountId,
        specifier,
      );
    }
    // An aliased specifier with no owning loaded channel: fall through to native
    // resolution. This is not a channel under the Hub's control, so the Hub does
    // not claim it (a channel's own dist always resolves under a registered root).
  }
  const resolved = nextResolve(specifier, resolveContext(context.parentURL));
  active?.loaded.add(resolved.url);
  return resolved;
};

/** The load hook. Only job: serve the merged source for a synthetic seam URL
 * (a path that does not exist on disk). Seam modules load at drive time as well
 * as load time, so this consults the registry-independent `seamSources` map
 * rather than the active load. Everything else loads normally. */
const loadHook: LoadHookSync = (url, context, nextLoad) => {
  const seam = seamSources.get(url);
  if (seam !== undefined) {
    const source = boundSeamSource(seam.info, seam.bound);
    // The synthetic seam URL is not on disk and was short-circuited at resolve, so
    // the load must carry `shortCircuit: true` with the source — without it Node
    // falls back to a disk read of the (non-existent) URL.
    return { format: "module", source, shortCircuit: true };
  }
  return nextLoad(url, context);
};

const HOOKS = { resolve: resolveHook, load: loadHook };

// The customization hooks are process-global. The Hub registers ONE set for the
// process lifetime: the dispatch unit is the loaded channel (registry), not a hook
// set, and a still-loaded account's seam dispatch may re-resolve modules at any
// time, so the set must stay registered while any account is loaded. Registering a
// fresh set per account would leave a redundant set in the resolve/load chain for
// the whole life of that account (N loaded accounts -> N hooks every module load
// passes through). One set, shared by every account, is correct because the routing
// is per-channel via the registry, and concurrent loads are guarded by `active`.
let processHooks: ModuleHooks | undefined;

/** Ensure the process-wide channel loader hooks are registered. Idempotent: the
 * first call registers via `registerHooks`, later calls reuse the same set.
 * Returns a `dispose()` that clears the in-progress load (defensive; the loader's
 * `endChannelLoad` already clears it). It does NOT deregister the process-wide
 * hooks, which stay available for every account loaded for the process lifetime. */
export function registerChannelLoader(): { dispose(): void } {
  processHooks ??= registerHooks(HOOKS);
  return {
    dispose(): void {
      active = undefined;
    },
  };
}

/** Register a channel account for lifetime routing and open its active load. Must
 * be paired with `endChannelLoad`. Throws if a load is already in progress
 * (channels load sequentially; concurrent loads would cross-contaminate the global
 * hooks). The account stays in the routing registry after `endChannelLoad` so its
 * drive-time + post-load imports keep resolving; `forgetChannel` removes it. */
export function beginChannelLoad(info: LoadedChannelInfo): void {
  if (active !== undefined)
    throw new ChannelLoaderError(
      "a channel load is already in progress; loads are sequential",
      info.channel,
      info.accountId,
      "load",
    );
  registry.set(registryKey(info), info);
  active = { info, loaded: new Set<string>() };
}

function registryKey(info: LoadedChannelInfo): string {
  return `${info.channel}:${info.accountId}`;
}

/** The active load's trace set (for the load-trace assertion). Undefined outside a
 * load — callers must hold the active load. */
export function activeLoadModules(): Set<string> | undefined {
  return active?.loaded;
}

/** Clear the active load. The channel stays in the routing registry. */
export function endChannelLoad(): void {
  active = undefined;
}

/** Drop a channel account from the routing registry (its account was stopped /
 * disposed). Drive-time routing for that account then falls through to native
 * resolution. Other accounts sharing the same install root keep their entries.
 * Idempotent. */
export function forgetChannel(channel: string, accountId: string): void {
  registry.delete(`${channel}:${accountId}`);
}

export { BOUND_SUBPATHS, PASSTHROUGH_SUBPATHS };
