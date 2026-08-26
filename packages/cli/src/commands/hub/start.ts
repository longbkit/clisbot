// COMPAT(clisbot-hub-local): `hub start` — spawn/detach the fork's embedded Hub
// (implementation doc §3.2: the `daemon start` pattern applied to the Hub's bin
// entry; binds loopback :6868 and writes hub-local.json).

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
    .description("Start the local Paseo Hub (embedded channel control plane)")
    .option("--port <port>", "Port to listen on (default: 6868)")
    .option("--home <path>", "Clisbot home directory (default: $CLISBOT_HOME or ~/.clisbot)")
    .option("--foreground", "Run in foreground (don't detach)")
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
