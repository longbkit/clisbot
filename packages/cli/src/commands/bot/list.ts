// COMPAT(clisbot-bot): `bot list` — every bot in the home, joined with the
// running Hub's live channel-account status (implementation doc §2.1). The
// manifest is the source of each bot's ids; `channelStatus` supplies the live
// transport/integrity/load-trace. A bot whose account is absent from the live
// status is reported as not running, not as an error.

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
import { credentialKindFor, readBotManifests, type BotManifest } from "./manifest.js";
import { resolveBotHome } from "./home.js";

/** One row of `bot list`: the manifest's ids plus the live transport state. */
export interface BotListEntry {
  name: string;
  botType: "personal" | "team";
  provider: string;
  channel: "slack" | "telegram";
  account: string;
  agentId: string;
  credential: "persisted";
  running: boolean;
  transport?: string;
}

export type BotListCommandResult = ListResult<BotListEntry>;

export async function runBotListCommand(
  options: CommandOptions,
  _command: Command,
): Promise<BotListCommandResult> {
  const home = resolveBotHome(options);
  const manifests = await readBotManifests(home);
  const target = resolveControlPlaneTarget(extractControlPlaneOptions(options));
  const accounts = await channelStatus(target);
  return {
    type: "list",
    data: manifests.map((manifest) => buildBotListEntry(manifest, accounts)),
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
  command.action(withOutput(runBotListCommand));
  return command;
}
