import { z } from "zod";

/**
 * How a conversation shows a Bot's tool calls (docs/features/bots-and-chats/app-experience.md,
 * "Tool calls"). A Bot keeps it for its direct chat; a group Chat keeps its own for the whole
 * transcript. Unset means `collapsed`, so existing Bots and Chats need no migration.
 *
 * - `collapsed`: one bar per Bot turn with the latest tool call; it expands to the full list.
 * - `expanded`: every tool call as its own row, as before.
 * - `header`: the latest tool call in the header subtitle; pressing it opens the list.
 */
export const ChatToolDisplaySchema = z.enum(["collapsed", "expanded", "header"]);
export type ChatToolDisplay = z.infer<typeof ChatToolDisplaySchema>;

export const DEFAULT_CHAT_TOOL_DISPLAY: ChatToolDisplay = "collapsed";

/** The display settings a Bot or a Chat keeps; every leaf optional. */
export const ChatDisplaySchema = z.object({ toolCalls: ChatToolDisplaySchema.optional() });
export type ChatDisplay = z.infer<typeof ChatDisplaySchema>;

export function resolveChatToolDisplay(display: ChatDisplay | null | undefined): ChatToolDisplay {
  return display?.toolCalls ?? DEFAULT_CHAT_TOOL_DISPLAY;
}
