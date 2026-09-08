// upstream: src/globals.ts@5d8067a4483
// D-CORE-232: upstream's globals bind the verbose/console helpers to the
// OpenClaw CLI theme, global process state and the root pino logger. Fusion's
// Hub owns logging, so the verbose sink is replaceable and defaults to the
// `logVerbose` subsystem logger. `OPENCLAW_VERBOSE`/`--verbose` semantics are
// preserved through `setVerbose`.
import { createSubsystemLogger } from "./logging/subsystem.js";

const verboseLogger = createSubsystemLogger("verbose");
let verbose = false;

/** Enables or disables verbose logging for this process. */
export function setVerbose(next: boolean): void {
  verbose = next;
}

export function isVerbose(): boolean {
  return verbose;
}

export function shouldLogVerbose(): boolean {
  return verbose;
}

/** Logs only when verbose logging is on. */
export function logVerbose(message: string, ...rest: unknown[]): void {
  if (verbose) {
    verboseLogger.debug(message, ...rest);
  }
}

export function info(message: string, ...rest: unknown[]): void {
  verboseLogger.info(message, ...rest);
}

export function warn(message: string, ...rest: unknown[]): void {
  verboseLogger.warn(message, ...rest);
}

export function danger(message: string, ...rest: unknown[]): void {
  verboseLogger.error(message, ...rest);
}

export function success(message: string, ...rest: unknown[]): void {
  verboseLogger.info(message, ...rest);
}
