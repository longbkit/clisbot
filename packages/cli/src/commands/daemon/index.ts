import { Command } from "commander";
import { startCommand, daemonRunCommand } from "./start.js";
import { daemonStatusCommand } from "./status.js";
import { daemonStopCommand } from "./stop.js";
import { daemonRestartCommand } from "./restart.js";
import { runSetPasswordCommand } from "./set-password.js";
import { runResetIdentityCommand } from "./reset-identity.js";
import { pairCommand } from "./pair.js";
import { daemonReloadCommand } from "./reload.js";
import { daemonConfigCommand } from "./config.js";
import { withOutput } from "../../output/index.js";
import { addJsonOption, addLocalDaemonOptions } from "../../utils/command-options.js";

export function createDaemonCommand(): Command {
  const daemon = new Command("daemon").description("Manage the Clisbot daemon");
  for (const command of [
    startCommand(),
    daemonRunCommand(),
    daemonStatusCommand(),
    daemonStopCommand(),
    daemonRestartCommand(),
    daemonReloadCommand(),
    pairCommand(),
    daemonConfigCommand(),
  ])
    daemon.addCommand(command);
  addJsonOption(
    addLocalDaemonOptions(
      daemon.command("set-password").description("Save a hashed daemon password (local operation)"),
    ),
  ).action(withOutput(runSetPasswordCommand));
  addJsonOption(
    addLocalDaemonOptions(
      daemon.command("reset-identity").description("Reset this stopped daemon's Hub identity"),
    ),
  ).action(withOutput(runResetIdentityCommand));
  return daemon;
}
