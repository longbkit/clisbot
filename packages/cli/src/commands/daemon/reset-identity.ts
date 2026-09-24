import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { readDaemonInstance, resolvePaseoHome } from "@getpaseo/server/daemon-control";
import type { Command } from "commander";
import type {
  CommandError,
  CommandOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";

/**
 * The files that make a daemon one particular daemon. Copying a Paseo home copies them, so two
 * computers end up with the same identity; Hub refuses the second one until it is reset.
 */
const IDENTITY_FILES = ["server-id", "daemon-keypair.json", "hub-relationship.json"] as const;

interface ResetIdentityResult {
  action: "identity_reset";
  home: string;
  removed: string;
  nextSteps: string;
}

const schema: OutputSchema<ResetIdentityResult> = {
  idField: "action",
  columns: [
    { header: "STATUS", field: "action", color: () => "green" },
    { header: "HOME", field: "home" },
    { header: "REMOVED", field: "removed" },
  ],
  renderHuman: (result) => {
    const data = result.data as ResetIdentityResult;
    return `Reset the daemon identity in ${data.home}.\n\n${data.nextSteps}`;
  },
};

export async function resetDaemonIdentity(
  options: { home?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<ResetIdentityResult> {
  const env = options.env ?? process.env;
  const home = resolvePaseoHome({ PASEO_HOME: options.home ?? env.PASEO_HOME });
  if (await readDaemonInstance(home)) {
    throw commandError(
      "DAEMON_RUNNING",
      "Stop the daemon before resetting its identity.",
      "Run: paseo daemon stop",
    );
  }
  if (env.PASEO_SERVER_ID?.trim()) {
    throw commandError(
      "SERVER_ID_OVERRIDE",
      "PASEO_SERVER_ID is set, so the daemon would start with the same identity again.",
      "Remove PASEO_SERVER_ID from the environment, then run this command again.",
    );
  }
  const removed = IDENTITY_FILES.filter((file) => existsSync(path.join(home, file)));
  for (const file of removed) rmSync(path.join(home, file), { force: true });
  return {
    action: "identity_reset",
    home,
    removed: removed.join(", ") || "none",
    nextSteps: [
      "Next:",
      "  1. paseo daemon start",
      "  2. paseo hub login <hub-url>   (connects this daemon to Hub as a new Host)",
      "The previous Host stays in Hub as offline; an owner can remove it there.",
    ].join("\n"),
  };
}

export async function runResetIdentityCommand(
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<ResetIdentityResult>> {
  const data = await resetDaemonIdentity({
    home: typeof options.home === "string" ? options.home : undefined,
  });
  return { type: "single", data, schema };
}

function commandError(code: string, message: string, details: string): CommandError {
  return { code, message, details };
}
