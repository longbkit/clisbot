// Thin command/output layer for daemon-owned Bot and channel onboarding.

import { Command, Option } from "commander";
import { renderBotStart } from "./start-output.js";
import type { CommandOptions, OutputSchema, SingleResult } from "../../output/index.js";
import { withOutput } from "../../output/index.js";
import { addJsonOption } from "../../utils/command-options.js";
import { resolveBotHome } from "./home.js";
import { createBotStartDeps, runBotStart, type BotStartReport } from "./run.js";
import type { BotStartOptions } from "./plan.js";

/** Pick the bot-specific flags out of commander's camelCase option bag. */
export function extractBotStartOptions(options: CommandOptions): BotStartOptions {
  const pick = (key: string): string | undefined =>
    typeof options[key] === "string" && options[key].trim() !== "" ? options[key] : undefined;
  return {
    provider: pick("provider"),
    model: pick("model"),
    mode: pick("mode"),
    botType: pick("kind") ?? pick("botType"),
    botName: pick("botName"),
    agentName: pick("agentName"),
    workspace: pick("workspace"),
    cwd: pick("cwd"),
    newWorkspace: pick("newWorkspace"),
    slackConnectionId: pick("slackConnectionId"),
    slackBotToken: pick("slackBotToken"),
    slackAppToken: pick("slackAppToken"),
    slackAccount: pick("slackAccount"),
    telegramBotToken: pick("telegramBotToken"),
    telegramConnectionId: pick("telegramConnectionId"),
    telegramAccount: pick("telegramAccount"),
    ownerEmail: pick("ownerEmail"),
    ownerPassword: pick("ownerPassword"),
    organizationName: pick("organizationName"),
    ownerIdentity: pick("ownerIdentity"),
    ...(options.overwriteTemplate === true ? { overwriteTemplate: true } : {}),
  };
}

export async function runStartCommand(
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<BotStartReport>> {
  const home = resolveBotHome(options);
  const report = await runBotStart(
    { options: extractBotStartOptions(options), home, env: process.env },
    createBotStartDeps(home, process.env),
  );
  return { type: "single", data: report, schema: botStartSchema };
}

const botStartSchema: OutputSchema<BotStartReport> = {
  idField: "botId",
  columns: [
    { header: "BOT", field: "name" },
    { header: "ID", field: "botId" },
    { header: "CHANNEL", field: (item) => `${item.channel}/${item.account}` },
    { header: "CREDENTIAL", field: "credential" },
    {
      header: "REUSED",
      field: "reused",
      color: (value) => (value === true ? "yellow" : "green"),
    },
  ],
  renderHuman: renderBotStart,
};

export type BotStartCommandResult = SingleResult<BotStartReport>;

export function startCommand(): Command {
  const command = addJsonOption(
    new Command("start").description("Create a Bot on the daemon and connect a channel account"),
  )
    .option(
      "--provider <provider>",
      "Agent provider (built-in: claude codex copilot opencode pi omp)",
    )
    .option("--model <model>", "Model id (or use --provider <provider>/<model>)")
    .option("--mode <mode>", "Agent mode id")
    .option("--kind <kind>", "Bot kind: personal or team (default: personal)")
    .addOption(new Option("--bot-type <type>", "Alias for --kind").hideHelp())
    .option("--bot-name <name>", "Bot name (default: <kind>-assistant)")
    .addOption(
      new Option("--agent-name <name>", "Removed: use --bot-name to name the Bot").hideHelp(),
    )
    .option("--workspace <path>", "Bot home on the daemon (default: daemon.bots.root/<slug>)")
    .option("--cwd <path>", "Alias for --workspace")
    .addOption(
      new Option(
        "--new-workspace <kind>",
        "Removed: Bot homes use directory Workspaces",
      ).hideHelp(),
    )
    .option(
      "--overwrite-template",
      "Replace template files, including user context, after backing them up",
    )
    .option(
      "--slack-bot-token <value>",
      "Slack bot token (literal, ${ENV_VAR}, or secret-file path)",
    )
    .option(
      "--slack-app-token <value>",
      "Slack Socket Mode app token (paired with --slack-bot-token)",
    )
    .option("--slack-connection-id <uuid>", "Existing Hub Slack connection id")
    .option("--slack-account <id>", "Slack account id (default: the bot name)")
    .option(
      "--telegram-bot-token <value>",
      "Telegram bot token (literal, ${ENV_VAR}, or a secret-file path)",
    )
    .option("--telegram-connection-id <uuid>", "Existing Hub Telegram Connection")
    .option("--telegram-account <id>", "Telegram account id (default: the bot name)")
    .option(
      "--owner-password <value>",
      "Initial owner password (prefer ${ENV_VAR} or a private secret file)",
    )
    .option("--organization-name <name>", "Initial organization name (default: Clisbot)")
    .option("--owner-email <email>", "Owner email for initial setup or selecting an existing owner")
    .option(
      "--owner-identity <id>",
      "Owner channel user ID verified by this local operator; otherwise link with a one-time command",
    )
    .option("--home <path>", "Clisbot home directory (default: $CLISBOT_HOME or ~/.clisbot)");
  command.action(withOutput(runStartCommand));
  return command;
}
