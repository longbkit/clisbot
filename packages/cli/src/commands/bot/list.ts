// List authoritative Bots from the daemon, joined to optional local channel references.

import { readBotCatalog } from "./catalog.js";
import { Command } from "commander";
import type { CommandOptions, ListResult, OutputSchema } from "../../output/index.js";
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

/** One row of `bot list`: the manifest's ids plus the live transport state. */
export interface BotListEntry {
  name: string;
  botType: "personal" | "team";
  provider: string;
  channel: "slack" | "telegram" | "-";
  account: string;
  agentId: string;
  credential: "persisted" | "pending";
  running: boolean;
  transport?: string;
}

export type BotListCommandResult = ListResult<BotListEntry>;

export async function runBotListCommand(
  options: CommandOptions,
  _command: Command,
  catalogReader = readBotCatalog,
): Promise<BotListCommandResult> {
  const home = resolveBotHome(options);
  const catalog = await catalogReader(home);
  const accounts = catalog.some((row) => row.hasChannel)
    ? await channelStatus(resolveControlPlaneTarget(extractControlPlaneOptions(options)))
    : [];
  return {
    type: "list",
    data: catalog.map(({ manifest, hasChannel }) =>
      Object.assign(
        buildBotListEntry(manifest, hasChannel ? accounts : []),
        !hasChannel ? { channel: "-" as const, account: "-" } : {},
      ),
    ),
    schema: botListSchema,
  };
}

/** Merge one manifest with the live channel-account status, if any. */
export function buildBotListEntry(
  manifest: BotManifest,
  accounts: ChannelStatusAccount[],
): BotListEntry {
  const live = findChannelStatus(accounts, manifest.channel, manifest.account);
  return {
    name: manifest.name,
    botType: manifest.botType,
    provider: manifest.provider,
    channel: manifest.channel,
    account: manifest.account,
    agentId: manifest.agentId,
    credential: credentialKindFor(manifest),
    running: live !== undefined,
    ...(live === undefined ? {} : { transport: live.transport }),
  };
}

const botListSchema: OutputSchema<BotListEntry> = {
  idField: "name",
  columns: [
    { header: "BOT", field: "name" },
    { header: "TYPE", field: "botType" },
    { header: "PROVIDER", field: "provider" },
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
};

export function listCommand(): Command {
  const command = addJsonOption(
    addControlPlaneTargetOptions(
      new Command("list").description("List bots in the home with their live channel status"),
    ),
  );
  command.action(withOutput<BotListEntry, []>((options, cmd) => runBotListCommand(options, cmd)));
  return command;
}
