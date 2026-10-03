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
import {
  outputPersonalServices,
  startPersonalHub,
  type PersonalServingOptions,
} from "../serve/index.js";
import { addLocalDaemonOptions, withGlobalOptions } from "../../utils/command-options.js";

export function startCommand(): Command {
  return addLocalDaemonOptions(new Command("start"))
    .description("Start the local Clisbot Hub (embedded channel control plane)")
    .option("--port <port>", "Fixed port (background default: saved port, or 6870 when available)")
    .option("--foreground", "Run in foreground (don't detach)")
    .option("--device-pairing", "Enable device authentication and protected owner setup")
    .option("--personal", "Bootstrap a new personal Hub with device access and no account login")
    .option("--supervise", "Restart only the Hub after a crash, independently of the daemon")
    .option(
      "--transport <kind>",
      "Personal connection: tailscale (preferred), relay, local, or https",
    )
    .option("--public-url <url>", "HTTPS origin of your reverse proxy/tunnel")
    .option("--https-port <port>", "Tailscale HTTPS port owned by Clisbot")
    .option("--web-port <port>", "Preferred independent web/gateway loopback port")
    .option("--label <name>", "Name of the device being paired")
    .option("--json", "Output personal startup and pairing information as JSON")
    .option(
      "--init-master-key",
      "First run only: mint the local credential master key when it is absent",
    )
    .action(
      withGlobalOptions(async (options: HubStartOptions & PersonalServingOptions) => {
        try {
          if (options.personal) {
            if (options.foreground)
              throw new Error(
                "Personal composition is supervised independently; omit --foreground or start a standalone Hub without --personal.",
              );
            outputPersonalServices(options.json === true, await startPersonalHub(options));
            return;
          }
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
      }),
    );
}

function exitWithError(message: string): never {
  console.error(chalk.red(message));
  process.exit(1);
}

export type { HubStartOptions };
