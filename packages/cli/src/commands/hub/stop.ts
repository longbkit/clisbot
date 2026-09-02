// COMPAT(clisbot-hub-local): `hub stop` — stop the embedded Hub (and, since the
// channel verticals run in-process, every channel it hosts). Discards only the
// local discovery state; durable encrypted Connection credentials remain in Hub
// storage (implementation doc §3.2).

import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonOption } from "../../utils/command-options.js";
import { getErrorMessage } from "../../utils/errors.js";
import { DEFAULT_KILL_TIMEOUT_MS, DEFAULT_STOP_TIMEOUT_MS, stopLocalHub } from "./local-hub.js";
import type {
  CommandError,
  CommandOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";

interface StopResult {
  action: "stopped" | "not_running";
  home: string;
  pid: string;
  forced: boolean;
  reason: "not_running" | "owner_pid_signal" | "owner_pid_sigkill";
  message: string;
}

const stopResultSchema: OutputSchema<StopResult> = {
  idField: "action",
  columns: [
    { header: "STATUS", field: "action", color: (v) => (v === "stopped" ? "green" : "yellow") },
    { header: "HOME", field: "home" },
    { header: "PID", field: "pid" },
    { header: "MESSAGE", field: "message" },
  ],
};

export type StopCommandResult = SingleResult<StopResult>;

function parseSecondsOption(raw: unknown, fallbackMs: number, label: string): number {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return fallbackMs;
  }
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    const error: CommandError = {
      code: "INVALID_TIMEOUT",
      message: `Invalid ${label} value: ${raw}`,
      details: `${label} must be a positive number of seconds`,
    };
    throw error;
  }
  return Math.ceil(seconds * 1000);
}

export async function runStopCommand(
  options: CommandOptions,
  _command: Command,
): Promise<StopCommandResult> {
  const home = typeof options.home === "string" ? options.home : undefined;
  const force = options.force === true;
  const timeoutMs = parseSecondsOption(options.timeout, DEFAULT_STOP_TIMEOUT_MS, "timeout");
  const killTimeoutMs = parseSecondsOption(
    options.killTimeout,
    DEFAULT_KILL_TIMEOUT_MS,
    "kill-timeout",
  );

  try {
    const result = await stopLocalHub({ home, force, timeoutMs, killTimeoutMs });
    return {
      type: "single",
      data: {
        action: result.action,
        home: result.home,
        pid: result.pid === null ? "-" : String(result.pid),
        forced: result.forced,
        reason: result.reason,
        message: result.message,
      },
      schema: stopResultSchema,
    };
  } catch (err) {
    const message = getErrorMessage(err);
    const error: CommandError = {
      code: "STOP_FAILED",
      message: `Failed to stop local Hub: ${message}`,
    };
    throw error;
  }
}

export function stopCommand(): Command {
  const command = addJsonOption(new Command("stop").description("Stop the local Paseo Hub"))
    .option("--home <path>", "Clisbot home directory (default: $CLISBOT_HOME or ~/.clisbot)")
    .option("--timeout <seconds>", "Wait timeout before failing (default: 15)")
    .option("--force", "Send SIGKILL if graceful stop times out")
    .option("--kill-timeout <seconds>", "Wait after SIGKILL before failing (default: 3)");
  command.action(withOutput(runStopCommand));
  return command;
}
