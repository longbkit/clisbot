import type { ChannelInboundCommandFacts } from "./monitor.js";

/**
 * A leading `/verb` line, for a platform whose commands arrive as plain text
 * (Google Chat, Zalo, Zalo Personal). Whether the command addresses this bot is
 * the vertical's `wasMentioned`, not this parse.
 */
export function readSlashCommand(body: string): ChannelInboundCommandFacts | undefined {
  const match = /^\/([A-Za-z][\w-]*)(?:\s+([\s\S]*))?$/.exec(body.trim());
  const name = match?.[1];
  if (name === undefined) return undefined;
  return { name: name.toLowerCase(), args: (match?.[2] ?? "").trim() };
}
