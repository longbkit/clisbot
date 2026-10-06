// Fusion-owned `PluginRuntime` / `createPluginRuntimeStore` for `runtime.ts`
// (D-WA-017).
//
// Upstream's plugin runtime is the OpenClaw host's capability object; the
// WhatsApp code reads exactly one member of it, `channel.runtimeContexts` — the
// in-process registry its connection controller publishes itself into so the
// send path can find the live socket (`connection-controller-runtime-context.ts`).
// Fusion supplies that registry from core's verbatim port
// (`plugins/runtime/channel-runtime-contexts.ts`) and nothing else.
import type { ChannelRuntimeSurface } from "@clisbot/channels-core/channels/plugins/channel-runtime-surface.types";
import { createChannelRuntimeContextRegistry } from "@clisbot/channels-core/plugins/runtime/channel-runtime-contexts";

export type PluginRuntime = { channel: ChannelRuntimeSurface };

type RuntimeStoreOptions = { pluginId: string; errorMessage: string } | { key: string; errorMessage: string };

/** Upstream `createPluginRuntimeStore`: one module-level slot per key. */
export function createPluginRuntimeStore<T>(options: RuntimeStoreOptions) {
  let runtime: T | null = null;
  return {
    setRuntime: (next: T) => {
      runtime = next;
    },
    getRuntime: (): T => {
      if (runtime === null) throw new Error(options.errorMessage);
      return runtime;
    },
    tryGetRuntime: (): T | null => runtime,
  };
}

/** The runtime the vertical installs once at load (see `runtime-store.ts`). */
export function createWhatsAppPluginRuntime(): PluginRuntime {
  return {
    channel: { runtimeContexts: createChannelRuntimeContextRegistry() } as ChannelRuntimeSurface,
  };
}
