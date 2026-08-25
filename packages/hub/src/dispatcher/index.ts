import type { Database } from "../db/types.js";
import type { EntitlementsService } from "../entitlements/service.js";
import type { TriggerHandler, TriggerProvider } from "../triggers/index.js";
import {
  createDurableWorkflowHandler,
  DurableWorkflowEngine,
  type DurableWorkflowEngineOptions,
} from "../workflows/engine.js";
import type { LaunchMachineIntent } from "./launch-machine-intent.js";

export { buildLaunchMachineIntent, type LaunchMachineIntent } from "./launch-machine-intent.js";

export interface DispatcherOptions {
  database: Database | null;
  /** Required end to end so the executions meter can never be silently skipped. */
  entitlements: EntitlementsService | null;
  providers?: readonly TriggerProvider[];
  dispatchLaunchMachineIntent?: (intent: LaunchMachineIntent) => Promise<unknown>;
  validateLaunchMachineIntent?: DurableWorkflowEngineOptions["validateLaunchMachineIntent"];
  configurationRevisionId?: string;
  leaseMs?: number;
  workerIntervalMs?: number;
  now?: () => Date;
  onWorkflowDeadlineExceeded?: DurableWorkflowEngineOptions["onWorkflowDeadlineExceeded"];
  onWorkflowRunAccepted?: DurableWorkflowEngineOptions["onWorkflowRunAccepted"];
  onWorkflowRunStarted?: DurableWorkflowEngineOptions["onWorkflowRunStarted"];
  onWorkflowRunTerminal?: DurableWorkflowEngineOptions["onWorkflowRunTerminal"];
}

export function createDispatcher(options: DispatcherOptions): TriggerHandler {
  const { handler, engine } = createDispatcherWithEngine(options);
  engine.start();
  return handler;
}

export function createDispatcherWithEngine(options: DispatcherOptions): {
  handler: TriggerHandler;
  engine: DurableWorkflowEngine;
} {
  const engineOptions: DurableWorkflowEngineOptions = {
    database: options.database,
    entitlements: options.entitlements,
    ...(options.providers === undefined ? {} : { providers: options.providers }),
    ...(options.dispatchLaunchMachineIntent === undefined
      ? {}
      : { dispatchLaunchMachineIntent: options.dispatchLaunchMachineIntent }),
    ...(options.validateLaunchMachineIntent === undefined
      ? {}
      : { validateLaunchMachineIntent: options.validateLaunchMachineIntent }),
    ...(options.configurationRevisionId === undefined
      ? {}
      : { configurationRevisionId: options.configurationRevisionId }),
    ...(options.leaseMs === undefined ? {} : { leaseMs: options.leaseMs }),
    ...(options.workerIntervalMs === undefined
      ? {}
      : { workerIntervalMs: options.workerIntervalMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.onWorkflowDeadlineExceeded === undefined
      ? {}
      : { onWorkflowDeadlineExceeded: options.onWorkflowDeadlineExceeded }),
    ...(options.onWorkflowRunAccepted === undefined
      ? {}
      : { onWorkflowRunAccepted: options.onWorkflowRunAccepted }),
    ...(options.onWorkflowRunStarted === undefined
      ? {}
      : { onWorkflowRunStarted: options.onWorkflowRunStarted }),
    ...(options.onWorkflowRunTerminal === undefined
      ? {}
      : { onWorkflowRunTerminal: options.onWorkflowRunTerminal }),
  };
  return createDurableWorkflowHandler(engineOptions);
}
