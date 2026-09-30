// COMPAT(clisbot-hub-local): `hub start` — spawn/detach the fork's embedded Hub
// (implementation doc §3.2: the `daemon start` pattern applied to the Hub's bin
// entry; binds loopback :6870 and writes hub-local.json).

import { Command } from "commander";
import chalk from "chalk";
import { getErrorMessage } from "../../utils/errors.js";
import {
  startLocalHubDetached,
  startLocalHubForeground,
  type HubStartOptions,
} from "./local-hub.js";

export function startCommand(): Command {
  return new Command("start")
    .description("Start the local Clisbot Hub (embedded channel control plane)")
    .option("--port <port>", "Fixed port (background default: saved port, or 6870 when available)")
    .option("--home <path>", "Clisbot home directory (default: $CLISBOT_HOME or ~/.clisbot)")
    .option("--foreground", "Run in foreground (don't detach)")
    .option(
      "--init-master-key",
      "First run only: mint the local credential master key when it is absent",
    )
    .action(async (options: HubStartOptions) => {
      try {
        if (options.foreground) {
          process.exit(startLocalHubForeground(options));
        }
        const startup = await startLocalHubDetached(options);
        console.log(chalk.green(`Hub starting in background (PID ${startup.pid ?? "unknown"}).`));
        console.log(chalk.dim(`URL: ${startup.url}`));
        console.log(chalk.dim(`Logs: ${startup.logPath}`));
      } catch (err) {
        exitWithError(getErrorMessage(err));
      }
    });
}

function exitWithError(message: string): never {
  console.error(chalk.red(message));
  process.exit(1);
}

export type { HubStartOptions };
