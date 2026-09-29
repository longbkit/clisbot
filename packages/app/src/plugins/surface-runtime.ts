import { useEffect, useState } from "react";
import type { InstalledPlugin } from "./types";
import { createClisbotApi, type ClisbotApi } from "@clisbot/client";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";

export interface PluginSurfaceRuntime {
  clisbot: ClisbotApi;
  invoke(method: string, input: unknown): Promise<unknown>;
}

export function createPluginSurfaceRuntime(
  client: DaemonClient | null,
  plugin: Pick<InstalledPlugin, "id" | "lifetime">,
): PluginSurfaceRuntime | null {
  if (!client || plugin.lifetime.signal.aborted) return null;
  return {
    clisbot: createClisbotApi(client, { signal: plugin.lifetime.signal }),
    invoke: (method, input) => client.invokePluginRpc(plugin.id, method, input),
  };
}

/** A mounted surface owns its API; creating a React element creates no server demand. */
export function usePluginSurfaceRuntime(
  client: DaemonClient | null,
  plugin: InstalledPlugin | null | undefined,
): PluginSurfaceRuntime | null {
  const [mounted, setMounted] = useState<{
    client: DaemonClient;
    plugin: InstalledPlugin;
    runtime: PluginSurfaceRuntime;
  } | null>(null);
  useEffect(() => {
    if (!client || !plugin) return;
    const runtime = createPluginSurfaceRuntime(client, plugin);
    if (!runtime) return;
    setMounted({ client, plugin, runtime });
    return () => {
      void runtime.clisbot
        .dispose()
        .catch((error) => console.warn(`[Plugins] Surface cleanup failed for ${plugin.id}`, error));
    };
  }, [client, plugin]);
  return mounted?.client === client && mounted.plugin === plugin ? mounted.runtime : null;
}
