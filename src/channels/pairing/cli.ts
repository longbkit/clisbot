import { readEditableConfig, writeEditableConfig } from "../../config/config-file.ts";
import { ensureBotDirectMessageWildcardRoute } from "../../config/direct-message-routes.ts";
import { normalizeAllowEntry } from "./access.ts";
import { renderPairingRequests } from "./messages.ts";
import {
  approveChannelPairingCode,
  clearChannelPairingRequests,
  listChannelPairingRequests,
  rejectChannelPairingCode,
  type PairingChannel,
} from "./store.ts";
import { renderCliCommand } from "../../shared/cli-name.ts";

type PairingCliWriter = {
  log: (line: string) => void;
};

function resolvePairingBaseDir(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.CLISBOT_PAIRING_DIR?.trim();
  if (configured) {
    return configured;
  }

  const legacy = env.TMUX_TALK_PAIRING_DIR?.trim();
  return legacy || undefined;
}

function resolveConfigPath(env: NodeJS.ProcessEnv = process.env) {
  return env.CLISBOT_CONFIG_PATH;
}

function parseChannel(raw: string | undefined): PairingChannel {
  const value = raw?.trim().toLowerCase();
  if (value === "slack" || value === "telegram") {
    return value;
  }
  throw new Error("Channel required: slack | telegram");
}

function resolveApprovedBotId(
  channel: PairingChannel,
  configuredBotIds: string[],
  approvedBotId?: string,
) {
  const normalizedBotId = approvedBotId?.trim();
  if (normalizedBotId) {
    return normalizedBotId;
  }
  if (configuredBotIds.length === 1) {
    return configuredBotIds[0];
  }
  throw new Error(
    `Pending ${channel} pairing request is missing a bot id. Recreate the request after upgrading.`,
  );
}

function renderPairingCliHelp() {
  return [
    renderCliCommand("pairing"),
    "",
    "Usage:",
    `  ${renderCliCommand("pairing --help")}`,
    `  ${renderCliCommand("pairing help")}`,
    `  ${renderCliCommand("pairing list <slack|telegram> [--json]")}`,
    `  ${renderCliCommand("pairing approve <slack|telegram> <code>")}`,
    `  ${renderCliCommand("pairing reject <slack|telegram> <code>")}`,
    `  ${renderCliCommand("pairing clear <slack|telegram>")}`,
    "",
    "Notes:",
    "  - `list` shows pending pairing requests for one channel only",
    "  - `approve` moves that sender into the requesting bot's DM allowUsers list",
    "  - `reject` removes one pending request without allowlisting the sender",
    "  - `clear` drops every pending request for that channel when the queue needs a reset",
  ].join("\n");
}

export async function runPairingCli(args: string[], writer: PairingCliWriter = console) {
  const [command, ...rest] = args;
  const baseDir = resolvePairingBaseDir();

  if (!command || command === "--help" || command === "-h" || command === "help") {
    writer.log(renderPairingCliHelp());
    return;
  }

  if (command === "list") {
    const wantsJson = rest.includes("--json");
    const channel = parseChannel(rest.find((value) => !value.startsWith("--")));
    const requests = await listChannelPairingRequests(channel, baseDir);
    writer.log(
      wantsJson
        ? JSON.stringify({ channel, requests }, null, 2)
        : renderPairingRequests({ channel, requests }),
    );
    return;
  }

  if (command === "approve") {
    const [channelArg, code] = rest;
    const channel = parseChannel(channelArg);
    if (!code?.trim()) {
      throw new Error("Usage: pairing approve <channel> <code>");
    }

    const approved = await approveChannelPairingCode({
      channel,
      code,
      baseDir,
    });
    if (!approved) {
      throw new Error(`No pending pairing request found for code: ${code}`);
    }
    const { config, configPath } = await readEditableConfig(resolveConfigPath());
    const configuredBotIds =
      channel === "slack"
        ? Object.keys(config.bots.slack).filter((botId) => botId !== "defaults")
        : Object.keys(config.bots.telegram).filter((botId) => botId !== "defaults");
    const botId = resolveApprovedBotId(channel, configuredBotIds, approved.botId);
    const wildcardRoute = ensureBotDirectMessageWildcardRoute(config, channel, botId);
    const normalizedUser = normalizeAllowEntry(channel, approved.id);
    const currentUsers = new Set((wildcardRoute.allowUsers ?? []).map((entry) => String(entry).trim()).filter(Boolean));
    if (normalizedUser) {
      currentUsers.add(normalizedUser);
    }
    wildcardRoute.allowUsers = [...currentUsers];
    await writeEditableConfig(configPath, config);
    writer.log(`Approved ${channel} sender ${approved.id} for bot ${botId}.`);
    return;
  }

  if (command === "reject") {
    const [channelArg, code] = rest;
    const channel = parseChannel(channelArg);
    if (!code?.trim()) {
      throw new Error("Usage: pairing reject <channel> <code>");
    }

    const rejected = await rejectChannelPairingCode({
      channel,
      code,
      baseDir,
    });
    if (!rejected) {
      throw new Error(`No pending pairing request found for code: ${code}`);
    }
    writer.log(`Rejected ${channel} sender ${rejected.id}.`);
    return;
  }

  if (command === "clear") {
    const [channelArg] = rest;
    const channel = parseChannel(channelArg);
    const result = await clearChannelPairingRequests({
      channel,
      baseDir,
    });
    writer.log(`Cleared ${result.cleared} pending ${channel} pairing request(s).`);
    return;
  }

  throw new Error(renderPairingCliHelp());
}
