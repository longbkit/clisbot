import type { OutboxEntry } from "./model";
import { useOutboxStore } from "./store";

/** The unsent state of one message, or null once its Host has it. */
export function useMessageDelivery(clientMessageId: string | undefined): OutboxEntry | null {
  return useOutboxStore((state) =>
    clientMessageId
      ? (state.entries[clientMessageId] ?? state.accepted[clientMessageId] ?? null)
      : null,
  );
}
