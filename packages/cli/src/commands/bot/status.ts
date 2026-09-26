// Read the daemon Bot and join optional channel status from the Hub.

import { readBotCatalog } from "./catalog.js";
import { Command } from "commander";
import type {
  AnyCommandResult,
  CommandError,
  CommandOptions,
  OutputOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";
import { withOutput } from "../../output/index.js";
import { addJsonOption } from "../../utils/command-options.js";
import {
  addControlPlaneTargetOptions,
  extractControlPlaneOptions,
  resolveControlPlaneTarget,
} from "../control-plane.js";
import { channelStatus, findChannelStatus, type ChannelStatusAccount } from "../channels/client.js";
import { credentialKindFor, type BotManifest } from "./manifest.js";
import { resolveBotHome } from "./home.js";
import { botRestartCommand } from "./start-output.js";

export interface BotStatusReport {
  name: string;
  botType: "personal" | "team";
  provider: string;
  model?: string;
  channel: "slack" | "telegram" | "-";
  account: string;
  agentId: string;
  agentTitle: string;
  workspaceId: string;
  workspacePath: string;
  credential: "persisted" | "pending";
  routeNote?: string;
  /** True when the account appears in the running Hub's channel status. */
  running: boolean;
  transport?: string;
  integrity?: "ok" | "failed" | "not-checked";
  loadTrace?: "ok" | "failed" | "not-loaded";
  pin?: string;
  ownerLinkRenewCommand?: string;
}

export type BotStatusCommandResult = SingleResult<BotStatusReport>;

export async function runBotStatusCommand(
  name: string,
  options: CommandOptions,
  _command: Command,
  catalogReader = readBotCatalog,
): Promise<BotStatusCommandResult> {
  const home = resolveBotHome(options);
  const row = (await catalogReader(home)).find(
    (entry) => entry.manifest.name === name || entry.manifest.botId === name,
  );
  if (!row) {
    const error: CommandError = {
      code: "BOT_NOT_FOUND",
      message: `No bot named "${name}" in ${home}/bots. Run \`clisbot bot start\` first.`,
    };
    throw error;
  }
  const { manifest, hasChannel } = row;
  const accounts = hasChannel
    ? await channelStatus(resolveControlPlaneTarget(extractControlPlaneOptions(options)))
    : [];
  const live = findChannelStatus(accounts, manifest.channel, manifest.account);
  return {
    type: "single",
    data: {
      ...buildStatusReport(manifest, live),
      ...(hasChannel
        ? { ownerLinkRenewCommand: botRestartCommand(home, name) }
        : { channel: "-" as const, account: "-" }),
    },
    schema: botStatusSchema,
  };
}

/** Merge the recorded manifest with the live channel-account status, if any. */
export function buildStatusReport(
  manifest: BotManifest,
  live: ChannelStatusAccount | undefined,
): BotStatusReport {
  return {
    name: manifest.name,
    botType: manifest.botType,
    provider: manifest.provider,
    ...(manifest.model === undefined ? {} : { model: manifest.model }),
    channel: manifest.channel,
    account: manifest.account,
    agentId: manifest.agentId,
    agentTitle: manifest.agentTitle,
    workspaceId: manifest.workspaceId,
    workspacePath: manifest.workspacePath,
    credential: credentialKindFor(manifest),
    ...(manifest.routeNote === undefined ? {} : { routeNote: manifest.routeNote }),
    running: live !== undefined,
    ...(live === undefined
      ? {}
      : {
          transport: live.transport,
          integrity: live.integrity,
          loadTrace: live.loadTrace,
          ...(live.pin === undefined ? {} : { pin: live.pin }),
        }),
  };
}

/** The §2.1 detail view: the bot's ids plus the live transport health. */
function renderBotStatus(
  result: AnyCommandResult<BotStatusReport>,
  _options: OutputOptions,
): string {
  if (result.type !== "single") return "";
  const bot = result.data;
  const model = bot.model === undefined ? "" : `/${bot.model}`;
  const hub = bot.running
    ? `transport ${bot.transport ?? "?"}, integrity ${bot.integrity ?? "?"}, load ${bot.loadTrace ?? "?"}`
    : "not running on the Hub (re-run `clisbot bot start` to install it)";
  const lines = [
    `bot "${bot.name}" (${bot.botType}) — provider ${bot.provider}${model}`,
    `  agent    ${bot.agentId}  (title: ${bot.agentTitle})`,
    `  channel  ${bot.channel}/${bot.account}  (workspace ${bot.workspaceId})`,
    `  credential ${bot.credential}`,
    `  hub      ${hub}`,
  ];
  if (bot.routeNote !== undefined) lines.push(`  route    ${bot.routeNote}`);
  if (bot.ownerLinkRenewCommand)
    lines.push("", "Check owner / get a new linking code:", `  ${bot.ownerLinkRenewCommand}`);
  return lines.join("\n");
}

const botStatusSchema: OutputSchema<BotStatusReport> = {
  idField: "name",
  columns: [
    { header: "BOT", field: "name" },
    { header: "CHANNEL", field: (item) => `${item.channel}/${item.account}` },
    { header: "AGENT", field: "agentId" },
    { header: "CREDENTIAL", field: "credential" },
    {
      header: "RUNNING",
      field: "running",
      color: (value) => (value === true ? "green" : "red"),
    },
    { header: "TRANSPORT", field: (item) => item.transport ?? "-" },
  ],
  renderHuman: renderBotStatus,
};

export function statusCommand(): Command {
  const command = addJsonOption(
    addControlPlaneTargetOptions(
      new Command("status")
        .description("Show a bot's manifest and its live channel-account status")
        .argument("<bot-name>", "Bot name to show"),
    ),
  );
  command.action(
    withOutput<BotStatusReport, [string]>((name, options, cmd) =>
      runBotStatusCommand(name, options, cmd),
    ),
  );
  return command;
}
