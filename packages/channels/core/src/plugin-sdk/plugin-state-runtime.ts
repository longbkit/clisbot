// upstream: src/plugin-sdk/plugin-state-runtime.ts@5d8067a4483
// Keyed plugin-state stores for channel caches and registries.
//
// D-CORE-227: upstream backs these stores with a per-plugin SQLite database
// (`src/plugin-state/plugin-state-store.ts` over `src/infra/sqlite-strict.ts` /
// `sqlite-wal.ts`) opened from the OpenClaw state directory, and also exposes
// the blob store and the plugin runtime types. Fusion channel state is
// Hub-owned, so the store *contracts* are carried verbatim and the backend is
// injected by the host runtime (`packages/channels/telegram/src/fusion/runtime.ts`).
export {
  PluginStateStoreError,
  type OpenKeyedStoreOptions,
  type PluginStateEntry,
  type PluginStateKeyedStore,
  type PluginStateOverflowPolicy,
  type PluginStateStoreErrorCode,
  type PluginStateStoreOperation,
  type PluginStateSyncKeyedStore,
} from "../plugin-state/plugin-state-store.types.js";
/** Upstream's option type name at the barrel; `OpenKeyedStoreOptions` is the source name. */
export type { OpenKeyedStoreOptions as PluginStateStoreOptions } from "../plugin-state/plugin-state-store.types.js";

// Slice 10b addition (Slack sent-thread cache port): upstream's best-effort
// state-error reporter, carried with its body. The runtime accessor it is given
// is the channel's own (`extensions/<channel>/src/runtime.ts`), so the logging
// surface is whatever that runtime exposes.
export function createPluginStateErrorReporter(
  getRuntime: () => unknown,
  plugin: string,
  feature: string,
  message: string,
  formatError = (error: unknown): Record<string, unknown> => ({ error: String(error) }),
) {
  return (error: unknown): void => {
    try {
      const logging = (getRuntime() as { logging?: unknown } | null | undefined)?.logging as
        | {
            getChildLogger: (scope: {
              plugin: string;
              feature: string;
            }) => { warn: (message: string, meta?: unknown) => void };
          }
        | undefined;
      logging?.getChildLogger({ plugin, feature }).warn(message, formatError(error));
    } catch {
      // State fallback must remain available even when logger setup or formatting fails.
    }
  };
}
