/**
 * What a list row already showed about a chat, handed to the chat route so its first frame has a
 * title before the accepted record arrives. It never authorizes anything: the route still shows
 * no transcript and disables sending until the Host accepts the chat.
 */
export interface ChatOpenPreview {
  serverId: string;
  chatId: string;
  title: string;
}

const MAX_PREVIEWS = 32;
const previews = new Map<string, ChatOpenPreview>();

function previewKey(serverId: string, chatId: string): string {
  return `${serverId}\u0000${chatId}`;
}

export function rememberChatOpenPreview(preview: ChatOpenPreview): void {
  const key = previewKey(preview.serverId, preview.chatId);
  previews.delete(key);
  previews.set(key, preview);
  if (previews.size <= MAX_PREVIEWS) return;
  const oldest = previews.keys().next().value;
  if (oldest !== undefined) previews.delete(oldest);
}

export function readChatOpenPreview(serverId: string, chatId: string): ChatOpenPreview | null {
  return previews.get(previewKey(serverId, chatId)) ?? null;
}

export function forgetChatOpenPreviews(): void {
  previews.clear();
}
