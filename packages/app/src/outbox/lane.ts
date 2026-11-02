import { outboxTargetKey, type OutboxTarget } from "./model";

const lanes = new Map<string, Promise<unknown>>();

/**
 * Deliveries to one agent or chat run in press order. The row shows at once, but the next
 * message waits for the previous answer: a Steer needs the turn the previous message started,
 * and the Host refuses one sent before that turn exists. Each attempt ends by itself (RPC
 * timeout), so one stuck message delays its own target only.
 */
export function inDeliveryLane<T>(target: OutboxTarget, run: () => Promise<T>): Promise<T> {
  const key = outboxTargetKey(target);
  const previous = lanes.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);
  lanes.set(key, next);
  void next
    .finally(() => {
      if (lanes.get(key) === next) lanes.delete(key);
    })
    .catch(() => undefined);
  return next;
}
