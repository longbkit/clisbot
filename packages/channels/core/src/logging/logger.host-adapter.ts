// Fusion-owned boundary for the root-logger accessors in `src/logging/logger.ts`
// and `src/logger.ts` (D-CORE-700).
//
// Upstream's `getChildLogger` hands out a tslog sub-logger of OpenClaw's root
// logger, and `toPinoLikeLogger` adapts it to the pino shape Baileys requires.
// Fusion's Hub owns logging (D-CORE-203), so a child logger here is a subsystem
// logger whose name carries the bindings, and every line reaches the Hub through
// the same replaceable sink. The pino-like adapter keeps upstream's member list
// (`level`, `child`, `trace` … `fatal`); `trace` folds into `debug` and `fatal`
// into `error`, the two levels the subsystem sink does not have.
import { createSubsystemLogger, type SubsystemLogger } from "./subsystem.js";

export type LogLevel = "silent" | "fatal" | "error" | "warn" | "info" | "debug" | "trace";

const LEVEL_RANK: Record<LogLevel, number> = {
  silent: Number.POSITIVE_INFINITY,
  fatal: 5,
  error: 4,
  warn: 3,
  info: 2,
  debug: 1,
  trace: 0,
};

/** The structured child logger upstream code calls as `logger.warn(obj, msg)`. */
export type ChildLogger = {
  readonly level: LogLevel;
  trace: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  fatal: (...args: unknown[]) => void;
  child: (bindings?: Record<string, unknown>) => ChildLogger;
};

export type PinoLikeLogger = {
  level: string;
  child: (bindings?: Record<string, unknown>) => PinoLikeLogger;
  trace: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  fatal: (...args: unknown[]) => void;
};

/** pino and tslog both accept `(obj, message)` and `(message, ...rest)`. */
function splitArgs(args: unknown[]): { message: string; rest: unknown[] } {
  const [first, second, ...more] = args;
  if (typeof first === "string") return { message: first, rest: args.slice(1) };
  if (typeof second === "string") return { message: second, rest: [first, ...more] };
  return { message: "", rest: args };
}

function subsystemName(bindings?: Record<string, unknown>): string {
  const module = bindings?.["module"];
  return typeof module === "string" && module.trim() !== "" ? module.trim() : "openclaw";
}

function buildChildLogger(logger: SubsystemLogger, level: LogLevel): ChildLogger {
  const enabled = (at: LogLevel) => LEVEL_RANK[at] >= LEVEL_RANK[level];
  const emit =
    (at: LogLevel, write: SubsystemLogger["info"]) =>
    (...args: unknown[]) => {
      if (!enabled(at)) return;
      const { message, rest } = splitArgs(args);
      write(message, ...rest);
    };
  return {
    level,
    trace: emit("trace", logger.debug),
    debug: emit("debug", logger.debug),
    info: emit("info", logger.info),
    warn: emit("warn", logger.warn),
    error: emit("error", logger.error),
    fatal: emit("fatal", logger.error),
    child: (bindings) => buildChildLogger(logger.child(subsystemName(bindings)), level),
  };
}

/** Upstream `getChildLogger(bindings, { level })`. */
export function getChildLogger(
  bindings?: Record<string, unknown>,
  opts?: { level?: LogLevel },
): ChildLogger {
  return buildChildLogger(createSubsystemLogger(subsystemName(bindings)), opts?.level ?? "info");
}

/** Upstream `toPinoLikeLogger`: Baileys expects a pino-like logger shape. */
export function toPinoLikeLogger(logger: ChildLogger, level: LogLevel): PinoLikeLogger {
  return {
    level,
    child: (bindings) => toPinoLikeLogger(logger.child(bindings), level),
    trace: (...args: unknown[]) => logger.trace(...args),
    debug: (...args: unknown[]) => logger.debug(...args),
    info: (...args: unknown[]) => logger.info(...args),
    warn: (...args: unknown[]) => logger.warn(...args),
    error: (...args: unknown[]) => logger.error(...args),
    fatal: (...args: unknown[]) => logger.fatal(...args),
  };
}

const rootLog = createSubsystemLogger("openclaw");

/** Upstream `src/logger.ts` `logInfo`: an info line on the root logger. */
export function logInfo(message: string): void {
  rootLog.info(message);
}
