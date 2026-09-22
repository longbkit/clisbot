// The tool-path prompt composer (E4/E6). When a route's effective
// `outbound.path` is `tool`, the agent's user-visible answer leaves through the
// hub-attached `message` MCP tool and the relay goes silent for that turn
// (`config/inheritance.ts` folds `sync.finalAnswers` off). Nothing in the
// channel conversation reveals that, so the contract has to be injected.
//
// Three things the block carries, each one learned from Codex turns that
// answered normally and reached the channel as silence:
//
//  1. THE TOOL'S REAL NAME. Providers expose an MCP tool as
//     `mcp__<server>__<tool>` — Claude builds its grant that way
//     (`claude/options.ts:100`) and Codex uses the same format, where the tool
//     is reachable as `tools.mcp__…` inside its exec sandbox. Naming it
//     `channel_reply.message` matched nothing on either side.
//  2. THE SUPPRESSION. A model told by its own system prompt to end a turn with
//     a final message will do exactly that unless this block says the final
//     message is discarded. Codex's base instructions say precisely that.
//  3. THE AUTHORIZATION. Codex's base instructions refuse to send messages to
//     others without explicit authorization, and this tool posts into Slack or
//     Telegram. "Reply using the tool" does not read as that grant.
//
// A route's `outbound.template` overrides the whole block verbatim.

import { getChannelCatalogEntry, type SupportedChannelName } from "./catalog.js";
import { CHANNEL_REPLY_MCP_SERVER_NAME, CHANNEL_REPLY_TOOL_NAME } from "./plane/types.js";

/** The identifier every provider exposes the hub-attached tool under. */
const MESSAGE_TOOL = `mcp__${CHANNEL_REPLY_MCP_SERVER_NAME}__${CHANNEL_REPLY_TOOL_NAME}`;

const FILE_INSTRUCTION =
  '- To send files (documents, images, video, voice notes), add `attachments` — e.g. `attachments:[{media:"/abs/path/a.png"},{media:"/abs/path/b.pdf"}]`, ABSOLUTE paths, one or many per message. Never write a file path as a link in message text; the user cannot open local links.';

/**
 * Compose the prompt block for a tool-attaching path: the route's `template`
 * override when set (trimmed), otherwise the default for the path. `tool`
 * makes the tool the only reply channel; `hybrid` delivers the final message
 * as text and keeps the tool for what text cannot carry, so its block says
 * the opposite about the final message. Pure string mapping — the callers
 * decide when this runs and where the result goes.
 */
export function composeMessageToolPrompt(
  template: string | null,
  options: {
    channel: SupportedChannelName;
    canSendFiles?: boolean | undefined;
    path?: "tool" | "hybrid" | undefined;
  },
): string {
  if (template !== null) {
    const trimmed = template.trim();
    if (trimmed !== "") return trimmed;
  }
  const label = getChannelCatalogEntry(options.channel)?.label ?? options.channel;
  const files = options.canSendFiles === false ? [] : [FILE_INSTRUCTION];
  if (options.path === "hybrid") {
    return [
      "## Messaging",
      `The user is asking from ${label}. Your final assistant message is delivered to them as text — write your answer there as usual.`,
      `For what text cannot carry — files, images, reactions, edits — call the \`${MESSAGE_TOOL}\` tool. Posting into this one conversation is already authorized: the tool takes no target, and the host fixes the destination.`,
      "- Never repeat your answer text through the tool; it would reach the user twice.",
      ...files,
    ].join("\n");
  }
  return [
    "## Messaging",
    `The user is asking from ${label}. Reply by calling the \`${MESSAGE_TOOL}\` tool with \`action="send"\` — that call is the only thing the user sees. Your final assistant message is not delivered, so a turn that ends without calling the tool shows the user nothing.`,
    "Posting into this one conversation is already authorized: the tool takes no target, and the host fixes the destination.",
    "- Put the visible reply text in `message`.",
    "- Set `final=false` for a progress update; set `final=true`, or omit it, for the completed reply.",
    "- On longer work, send a short `final=false` update when you start and at major steps — at most about once a minute.",
    ...files,
  ].join("\n");
}
