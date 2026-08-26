// COMPAT(clisbot-control-plane): `channels` group — thin verbs over the running
// Hub's channel control plane (implementation doc §1.4, §3.2).

import { Command } from "commander";
import { readFileSync } from "node:fs";
import type { CommandOptions, ListResult, OutputSchema, SingleResult } from "../../output/index.js";
import { withOutput } from "../../output/index.js";
import { addJsonOption } from "../../utils/command-options.js";
import {
  addControlPlaneTargetOptions,
  extractControlPlaneOptions,
  requiredStringOption,
  resolveControlPlaneTarget,
} from "../control-plane.js";
import {
  addChannel,
  channelStatus,
  listChannels,
  type ChannelAccount,
  type ChannelAddResult,
  type ChannelStatusAccount,
} from "./client.js";

const channelsAddSchema: OutputSchema<ChannelAddResult> = {
  idField: "account",
  columns: [
    { header: "CHANNEL", field: "channel" },
    { header: "ACCOUNT", field: "account" },
    { header: "INSTALLED", field: "installed" },
    { header: "REVISION", field: "revision" },
    {
      header: "TRANSPORT",
      field: "transport",
      color: (value) => (value === "started" ? "green" : "yellow"),
    },
    { header: "DETAIL", field: (item) => item.detail ?? "-" },
  ],
};

const channelsListSchema: OutputSchema<ChannelAccount> = {
  idField: "account",
  columns: [
    { header: "CHANNEL", field: "channel" },
    { header: "ACCOUNT", field: "account" },
    {
      header: "ENABLED",
      field: "enabled",
      color: (value) => (value === true ? "green" : "red"),
    },
    { header: "TRANSPORT", field: "transport" },
  ],
};

function healthColor(value: unknown): string | undefined {
  if (value === "ok") return "green";
  if (value === "failed") return "red";
  return "yellow";
}

const channelsStatusSchema: OutputSchema<ChannelStatusAccount> = {
  idField: "account",
  columns: [
    { header: "CHANNEL", field: "channel" },
    { header: "ACCOUNT", field: "account" },
    { header: "PIN", field: (item) => item.pin ?? "-" },
    { header: "INTEGRITY", field: "integrity", color: healthColor },
    { header: "LOAD TRACE", field: "loadTrace", color: healthColor },
    { header: "TRANSPORT", field: "transport" },
  ],
};

function readSecretFile(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw {
      code: "SECRET_FILE_UNREADABLE",
      message: `Cannot read secret file ${filePath}: ${message}`,
    };
  }
}

export async function runChannelsAddCommand(
  channel: string,
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<ChannelAddResult>> {
  const account = requiredStringOption(options, "account");
  const secretFile = requiredStringOption(options, "secret-file");
  const target = resolveControlPlaneTarget(extractControlPlaneOptions(options));
  const result = await addChannel(target, { channel, account, secret: readSecretFile(secretFile) });
  return { type: "single", data: result, schema: channelsAddSchema };
}

export type ChannelsListResult = ListResult<ChannelAccount>;

export async function runChannelsListCommand(
  options: CommandOptions,
  _command: Command,
): Promise<ChannelsListResult> {
  const target = resolveControlPlaneTarget(extractControlPlaneOptions(options));
  return { type: "list", data: await listChannels(target), schema: channelsListSchema };
}

export type ChannelsStatusResult = ListResult<ChannelStatusAccount>;

export async function runChannelsStatusCommand(
  options: CommandOptions,
  _command: Command,
): Promise<ChannelsStatusResult> {
  const target = resolveControlPlaneTarget(extractControlPlaneOptions(options));
  return { type: "list", data: await channelStatus(target), schema: channelsStatusSchema };
}

export function createChannelsCommand(): Command {
  const channels = new Command("channels").description(
    "Manage channel accounts on the running Hub",
  );

  addJsonOption(
    addControlPlaneTargetOptions(
      channels
        .command("add")
        .description("Install a channel account on the running Hub")
        .argument("<channel>", "Channel id (for example: slack, telegram)")
        .requiredOption("--account <id>", "Account id to install")
        .requiredOption(
          "--secret-file <path>",
          "Operator secret file to install (read from local disk)",
        ),
    ),
  ).action(withOutput(runChannelsAddCommand));

  addJsonOption(
    addControlPlaneTargetOptions(channels.command("list").description("List channel accounts")),
  ).action(withOutput(runChannelsListCommand));

  addJsonOption(
    addControlPlaneTargetOptions(
      channels
        .command("status")
        .description("Show per-account pin, integrity, load-trace, and transport"),
    ),
  ).action(withOutput(runChannelsStatusCommand));

  return channels;
}
