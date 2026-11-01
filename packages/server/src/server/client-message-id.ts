import { v4 as uuidv4 } from "uuid";

export function normalizeClientMessageId(clientMessageId: string | undefined): string | undefined {
  if (typeof clientMessageId !== "string") {
    return undefined;
  }
  const trimmed = clientMessageId.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveClientMessageId(
  clientMessageId: string | undefined,
  generateId: () => string = uuidv4,
): string {
  return normalizeClientMessageId(clientMessageId) ?? generateId();
}

/** A retried message ID whose content or sender differs from the message it already names. */
export class ClientMessageIdConflict extends Error {
  constructor(
    message: string,
    readonly field: "content" | "sender",
  ) {
    super(message);
    this.name = "ClientMessageIdConflict";
  }
}
