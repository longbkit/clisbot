// Per-channel host-runtime store (plan §7 / §14.5, implementation doc §4.1).
// The vertical injects its HostRuntime through its entry's `setChannelRuntime`
// at load; the bound subpath module (hosts/channel-inbound.ts) reads it back at
// call time. The store is keyed by `${channel}:${accountId}` so one Hub process
// can host several channel accounts, each with its own runtime, without a
// global. Filled by the control plane (bindings/relay writer) at account start;
// read by the loader's host module on every inbound reply.
//
// A missing runtime is a load-time fault, not a mid-conversation one: the bound
// module refuses to dispatch (logs + returns a benign no-dispatch result) rather
// than throwing into the channel, because a throw there would be a channel fault.

import type { HostRuntime } from "./host.js";

// The store MUST be a process-wide singleton, not a module-level local. The
// supervisor populates it from whatever compilation it runs in (inlined into
// the vite start-server bundle in production; tsx source under tests), while the
// bound seam's host module (hosts/channel-inbound.ts) reads it back from a
// SEPARATE compilation — a real file under `hostBaseDir` loaded at drive time by
// the node:module hooks, never through vite. Two module instances of this file
// would each hold their own Map, so the seam's `getChannelRuntime` would always
// miss and silently NO_DISPATCH every inbound. A `Symbol.for`-keyed global (the
// same mechanism runtime-files.ts uses for the runtime root) guarantees one Map
// per process no matter how many copies of this module are loaded; per-account
// isolation is preserved by the key, not by module identity.

const RUNTIMES = Symbol.for("@getpaseo/hub/channel-runtimes");

type RuntimesGlobal = typeof globalThis & { [RUNTIMES]?: Map<string, HostRuntime> };

function runtimes(): Map<string, HostRuntime> {
  const globals = globalThis as RuntimesGlobal;
  globals[RUNTIMES] ??= new Map<string, HostRuntime>();
  return globals[RUNTIMES];
}

export function runtimeKey(channel: string, accountId: string): string {
  return `${channel}:${accountId}`;
}

/** Record the host runtime for a channel account. Idempotent: a re-set replaces
 * the previous runtime (a pin-bump reload re-injects a fresh one). */
export function setChannelRuntime(channel: string, accountId: string, runtime: HostRuntime): void {
  runtimes().set(runtimeKey(channel, accountId), runtime);
}

/** The host runtime recorded for a channel account, or undefined when the
 * control plane has not started that account yet. */
export function getChannelRuntime(channel: string, accountId: string): HostRuntime | undefined {
  return runtimes().get(runtimeKey(channel, accountId));
}

/** Drop a channel account's runtime (account stop / dispose). */
export function clearChannelRuntime(channel: string, accountId: string): void {
  runtimes().delete(runtimeKey(channel, accountId));
}

/** Test-only: drop every recorded runtime. */
export function clearAllChannelRuntimes(): void {
  runtimes().clear();
}
