import type { Database } from "../db/types.js";
import type { LaunchMachineIntent } from "../dispatcher/launch-machine-intent.js";
import type { TriggerProvider } from "../triggers/index.js";
import type { ExecutionAuthority } from "../execution-authority/index.js";
import {
  createDaemonDispatchLifecycle,
  AgentExecutionCompletionFailure,
  DaemonDispatchFailure,
  DaemonSpawnAckTimeoutError,
  type DaemonDispatchLifecycle,
  type DaemonDispatchResult,
} from "./lifecycle.js";
import type {
  DaemonAgentStreamEvent,
  DaemonConnection,
  DaemonCreateAgentOptions,
} from "./protocol.js";
import type { Logger } from "pino";
import type { OutputExecutorRegistry } from "../execution-capabilities/outputs.js";

export type {
  DaemonAgentStreamEvent,
  DaemonConnection,
  DaemonCreateAgentOptions,
} from "./protocol.js";
export { DaemonDispatchFailure, DaemonSpawnAckTimeoutError };
export { AgentExecutionCompletionFailure };
export { ActiveDaemonRegistry, createDaemonUpgradeHandler, type DaemonClock } from "./registry.js";
export { enrollDaemon, revokeDaemon } from "./registration.js";

interface DaemonModuleTestOptions {
  logger?: Logger;
  dispatchTimeoutMs?: number;
  deadlineClock?: import("./lifecycle.js").ExecutionDeadlineClock;
}

export interface DaemonModuleOptions {
  database: Database;
  executionCapabilities?: OutputExecutorRegistry;
  providers?: readonly TriggerProvider[];
  executionAuthority?: ExecutionAuthority;
  connectionForDaemon(daemonId: string): DaemonConnection | undefined;
  publicBaseUrl?: string;
  completionTokenSecret?: string;
  test?: DaemonModuleTestOptions;
}

export interface DaemonModule {
  readonly kind: "daemon-module";
  readonly lifecycle: DaemonDispatchLifecycle;
}

export function createDaemonModule(options: DaemonModuleOptions): DaemonModule {
  return {
    kind: "daemon-module",
    lifecycle: createDaemonDispatchLifecycle({
      database: options.database,
      connectionForDaemon: (daemonId) => options.connectionForDaemon(daemonId),
      ...(options.executionCapabilities === undefined
        ? {}
        : { executionCapabilities: options.executionCapabilities }),
      providers: options.providers ?? [],
      ...(options.executionAuthority === undefined
        ? {}
        : { executionAuthority: options.executionAuthority }),
      ...(options.publicBaseUrl === undefined ? {} : { publicBaseUrl: options.publicBaseUrl }),
      ...(options.completionTokenSecret === undefined
        ? {}
        : { completionTokenSecret: options.completionTokenSecret }),
      ...(options.test === undefined ? {} : { test: options.test }),
    }),
  };
}

export async function dispatchLaunchMachineIntent(
  module: DaemonModule,
  intent: LaunchMachineIntent,
): Promise<DaemonDispatchResult> {
  return await module.lifecycle.dispatchLaunchMachineIntent(intent);
}
