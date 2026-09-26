// Bot resource commands and local channel onboarding.

import { Command } from "commander";
import { startCommand } from "./start.js";
import { stopCommand } from "./stop.js";
import { statusCommand } from "./status.js";
import { listCommand } from "./list.js";

export function createBotCommand(): Command {
  const bot = new Command("bot").description(
    "Create and inspect Bots on a Host and connect channel accounts",
  );
  bot.addCommand(startCommand());
  bot.addCommand(stopCommand());
  bot.addCommand(statusCommand());
  bot.addCommand(listCommand());
  return bot;
}
