import type { Logger } from "pino";

import {
  ProviderSnapshotManager,
  type ProviderSnapshotManagerOptions,
} from "./provider-snapshot-manager.js";
import { OpenCodeBridge } from "./providers/opencode/bridge.js";
import type { ClisbotToolCatalog } from "./tools/types.js";

export interface AgentProviderRuntime {
  snapshotManager: ProviderSnapshotManager;
  setClisbotToolCatalog(catalog: Pick<ClisbotToolCatalog, "tools"> | null): void;
  shutdown(): Promise<void>;
}

interface CreateAgentProviderRuntimeOptions {
  clisbotHome: string;
  logger: Logger;
  snapshotManager: Omit<ProviderSnapshotManagerOptions, "logger" | "openCodeBridge">;
}

export async function createAgentProviderRuntime(
  options: CreateAgentProviderRuntimeOptions,
): Promise<AgentProviderRuntime> {
  const configuredPort =
    options.snapshotManager.runtimeSettings?.opencode?.env?.CLISBOT_OPENCODE_BRIDGE_PORT;
  const port = configuredPort === undefined ? undefined : Number(configuredPort);
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535))
    throw new Error("CLISBOT_OPENCODE_BRIDGE_PORT must be an integer between 1 and 65535");
  const bridge = new OpenCodeBridge({
    clisbotHome: options.clisbotHome,
    logger: options.logger,
    port,
  });
  try {
    await bridge.start();
    const snapshotManager = new ProviderSnapshotManager({
      unavailableRetryMs: process.env.CLISBOT_PROVIDER_UNAVAILABLE_RETRY === "1" ? 60_000 : 0,
      ...options.snapshotManager,
      logger: options.logger.child({ module: "provider-snapshot-manager" }),
      openCodeBridge: bridge,
    });
    let shutdownPromise: Promise<void> | null = null;
    return {
      snapshotManager,
      setClisbotToolCatalog: (catalog) => bridge.setManifestCatalog(catalog),
      shutdown: () => {
        shutdownPromise ??= shutdownProviderRuntime(snapshotManager, bridge);
        return shutdownPromise;
      },
    };
  } catch (error) {
    await bridge.close().catch(() => undefined);
    throw error;
  }
}

async function shutdownProviderRuntime(
  snapshotManager: ProviderSnapshotManager,
  bridge: OpenCodeBridge,
): Promise<void> {
  try {
    await snapshotManager.shutdown();
  } finally {
    await bridge.close();
  }
}
