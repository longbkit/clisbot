// upstream: src/plugin-sdk/runtime-env.ts@5d8067a4483
// Shared process/runtime utilities for plugins. This is the public boundary for
// logger wiring, runtime env shims, and global verbose console helpers.

export type { RuntimeEnv } from "../runtime.js";
export { createNonExitingRuntime, defaultRuntime } from "../runtime.js";
export {
  danger,
  info,
  isVerbose,
  logVerbose,
  setVerbose,
  shouldLogVerbose,
  success,
  warn,
} from "../globals.js";
export { sleep } from "../utils/sleep.js";

export { isTruthyEnvValue } from "../infra/env.js";
export { waitForAbortSignal } from "../infra/abort-signal.js";
export { computeBackoff, sleepWithAbort } from "../infra/backoff.js";
export type { BackoffPolicy } from "../infra/backoff.js";
export { retryAsync } from "../infra/retry.js";
export { isWSL2Sync } from "../infra/wsl.js";

export { createSubsystemLogger, setSubsystemLoggerSink } from "../logging/subsystem.js";
// D-CORE-235: the upstream barrel also re-exports the root logger accessors
// (`src/logging.ts`), the duration formatters, the global undici dispatcher
// installer and the process-level unhandled-rejection handlers. Fusion's Hub
// owns the process and its logging (D-CORE-203, D-CORE-232, D-CORE-233).

// Slice 20 addition (Telegram inbound port): the ported polling liveness tracker
// formats its stall/poll windows with the duration formatter upstream re-exports
// from this same barrel.
export { formatDurationPrecise } from "../infra/format-time/format-duration.js";
