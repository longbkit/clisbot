import type { PairingChannel, PairingRequest } from "./store.ts";

export function buildPairingReply(params: {
  channel: PairingChannel;
  idLine: string;
  code: string;
}) {
  return [
    "muxbot: access not configured.",
    "",
    params.idLine,
    "",
    `Pairing code: ${params.code}`,
    "",
    "Ask the bot owner to approve with:",
    `bun run src/main.ts pairing approve ${params.channel} <code>`,
  ].join("\n");
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
      const meta = request.meta ? ` meta=${JSON.stringify(request.meta)}` : "";
      return `- code=${request.code} id=${request.id}${meta} requestedAt=${request.createdAt}`;
    }),
  ].join("\n");
}
