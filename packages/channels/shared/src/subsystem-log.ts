// One vertical's ported subsystem logs → the Hub's per-account child logger.
//
// Every vertical hits the same two problems, so the routing lives here once
// instead of five times:
//
//   1. Two CHANNELS in one process. `createSubsystemLogger` dispatches through
//      a process-wide sink, so the vertical that booted last used to receive
//      every other vertical's lines — a `[telegram/api]` error landed under the
//      Slack account's child logger. The sink is registered as the owner of the
//      subsystem names the channel actually emits, so a line goes to the
//      channel that named it.
//   2. Two ACCOUNTS of one channel. The Hub gives each account its own child
//      logger, and the account being served travels in the vertical's
//      `AsyncLocalStorage` (`withTelegramAccount` and friends). The sink
//      resolves the account per line rather than pinning whoever installed
//      first; a vertical with no account scope resolves the unkeyed slot, which
//      is what a single-account host and the ported unit tests install.
import {
  clearSubsystemLoggerSink,
  registerSubsystemLoggerSink,
} from "@getpaseo/channels-core/logging/subsystem";
import type { HostChildLogger } from "./host.js";

export interface ChannelSubsystemLogSink {
  /** The channel id — the ownership key, replaced by a later registration. */
  readonly channel: string;
  /** Subsystem names this channel emits, matched exactly or as a `<name>/`
   * prefix (`"telegram"` covers `telegram/api`, `telegram/send`, …). */
  readonly subsystems: readonly string[];
  /** The account loggers the vertical keeps, keyed by account id; `""` is the
   * unkeyed single-account slot. Read per line, so later installs are seen. */
  readonly loggers: ReadonlyMap<string, HostChildLogger>;
  /** The account being served, from the vertical's own async scope. */
  readonly currentAccountId: () => string | undefined;
}

/** Installs (or replaces) the channel's subsystem log sink. Idempotent per
 * channel: the sink reads `loggers` live, so calling it on every account
 * install costs nothing. */
export function installChannelSubsystemLogSink(sink: ChannelSubsystemLogSink): void {
  registerSubsystemLoggerSink(
    { channel: sink.channel, subsystems: sink.subsystems },
    ({ subsystem, level, message }) => {
      const logger =
        sink.loggers.get(sink.currentAccountId() ?? "") ?? sink.loggers.get("") ?? undefined;
      if (logger === undefined) return;
      const line = `[${subsystem}] ${message}`;
      if (level === "error") logger.error?.(line);
      else if (level === "warn") logger.warn(line);
      else if (level === "info") logger.info?.(line);
      else logger.debug?.(line);
    },
  );
}

/** Drops the channel's ownership when its vertical is disposed. */
export function clearChannelSubsystemLogSink(channel: string): void {
  clearSubsystemLoggerSink(channel);
}
