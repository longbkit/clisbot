import type { PairingChannel, PairingRequest } from "./store.ts";
import { renderCliCommand } from "../../shared/cli-name.ts";

export function buildPairingReply(params: {
  channel: PairingChannel;
  botId?: string;
  idLine: string;
  code: string;
}) {
  return [
    "clisbot: access not configured.",
    "",
    params.idLine,
    ...(params.botId ? ["", `Target bot: ${params.botId}`] : []),
    "",
    `Pairing code: ${params.code}`,
    "",
    "Ask the bot owner to approve with:",
    renderCliCommand(`pairing approve ${params.channel} ${params.code}`),
  ].join("\n");
}

export function buildPairingQueueFullReply(params: {
  channel: PairingChannel;
  botId?: string;
  idLine: string;
}) {
  return [
    "clisbot: access not configured.",
    "",
    params.idLine,
    ...(params.botId ? ["", `Target bot: ${params.botId}`] : []),
    "",
    "Pairing queue is full right now.",
    "",
    "Ask the bot owner to inspect or clear pending requests with:",
    renderCliCommand(`pairing list ${params.channel}`),
    renderCliCommand(`pairing reject ${params.channel} <code>`),
    renderCliCommand(`pairing clear ${params.channel}`),
  ].join("\n");
}

export function buildPairingReplyFromRequest(params: {
  channel: PairingChannel;
  botId?: string;
  idLine: string;
  pairingRequest: {
    code: string;
    created: boolean;
  };
}) {
  const code = params.pairingRequest.code.trim();
  if (!code) {
    return buildPairingQueueFullReply({
      channel: params.channel,
      botId: params.botId,
      idLine: params.idLine,
    });
  }

  return buildPairingReply({
    channel: params.channel,
    botId: params.botId,
    idLine: params.idLine,
    code,
  });
}

export function renderPairingRequests(params: {
  channel: PairingChannel;
  requests: PairingRequest[];
}) {
  if (!params.requests.length) {
    return `No pending ${params.channel} pairing requests.`;
  }

  return [
    `Pending ${params.channel} pairing requests:`,
    ...params.requests.map((request) => {
      const bot = request.botId ? ` bot=${request.botId}` : "";
      const meta = request.meta ? ` meta=${JSON.stringify(request.meta)}` : "";
      return `- code=${request.code} id=${request.id}${bot}${meta} requestedAt=${request.createdAt}`;
    }),
  ].join("\n");
}
