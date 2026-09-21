// How many session creates one Host runs at once. A create spawns a provider
// process and waits for it to initialize, and the daemon runs every create it is
// sent concurrently. Accounts drain in parallel and several accounts share a
// Host, so without a gate a burst of first mentions becomes a burst of process
// spawns, each slower than it would be alone and the slowest past the RPC
// timeout.
//
// A caller that can come back later asks `hostHasCreateSlot` first and defers
// when the Host is full, so a create that waits never holds an ingress worker:
// follow-ups and commands keep flowing while new conversations queue durably.
// The FIFO wait below covers callers that cannot defer (`/new`, `/fork`) and the
// race between that check and the call.

export const MAX_CONCURRENT_CREATES_PER_HOST = 8;

interface HostGate {
  active: number;
  waiting: (() => void)[];
}

const gates = new Map<string, HostGate>();

/** Would a create on this Host start now, rather than wait behind others? */
export function hostHasCreateSlot(hostKey: string): boolean {
  return (gates.get(hostKey)?.active ?? 0) < MAX_CONCURRENT_CREATES_PER_HOST;
}

/**
 * How long a create may wait for a slot. A caller that cannot defer (`/new`,
 * `/fork`) holds an ingress worker while it waits, so the wait is bounded.
 */
export const HOST_CREATE_WAIT_MS = 30_000;

/** The Host stayed full for the whole wait; nothing was sent to it. */
export class HostBusyError extends Error {
  constructor() {
    super("the Host is busy starting other sessions; try again shortly");
    this.name = "HostBusyError";
  }
}

/** Resolves when a slot is handed over; rejects once the wait runs out. */
function waitForSlot(gate: HostGate): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const take = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      gate.waiting.splice(gate.waiting.indexOf(take), 1);
      reject(new HostBusyError());
    }, HOST_CREATE_WAIT_MS);
    timer.unref?.();
    gate.waiting.push(take);
  });
}

/** Run `create` once the Host has a free slot, in arrival order. */
export async function withHostCreateSlot<T>(hostKey: string, create: () => Promise<T>): Promise<T> {
  const gate = gates.get(hostKey) ?? { active: 0, waiting: [] };
  gates.set(hostKey, gate);
  if (gate.active >= MAX_CONCURRENT_CREATES_PER_HOST) await waitForSlot(gate);
  else gate.active += 1;
  try {
    return await create();
  } finally {
    const next = gate.waiting.shift();
    // The slot passes straight to the next waiter, so `active` stays put.
    if (next !== undefined) next();
    else gate.active -= 1;
    if (gate.active === 0) gates.delete(hostKey);
  }
}
