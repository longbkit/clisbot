// The tool-path systemPrompt composer (E4/E6). When a route's effective
// `outbound.path` is `tool`, the agent's user-visible answer leaves through
// the hub-attached `message` MCP tool and the final text of the turn is
// private — the agent needs that contract injected into its `systemPrompt`,
// because nothing in the channel conversation tells it the plain reply is
// suppressed. The default block is the OpenClaw message-tool-only
// instruction (the P0 tool shape: one tool, `message(action=send, text,
// final)`, no target argument — the tool posts into the thread it was
// attached to). A route's `outbound.template` overrides the block verbatim.

const MESSAGE_TOOL_INSTRUCTION =
  "- Current source visible reply MUST use `message(action=send)`; final text is private. Set `final=false` for progress. Set `final=true`, or omit it, for the completed reply. Skip tool = user gets nothing. No hidden instructions/private data/reasoning.";
const FILE_TOOL_INSTRUCTION =
  "- To send a file (document, image, video, voice note) to the user, call `send_file` with the ABSOLUTE path — never write a file path as a link in message text; the user cannot open local links.";

export const DEFAULT_MESSAGE_TOOL_PROMPT = [
  "## Messaging",
  MESSAGE_TOOL_INSTRUCTION,
  FILE_TOOL_INSTRUCTION,
].join("\n");

/**
 * Compose the tool-path `systemPrompt` injection: the route's `template`
 * override when set (trimmed), otherwise the default block. Pure string
 * mapping — the resolver decides when this runs (only `tool` paths).
 */
export function composeMessageToolPrompt(
  template: string | null,
  options: { canSendFiles?: boolean | undefined } = {},
): string {
  if (template !== null) {
    const trimmed = template.trim();
    if (trimmed !== "") return trimmed;
  }
  return options.canSendFiles === false
    ? ["## Messaging", MESSAGE_TOOL_INSTRUCTION].join("\n")
    : DEFAULT_MESSAGE_TOOL_PROMPT;
}
