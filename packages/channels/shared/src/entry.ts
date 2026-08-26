// The entry contract — the `defineBundledChannelEntry`-shaped entry object the
// Hub loader imports (blueprint §6.5 hard rule 2). The in-repo verticals emit
// this SAME shape the pinned OpenClaw entries carry (id + name + plugin chunk
// reference + runtime setter reference + a uniform `setChannelRuntime`), so
// the Hub's loader drives every entry with one call, no per-channel
// setter-name hardcoding.
//
// The entry is HUB-DRIVEN, not OpenClaw-registered: the Hub never calls
// `entry.register(...)` — it imports the entry module, reads the default
// export, calls `setChannelRuntime(hostRuntime)`, and separately imports the
// plugin chunk the pin names. The `register`/`loadChannelPlugin` surfaces
// exist for shape parity with the pinned contract and stay inert in-repo.

import type { HostRuntime } from "./host.js";
import type { ChannelPlugin } from "./plugin.js";

/** A `{specifier, exportName}` module reference (package-relative). */
export interface EntryModuleRef {
  specifier: string;
  exportName: string;
}

/** The options one in-repo channel's entry module passes to
 * `createChannelEntry`. */
export interface ChannelEntryOptions {
  /** The channel id (`"telegram"` / `"slack"`). */
  id: string;
  /** Display name. */
  name: string;
  /** Short description. */
  description: string;
  /** The entry module's own `import.meta.url` (the sidecar loader resolves
   * specifiers relative to it). */
  importMetaUrl: string;
  /** The plugin chunk + pinned export name (`telegramPlugin` / `slackPlugin`). */
  plugin: EntryModuleRef;
  /** The runtime-setter sidecar + export name. */
  runtime: EntryModuleRef;
}

/** The entry object the channel's `dist/index.js` default-exports. */
export interface ChannelEntry {
  readonly kind: "bundled-channel-entry";
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly plugin: EntryModuleRef;
  readonly runtime: EntryModuleRef;
  /** Inject the Hub's HostRuntime into the channel's runtime store (the
   * `runtime` sidecar's named export). One uniform call for every channel. */
  setChannelRuntime(runtime: HostRuntime): void;
  /** Shape parity with the pinned contract; inert in-repo (the Hub drives the
   * plugin chunk directly, it never registers a channel with an OpenClaw
   * kernel). */
  register(api: unknown): void;
}

/** Build the entry object. `loadRuntimeSetter` must synchronously return the
 * runtime-setter sidecar's named export (a `(runtime: HostRuntime) => void`
 * that fills the channel's own runtime store). */
export function createChannelEntry(
  options: ChannelEntryOptions,
  loadRuntimeSetter: () => (runtime: HostRuntime) => void,
): ChannelEntry {
  return {
    kind: "bundled-channel-entry",
    id: options.id,
    name: options.name,
    description: options.description,
    plugin: options.plugin,
    runtime: options.runtime,
    setChannelRuntime(runtime: HostRuntime): void {
      loadRuntimeSetter()(runtime);
    },
    register(): void {
      // Inert in-repo: the Hub drives the plugin chunk directly.
    },
  };
}

/** The plugin object shape re-exported for entry modules that also re-export
 * their plugin (the pinned chunks do; the in-repo ones keep the same habit). */
export type { ChannelPlugin };
