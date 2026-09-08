// Fusion-owned boundary for `src/logging/subsystem.ts` (D-CORE-203).
//
// Upstream's subsystem logger is a ~500-line tslog wiring bound to OpenClaw's
// global logging config, log files, diagnostic sinks and the process runtime.
// The ported channel code only needs "give me a named logger with the usual
// levels". Fusion's Hub owns logging, so the sink is replaceable at runtime and
// defaults to console.
export type SubsystemLogger = {
  debug: (message: string, ...rest: unknown[]) => void;
  info: (message: string, ...rest: unknown[]) => void;
  warn: (message: string, ...rest: unknown[]) => void;
  error: (message: string, ...rest: unknown[]) => void;
  /** Nested subsystem, e.g. `createSubsystemLogger("slack").child("media")`. */
  child: (name: string) => SubsystemLogger;
};

export type SubsystemLoggerSink = (params: {
  subsystem: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  rest: unknown[];
}) => void;

/** The channel that owns a set of subsystem names, e.g. Telegram owns
 * `telegram`, `telegram/api`, `telegram/send`. */
export interface SubsystemLoggerOwner {
  /** The channel id, and the key a later registration replaces. */
  channel: string;
  /** Subsystem names this channel owns, matched exactly or as a `<name>/` prefix. */
  subsystems: readonly string[];
}

let sink: SubsystemLoggerSink = ({ subsystem, level, message, rest }) => {
  const line = `[${subsystem}] ${message}`;
  if (level === "error") console.error(line, ...rest);
  else if (level === "warn") console.warn(line, ...rest);
  else if (level === "info") console.info(line, ...rest);
  else console.debug(line, ...rest);
};

/** Channel id -> the sink that owns that channel's subsystems. */
const owners = new Map<string, { subsystems: readonly string[]; sink: SubsystemLoggerSink }>();

/** Replaces the process-wide subsystem log sink (Hub logger in production). */
export function setSubsystemLoggerSink(next: SubsystemLoggerSink): void {
  sink = next;
}

/**
 * Registers `next` as the sink for the subsystems `owner.channel` owns, and as
 * the process-wide sink for the shared ones.
 *
 * The Hub runs every channel in ONE process, so a single process-wide sink puts
 * one vertical's lines under whichever vertical installed last: a
 * `[telegram/api]` error was logged under the Slack account's child logger the
 * moment Slack booted second. Ownership fixes that for the lines that name
 * their channel. The rest — `retry-policy`, `fetch-timeout`, `outbound/*` —
 * carry no channel identity at all, so they keep going to the most recent
 * registration, which is what they did before ownership existed.
 */
export function registerSubsystemLoggerSink(
  owner: SubsystemLoggerOwner,
  next: SubsystemLoggerSink,
): void {
  owners.set(owner.channel, { subsystems: owner.subsystems, sink: next });
  sink = next;
}

/** Drops a channel's ownership (its vertical was disposed). The process-wide
 * sink is left alone: it is the shared subsystems' sink, not this channel's. */
export function clearSubsystemLoggerSink(channel: string): void {
  owners.delete(channel);
}

function sinkFor(subsystem: string): SubsystemLoggerSink {
  for (const owner of owners.values()) {
    for (const name of owner.subsystems) {
      if (subsystem === name || subsystem.startsWith(`${name}/`)) return owner.sink;
    }
  }
  return sink;
}

/** Named logger for one subsystem, e.g. `createSubsystemLogger("telegram/send")`. */
export function createSubsystemLogger(subsystem: string): SubsystemLogger {
  const at =
    (level: "debug" | "info" | "warn" | "error") =>
    (message: string, ...rest: unknown[]) =>
      sinkFor(subsystem)({ subsystem, level, message, rest });
  return {
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    child: (name: string) => createSubsystemLogger(`${subsystem}/${name}`),
  };
}
