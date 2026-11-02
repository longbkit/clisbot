import type { DeliveryOutcome } from "./model";
import { INSTANT_SEND_ENABLED } from "./feature";

/**
 * Waits for the Host. On failure the unsent row is removed and the error thrown, so the owner
 * of the message (a queue, review feedback, the composer with instant send off) takes it back.
 */
export async function deliverOrReturn(
  delivery: Promise<DeliveryOutcome>,
  discard: () => void,
): Promise<void> {
  const outcome = await delivery;
  if (outcome.kind === "sent") return;
  discard();
  throw new Error(outcome.failure.message);
}

/**
 * What a composer waits for after the press. With instant send it waits for nothing: the row
 * owns the outcome. Without it the composer waits and gets the draft back on failure.
 */
export async function handOffDelivery(
  delivery: Promise<DeliveryOutcome>,
  discard: () => void,
): Promise<void> {
  if (INSTANT_SEND_ENABLED) {
    void delivery;
    return;
  }
  await deliverOrReturn(delivery, discard);
}
