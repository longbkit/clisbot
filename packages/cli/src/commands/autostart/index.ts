// COMPAT(clisbot-autostart): the fork's login-autostart group. macOS only, and
// inert until an operator runs `paseo autostart install`.

import { Command } from "commander";
import { addInstallCommand } from "./install.js";
import { addStatusCommand } from "./status.js";
import { addUninstallCommand } from "./uninstall.js";

export function createAutostartCommand(): Command {
  const autostart = new Command("autostart").description(
    "Start the local daemon and Hub at macOS login (launchd agents)",
  );
  addInstallCommand(autostart);
  addStatusCommand(autostart);
  addUninstallCommand(autostart);
  return autostart;
}
