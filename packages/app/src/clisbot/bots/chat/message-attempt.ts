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
