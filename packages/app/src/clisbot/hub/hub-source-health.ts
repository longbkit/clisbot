import { useSyncExternalStore } from "react";
import { classifyHubFailure } from "./hub-failure";

/**
 * Health of each saved Hub account as a source of Hosts. Published by that account's
 * synchronization component (the one observer of its daemon list), read by health summaries
 * without adding query observers.
 *
 * `unreachable` is never treated as lost access: Hosts stay visible from the remembered list.
 */
export type HubSourceState = "live" | "syncing" | "unreachable" | "needs-sign-in" | "revoked";

export interface HubSourceHealth {
  origin: string;
  label: string;
  state: HubSourceState;
  /** When the daemon list was last read; null before the first read on this device. */
  lastSyncedAt: string | null;
}

export function deriveHubSourceState(input: {
  /** Account state could not be read yet (pending or unreachable). */
  accountUnresolved: boolean;
  accountLoading: boolean;
  signedIn: boolean;
  listLoaded: boolean;
  listError: unknown;
}): HubSourceState {
  if (input.accountUnresolved) return input.accountLoading ? "syncing" : "unreachable";
  if (!input.signedIn) return "needs-sign-in";
  if (input.listError !== null && input.listError !== undefined) {
    const kind = classifyHubFailure(input.listError);
    return kind === "unreachable" ? "unreachable" : kind;
  }
  return input.listLoaded ? "live" : "syncing";
}

class HubSourceHealthRegistry {
  private states = new Map<string, HubSourceHealth>();
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly HubSourceHealth[] = [];

  publish(health: HubSourceHealth): void {
    const previous = this.states.get(health.origin);
    if (
      previous?.state === health.state &&
      previous.label === health.label &&
      previous.lastSyncedAt === health.lastSyncedAt
    )
      return;
    this.states.set(health.origin, health);
    this.emit();
  }

  remove(origin: string): void {
    if (this.states.delete(origin)) this.emit();
  }

  get(origin: string): HubSourceHealth | undefined {
    return this.states.get(origin);
  }

  getAll = (): readonly HubSourceHealth[] => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    this.snapshot = [...this.states.values()];
    for (const listener of this.listeners) listener();
  }
}

const GLOBAL_KEY = "__clisbotHubSourceHealth";

export function getHubSourceHealthRegistry(): HubSourceHealthRegistry {
  const existing = Reflect.get(globalThis, GLOBAL_KEY);
  if (existing instanceof HubSourceHealthRegistry) return existing;
  const created = new HubSourceHealthRegistry();
  Reflect.set(globalThis, GLOBAL_KEY, created);
  return created;
}

/** Every saved Hub's current health; the array identity changes only when one changes. */
export function useHubSourceHealth(): readonly HubSourceHealth[] {
  const registry = getHubSourceHealthRegistry();
  return useSyncExternalStore(registry.subscribe, registry.getAll, registry.getAll);
}
