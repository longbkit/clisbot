// COMPAT(clisbot-bot): `bot` group — the one-line channel-bot bootstrap
// (implementation doc §2.1). A bot is a composite of four existing things
// (workspace + idle agent + channel account + route); the manifest ties their
// ids together. The verb layout matches §2.1's `start`/`stop` split.

import { Command } from "commander";
import { startCommand } from "./start.js";
import { stopCommand } from "./stop.js";
import { statusCommand } from "./status.js";
import { listCommand } from "./list.js";

export function createBotCommand(): Command {
  const bot = new Command("bot").description(
    "Use a channel bot with an agent (one-line bootstrap: workspace + agent + channel)",
  );
  bot.addCommand(startCommand());
  bot.addCommand(stopCommand());
  bot.addCommand(statusCommand());
  bot.addCommand(listCommand());
  return bot;
}
