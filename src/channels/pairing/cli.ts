import { renderPairingRequests } from "./messages.ts";
import {
  approveChannelPairingCode,
  listChannelPairingRequests,
  type PairingChannel,
} from "./store.ts";

type PairingCliWriter = {
  log: (line: string) => void;
};

function parseChannel(raw: string | undefined): PairingChannel {
  const value = raw?.trim().toLowerCase();
  if (value === "slack" || value === "telegram") {
    return value;
  }
  throw new Error("Channel required: slack | telegram");
}

export async function runPairingCli(args: string[], writer: PairingCliWriter = console) {
  const [command, ...rest] = args;
  const baseDir = process.env.TMUX_TALK_PAIRING_DIR;

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
    writer.log(`Approved ${channel} sender ${approved.id}.`);
    return;
  }

  throw new Error("Usage: pairing list <channel> [--json] | pairing approve <channel> <code>");
}
