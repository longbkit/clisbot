// Fusion-owned host adapter for `src/channels/plugins/message-action-discovery.ts` (D-CORE-011).
//
// Upstream reads the ambient process plugin registry (`src/channels/plugins/index.ts`)
// and the prepared bundled-channel catalog. Fusion has no ambient registry: the
// Hub installs the channel plugins it actually runs through
// `setChannelMessageToolPlugins`, and the catalog is built from that list.
import { AsyncLocalStorage } from "node:async_hooks";
import type { ChannelMessageActionAdapter, ChannelPlugin } from "./types.public.host-adapter.js";

export type { OpenClawConfig } from "./types.public.host-adapter.js";

export type PreparedMessageToolCatalogEntry = Readonly<{
  id: string;
  actions?: ChannelMessageActionAdapter;
  reconcilesUnknownSend: boolean;
}>;

export type PreparedMessageToolCatalog = Readonly<{
  version: number;
  channels: readonly PreparedMessageToolCatalogEntry[];
  getChannel: (id: string) => PreparedMessageToolCatalogEntry | undefined;
}>;

let registeredPlugins: readonly ChannelPlugin[] = [];
let activeCatalog: PreparedMessageToolCatalog | undefined;

/**
 * The plugin list for the call currently in flight. A multi-tenant host runs one
 * message-tool call per account and two of them overlap: a process-global list
 * would let the second call's plugin answer the first call's discovery. The
 * global list stays as the fallback for hosts and tests that install once.
 */
const callPlugins = new AsyncLocalStorage<readonly ChannelPlugin[]>();

/**
 * Installs the channel plugins the message tool discovers. The Hub calls this
 * with the accounts it actually runs; there is no ambient process registry.
 */
export function setChannelMessageToolPlugins(plugins: readonly ChannelPlugin[]): void {
  registeredPlugins = [...plugins];
}

/** Runs `run` with `plugins` as the discovered set for that call and everything it awaits. */
export function runWithChannelMessageToolPlugins<T>(
  plugins: readonly ChannelPlugin[],
  run: () => T,
): T {
  return callPlugins.run([...plugins], run);
}

function discoverablePlugins(): readonly ChannelPlugin[] {
  return callPlugins.getStore() ?? registeredPlugins;
}

/** Builds a prepared catalog with upstream's shape from an explicit plugin list. */
export function buildPreparedMessageToolCatalog(
  plugins: readonly ChannelPlugin[],
  version = 0,
): PreparedMessageToolCatalog {
  const channels = Object.freeze(
    plugins.map((plugin) =>
      Object.freeze({
        id: plugin.id,
        ...(plugin.actions ? { actions: plugin.actions } : {}),
        reconcilesUnknownSend:
          plugin.message?.durableFinal?.capabilities?.reconcileUnknownSend === true &&
          typeof plugin.message.durableFinal.reconcileUnknownSend === "function",
      }),
    ),
  );
  const byId = new Map(channels.map((entry) => [entry.id, entry]));
  return Object.freeze({
    version,
    channels,
    getChannel: (id: string) => byId.get(id),
  });
}

/** Sets the catalog returned to callers that do not pass one explicitly. */
export function setPreparedMessageToolCatalog(
  catalog: PreparedMessageToolCatalog | undefined,
): void {
  activeCatalog = catalog;
}

/** Returns the catalog for the active channel generation without rebuilding it. */
export function getPreparedMessageToolCatalog(): PreparedMessageToolCatalog | undefined {
  return activeCatalog;
}

export function listChannelPlugins(): readonly ChannelPlugin[] {
  return discoverablePlugins();
}

export function getChannelPlugin(id: string): ChannelPlugin | undefined {
  const normalized = normalizeAnyChannelId(id);
  return discoverablePlugins().find((plugin) => plugin.id === (normalized ?? id));
}

/**
 * Fusion registers only already-loaded plugins, so loaded and registered are the
 * same set; upstream distinguishes them to avoid materializing lazy plugins.
 */
export function getLoadedChannelPlugin(id: string): ChannelPlugin | undefined {
  return getChannelPlugin(id);
}

/** Normalizes a channel id or plugin-declared alias against the installed plugins. */
export function normalizeAnyChannelId(raw?: string | null): string | null {
  const key = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!key) {
    return null;
  }
  const match = discoverablePlugins().find(
    (plugin) => plugin.id === key || plugin.meta?.aliases?.includes(key) === true,
  );
  return match?.id ?? null;
}

export type MessageToolDiscoveryRuntime = {
  error: (message: string) => void;
};

/**
 * Upstream logs discovery failures through the global runtime. Fusion keeps the
 * same call shape and lets the host replace the sink.
 */
export const defaultRuntime: MessageToolDiscoveryRuntime = {
  error: (message: string) => {
    console.error(message);
  },
};

/** Replaces the discovery log sink (Hub logger in production, spy in tests). */
export function setMessageToolDiscoveryRuntimeErrorSink(sink: (message: string) => void): void {
  defaultRuntime.error = sink;
}
