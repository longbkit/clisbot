import type { DeliveryOutcome } from "./model";
import { INSTANT_SEND_ENABLED } from "./feature";

/**
 * What a composer waits for after the press. With instant send it waits for nothing: the row
 * owns the outcome. Without it the composer waits for the Host and gets the draft back on
 * failure, after the unsent row is removed.
 */
export async function handOffDelivery(
  delivery: Promise<DeliveryOutcome>,
  discard: () => void,
): Promise<void> {
  if (INSTANT_SEND_ENABLED) {
    void delivery;
    return;
  }
  const outcome = await delivery;
  if (outcome.kind === "sent") return;
  discard();
  throw new Error(outcome.failure.message);
}
