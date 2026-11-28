/**
 * How tool calls are projected in the timeline (`tool-calls/detail-level`). These were also the
 * stored values of Clisbot's `toolCallDetailLevel` setting before upstream's `chatDisplay`
 * replaced it; they are still read from storage to migrate that choice.
 */
export const TOOL_CALL_DETAIL_LEVELS = [
  "detailed",
  "overview",
  "summary-with-latest-call",
] as const;
export type ToolCallDetailLevel = (typeof TOOL_CALL_DETAIL_LEVELS)[number];

/**
 * How much of an agent's work the chat shows between the user's message and the reply.
 * Upstream's three choices plus Clisbot's latest-call grouping, as one setting. The Clisbot value
 * keeps its legacy spelling so its stored value and translated label carry over unchanged.
 */
export const CHAT_DISPLAYS = [
  "full",
  "collapseToolCalls",
  "summary-with-latest-call",
  "collapseTurns",
] as const;
export type ChatDisplay = (typeof CHAT_DISPLAYS)[number];

/** Clisbot made latest-call grouping its default, and reset installs to it once (see migrations). */
export const DEFAULT_CHAT_DISPLAY = "summary-with-latest-call" satisfies ChatDisplay;

/** The display a pre-`chatDisplay` Clisbot `toolCallDetailLevel` choice is equivalent to. */
export function chatDisplayFromToolCallDetailLevel(level: ToolCallDetailLevel): ChatDisplay {
  switch (level) {
    case "detailed":
      return "full";
    case "overview":
      return "collapseToolCalls";
    case "summary-with-latest-call":
      return "summary-with-latest-call";
  }
}

/** The tool-call projection a display renders with; `collapseTurns` also folds whole turns. */
export function toolCallDetailLevelForChatDisplay(display: ChatDisplay): ToolCallDetailLevel {
  switch (display) {
    case "full":
      return "detailed";
    case "summary-with-latest-call":
      return "summary-with-latest-call";
    case "collapseToolCalls":
    case "collapseTurns":
      return "overview";
  }
}
