import { create } from "zustand";

interface SynchronizationFailure {
  message: string;
  retry(): void;
}

// Ephemeral feedback from the mounted binding; Host lifecycle stays in host-runtime.
const useSynchronizationFailures = create<{
  failures: Readonly<Record<string, SynchronizationFailure>>;
}>(() => ({ failures: {} }));

export function hubHostSynchronizationKey(input: {
  origin: string | null;
  organizationId: string | null;
  accountId: string | null;
  daemonId: string;
}): string {
  return JSON.stringify([input.origin, input.organizationId, input.accountId, input.daemonId]);
}

export function setHubHostSynchronizationFailure(
  key: string,
  failure: SynchronizationFailure | null,
): void {
  useSynchronizationFailures.setState(({ failures }) => {
    const next = { ...failures };
    if (failure === null) delete next[key];
    else next[key] = failure;
    return { failures: next };
  });
}

export function useHubHostSynchronizationFailure(key: string): SynchronizationFailure | null {
  return useSynchronizationFailures((state) => state.failures[key] ?? null);
}
