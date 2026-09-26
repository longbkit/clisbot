/** Keep the receipt id when an acknowledgement is lost. A refresh failure cannot undo acceptance. */
export function createMessageAttempt(nextId: () => string) {
  let pending: { text: string; id: string } | null = null;
  return {
    forText(text: string) {
      if (!pending || pending.text !== text) pending = { text, id: nextId() };
      return pending.id;
    },
    accepted(id: string) {
      if (pending?.id === id) pending = null;
    },
  };
}

/** Transport reconnect remounts the route, but retains its client admission identity.
 * Weak ownership prevents receipts/text crossing a replacement client or surviving its lifetime.
 */
export function createMessageAttemptCache(nextId: () => string) {
  const clients = new WeakMap<object, Map<string, ReturnType<typeof createMessageAttempt>>>();
  return {
    forChat(client: object, chatId: string) {
      let chats = clients.get(client);
      if (!chats) {
        chats = new Map();
        clients.set(client, chats);
      }
      let attempt = chats.get(chatId);
      if (!attempt) {
        attempt = createMessageAttempt(nextId);
        chats.set(chatId, attempt);
      }
      return attempt;
    },
  };
}
