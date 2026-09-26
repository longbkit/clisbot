// Fusion-owned agent labels that join an agent session to a Bot and a Chat
// (docs/features/bots-and-chats/README.md, D2 and D7). Daemon and app import
// these; no call site spells the strings.

export const BOT_ID_LABEL = "clisbot.bot-id";
export const CHAT_ID_LABEL = "clisbot.chat-id";

function readLabel(
  labels: Record<string, unknown> | null | undefined,
  label: string,
): string | null {
  const value = labels?.[label];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function getBotIdFromLabels(labels: Record<string, unknown> | null | undefined) {
  return readLabel(labels, BOT_ID_LABEL);
}

export function getChatIdFromLabels(labels: Record<string, unknown> | null | undefined) {
  return readLabel(labels, CHAT_ID_LABEL);
}
