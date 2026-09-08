// Fusion-owned host adapter for `src/infra/outbound/delivery-completion.ts` (D-CORE-031).
//
// Upstream serializes queue completion proof so a restarted worker can finish a
// send it cannot observe. The Hub's `channel_delivery` ledger owns that state,
// so only the opaque carrier type crosses into the message-action input.
export type DurableDeliveryCompletion = {
  readonly [key: string]: unknown;
};
