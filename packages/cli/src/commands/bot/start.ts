// COMPAT(clisbot-bot): `bot start` — the one-line bootstrap (implementation doc
// §2.1). Spawns the daemon + embedded Hub as needed, creates the bot composite
// (workspace + idle agent + channel account), and writes the bot manifest. This
// file is the thin commander/output layer; the orchestration lives in `run.ts`.

import { Command } from "commander";
import type {
  AnyCommandResult,
  CommandOptions,
  OutputOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";
import { withOutput } from "../../output/index.js";
import { addJsonOption } from "../../utils/command-options.js";
import { resolveBotHome } from "./home.js";
import { createBotStartDeps, runBotStart, type BotStartReport } from "./run.js";
import type { BotStartOptions } from "./plan.js";

/** Pick the bot-specific flags out of commander's camelCase option bag. */
function extractBotStartOptions(options: CommandOptions): BotStartOptions {
  const pick = (key: string): string | undefined =>
    typeof options[key] === "string" && options[key].trim() !== "" ? options[key] : undefined;
  return {
    provider: pick("provider"),
    model: pick("model"),
    mode: pick("mode"),
    botType: pick("botType"),
    botName: pick("botName"),
    agentName: pick("agentName"),
    workspace: pick("workspace"),
    cwd: pick("cwd"),
    newWorkspace: pick("newWorkspace"),
    slackBotToken: pick("slackBotToken"),
    slackAppToken: pick("slackAppToken"),
    slackAccount: pick("slackAccount"),
    telegramBotToken: pick("telegramBotToken"),
    telegramAccount: pick("telegramAccount"),
    persist: options.persist === true,
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

/** The §2.1 step 5 output: the one-screen state (daemon + hub + channel plane)
 * plus the agent id + channel + the "mention the bot" next step. */
function renderBotStart(result: AnyCommandResult<BotStartReport>, _options: OutputOptions): string {
  if (result.type !== "single") return "";
  const bot = result.data;
  const transport = bot.channelTransport ?? "warming up";
  const lines = [
    `bot "${bot.name}" ${bot.reused ? "reused" : "created"}: provider ${bot.provider}${bot.model ? `/${bot.model}` : ""}`,
    `  daemon   ${bot.daemonHost}  (${bot.daemon})`,
    `  hub      ${bot.hubUrl}  (PID ${bot.hubPid}, ${bot.hub})`,
    `  channel  ${bot.channel}/${bot.account}  (transport ${transport})`,
    `  agent    ${bot.agentId}  (title: ${bot.agentTitle}, workspace ${bot.workspaceId} @ ${bot.workspacePath})`,
    `  credential ${bot.credential}`,
    bot.reused
      ? "Next: " + bot.nextStep + "."
      : "Next: " + bot.nextStep + ". " + bot.routeNote + ".",
  ];
  return lines.join("\n");
}

const botStartSchema: OutputSchema<BotStartReport> = {
  idField: "agentId",
  columns: [
    { header: "BOT", field: "name" },
    { header: "AGENT", field: "agentId" },
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
    new Command("start").description(
      "One-line bootstrap: start a channel bot (daemon + Hub + workspace + agent + account)",
    ),
  )
    .option(
      "--provider <provider>",
      "Agent provider (built-in: claude codex copilot opencode pi omp)",
    )
    .option("--model <model>", "Model id (or use --provider <provider>/<model>)")
    .option("--mode <mode>", "Agent mode id")
    .option("--bot-type <type>", "Bot type: personal or team (default: personal)")
    .option("--bot-name <name>", "Composite name (default: <bot-type>-assistant)")
    .option("--agent-name <name>", "Agent title override (default: the bot name)")
    .option("--workspace <path>", "Workspace directory (default: $CLISBOT_HOME/workspaces/default)")
    .option("--cwd <path>", "Alias for --workspace")
    .option("--new-workspace <kind>", "Workspace isolation: local or worktree (default: local)")
    .option(
      "--slack-bot-token <value>",
      "Slack bot token (literal, ${ENV_VAR}, or a secret-file path)",
    )
    .option("--slack-app-token <value>", "Slack app token")
    .option("--slack-account <id>", "Slack account id (default: the bot name)")
    .option(
      "--telegram-bot-token <value>",
      "Telegram bot token (literal, ${ENV_VAR}, or a secret-file path)",
    )
    .option("--telegram-account <id>", "Telegram account id (default: the bot name)")
    .option("--persist", "Persist the channel credential to a 0600 file (survives `bot stop`)")
    .option("--home <path>", "Clisbot home directory (default: $CLISBOT_HOME or ~/.clisbot)");
  command.action(withOutput(runStartCommand));
  return command;
}
