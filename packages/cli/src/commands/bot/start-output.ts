import chalk from "chalk";
import { renderTable } from "../../output/table.js";
import type { AnyCommandResult, OutputOptions } from "../../output/index.js";
import type { BotStartReport } from "./run.js";

/** Printed command uses shell quoting so custom home paths remain copyable. */
export function botRestartCommand(home: string, name: string, ownerEmail?: string): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const entry = process.argv[1];
  const executable = entry && /[\\/]bin[\\/]paseo$/.test(entry) ? quote(entry) : "paseo";
  return (
    `${executable} bot start --home ${quote(home)} --bot-name ${quote(name)}` +
    (ownerEmail ? ` --owner-email ${quote(ownerEmail)}` : "")
  );
}

export function renderBotStart(
  result: AnyCommandResult<BotStartReport>,
  options: OutputOptions,
): string {
  if (result.type !== "single") return "";
  const bot = result.data;
  const ready = bot.ownerReady === true && bot.channelTransport === "started";
  const heading = `Bot ${bot.name} — ${ready ? "READY" : "SETUP INCOMPLETE"}`;
  const color = ready ? chalk.green : chalk.yellow;
  const lines = [options.noColor ? heading : color.bold(heading)];
  if (bot.ownerReady === false) lines.push("", ...renderOwnerLink(bot, options));
  lines.push("", renderSummary(bot, options));
  if (bot.template?.backupDirectory)
    lines.push("", `Template backup: ${bot.template.backupDirectory}`);
  if (ready || bot.ownerReady !== false) lines.push("", `Next: ${bot.nextStep}.`);
  if (bot.channelTransport !== "started")
    lines.push("", "Channel is not ready yet. Check bot status before sending a request.");
  return lines.join("\n");
}

function renderOwnerLink(bot: BotStartReport, options: OutputOptions): string[] {
  const title = "ACTION REQUIRED — link your owner account";
  const lines = [
    options.noColor ? title : chalk.yellow.bold(title),
    "The channel is configured, but your account is not linked yet.",
  ];
  if (bot.ownerLinkCommand)
    lines.push(
      `Send this command privately to the bot in ${bot.channel === "slack" ? "Slack" : "Telegram"}:`,
      "",
      `  ${bot.ownerLinkCommand}`,
      "",
      linkExpiry(bot.ownerLinkExpiresAt),
      "Single use. Keep this code private.",
    );
  if (bot.ownerLinkRenewCommand)
    lines.push(
      "",
      "Lost or expired code? Run in your terminal:",
      `  ${bot.ownerLinkRenewCommand}`,
      "A new code invalidates the previous code. No channel tokens are needed.",
    );
  return lines;
}

function linkExpiry(value?: string): string {
  if (!value) return "Expiry was not reported by this Hub. Request a new code if needed.";
  const remaining = Math.ceil((Date.parse(value) - Date.now()) / 60_000);
  const deadline = new Date(value)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
  return remaining > 0
    ? `Expires: ${deadline} (about ${remaining} min remaining).`
    : `Expired: ${deadline}. Request a new code below.`;
}

function renderSummary(bot: BotStartReport, options: OutputOptions): string {
  const template = bot.template;
  let owner = "Not reported";
  if (bot.ownerReady === true) owner = "Linked";
  if (bot.ownerReady === false) owner = "Pending link";
  const rows = [
    { label: "Setup", value: bot.reused ? "Reused existing bot" : "Created" },
    { label: "Provider", value: `${bot.provider}${bot.model ? ` / ${bot.model}` : ""}` },
    { label: "Channel", value: `${bot.channel} / ${bot.account}` },
    { label: "Transport", value: bot.channelTransport ?? "Warming up" },
    {
      label: "Owner",
      value: owner,
    },
    { label: "Workspace", value: bot.workspacePath },
    { label: "Hub", value: bot.hubUrl },
    { label: "Daemon", value: `${bot.daemonHost} (${bot.daemon})` },
    { label: "Agent", value: bot.agentTitle },
    { label: "Agent ID", value: bot.agentId },
    { label: "Credentials", value: "Stored in Hub" },
  ];
  if (template)
    rows.push({
      label: "Template",
      value: `${template.created.length} created, ${template.overwritten?.length ?? 0} overwritten, ${template.skipped.length} preserved`,
    });
  return renderTable<{ label: string; value: string }>(
    {
      type: "list",
      data: rows,
      schema: {
        idField: "label",
        columns: [
          { header: "", field: "label", color: () => "bold" },
          { header: "", field: "value" },
        ],
      },
    },
    { ...options, noHeaders: true },
  );
}
