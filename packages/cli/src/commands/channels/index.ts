// COMPAT(clisbot-control-plane): `channels` group — thin verbs over the running
// Hub's channel control plane (implementation doc §1.4, §3.2).

import { Command } from "commander";
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
  removeChannel,
  type AddableChannel,
  type ChannelAccount,
  type ChannelAddInput,
  type ChannelAddResult,
  type ChannelRemoveResult,
  type ChannelStatusAccount,
} from "./client.js";
import { channelCredentialFromFile, readSecretFile } from "./secret-file.js";

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

const channelsRemoveSchema: OutputSchema<ChannelRemoveResult> = {
  idField: "account",
  columns: [
    { header: "CHANNEL", field: "channel" },
    { header: "ACCOUNT", field: "account" },
    {
      header: "REMOVED",
      field: "removed",
      color: (value) => (value === true ? "green" : "red"),
    },
    { header: "CONNECTION", field: "connectionId" },
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

export async function runChannelsAddCommand(
  channel: string,
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<ChannelAddResult>> {
  const account = requiredStringOption(options, "account");
  const target = resolveControlPlaneTarget(extractControlPlaneOptions(options));
  const result = await addChannel(target, addInput(channel, account, options));
  return { type: "single", data: result, schema: channelsAddSchema };
}

/**
 * Slack installs from an existing Hub Connection id; every other channel
 * installs from a credential file, because a credential in argv lands in `ps`
 * output and shell history. `secret-file.ts` owns the per-channel file shapes.
 */
const ADDABLE_CHANNELS: readonly AddableChannel[] = [
  "slack",
  "telegram",
  "discord",
  "zalo",
  "feishu",
  "googlechat",
  "zalouser",
];

function addInput(channel: string, account: string, options: CommandOptions): ChannelAddInput {
  if (!(ADDABLE_CHANNELS as readonly string[]).includes(channel)) {
    throw { code: "INVALID_CHANNEL", message: `Unsupported channel: ${channel}` };
  }
  if (channel === "slack") {
    return { channel, account, connectionId: requiredStringOption(options, "connection-id") };
  }
  const connectionId = options["connectionId"];
  if (typeof connectionId === "string" && connectionId !== "") {
    return { channel: channel as AddableChannel, account, connectionId };
  }
  // Zalo Personal has no secret to read: it is linked by a QR scan afterwards.
  if (channel === "zalouser") {
    const profile = options["profile"];
    return {
      channel,
      account,
      ...(typeof profile === "string" && profile !== "" ? { profile } : {}),
    };
  }
  return channelCredentialFromFile(
    channel,
    account,
    readSecretFile(requiredStringOption(options, "secret-file")),
  );
}

export type ChannelsListResult = ListResult<ChannelAccount>;

export async function runChannelsListCommand(
  options: CommandOptions,
  _command: Command,
): Promise<ChannelsListResult> {
  const target = resolveControlPlaneTarget(extractControlPlaneOptions(options));
  return { type: "list", data: await listChannels(target), schema: channelsListSchema };
}

/** Uninstalling stops a live transport and drops the account from the active
 * revision, so the verb refuses to run on an implied yes. */
export async function runChannelsRemoveCommand(
  channel: string,
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<ChannelRemoveResult>> {
  const account = requiredStringOption(options, "account");
  if (options["yes"] !== true) {
    throw {
      code: "CONFIRMATION_REQUIRED",
      message: `Removing ${channel} account "${account}" stops its transport and drops it from the channel configuration. Re-run with --yes.`,
    };
  }
  const target = resolveControlPlaneTarget(extractControlPlaneOptions(options));
  const result = await removeChannel(target, { channel, account });
  return { type: "single", data: result, schema: channelsRemoveSchema };
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
        .argument(
          "<channel>",
          "Channel id: slack, telegram, discord, zalo, zalouser, feishu, or googlechat",
        )
        .requiredOption("--account <id>", "Account id to install")
        .option("--connection-id <uuid>", "Existing Hub connection id")
        .option("--profile <label>", "Zalo Personal only: the QR session label")
        .option(
          "--secret-file <path>",
          "Credential file: a bot token (Telegram, Discord, Zalo), a JSON app credential (Feishu), or a service-account document (Google Chat)",
        ),
    ),
  ).action(withOutput(runChannelsAddCommand));

  addJsonOption(
    addControlPlaneTargetOptions(
      // `ls` is the house verb (`paseo ls`, `provider ls`); `list` is the name
      // this command shipped under and stays as its alias.
      channels.command("ls").alias("list").description("List channel accounts"),
    ),
  ).action(withOutput(runChannelsListCommand));

  addJsonOption(
    addControlPlaneTargetOptions(
      channels
        .command("rm")
        .description("Uninstall a channel account from the running Hub")
        .argument("<channel>", "Channel id the account belongs to")
        .requiredOption("--account <id>", "Account id to remove")
        .option("--yes", "Confirm the removal"),
    ),
  ).action(withOutput(runChannelsRemoveCommand));

  addJsonOption(
    addControlPlaneTargetOptions(
      channels
        .command("status")
        .description("Show per-account pin, integrity, load-trace, and transport"),
    ),
  ).action(withOutput(runChannelsStatusCommand));

  return channels;
}
