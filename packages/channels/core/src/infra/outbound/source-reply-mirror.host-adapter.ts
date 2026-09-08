// Fusion-owned host adapter for `src/infra/outbound/source-reply-mirror.ts` (D-CORE-041).
//
// Upstream tracks whether the terminal reply for the current inbound turn has
// already been delivered, so a `message(send)` to the same conversation is not
// duplicated by the auto-reply pipeline. Fusion has no auto-reply pipeline
// competing with the tool: the Hub's delivery ledger is the single writer and
// dedupes by event/turn id, so these hooks report "nothing already delivered".

export function isDeliveredCurrentSourceReply(_params: unknown): boolean {
  return false;
}

/** Either a receipt to finish later, or a short-circuit outcome already decided. */
export type TerminalSourceReplyDeliveryStart =
  | { outcome: "already-delivered"; result: unknown }
  | { receiptId: string };

export function beginTerminalSourceReplyDelivery(
  _params: unknown,
): TerminalSourceReplyDeliveryStart | undefined {
  return undefined;
}

export function cancelTerminalSourceReplyDelivery(_params: unknown): void {}

export async function reconcileTerminalSourceReplyDelivery(_params: unknown): Promise<void> {}
