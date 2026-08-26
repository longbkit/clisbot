// The channel's own runtime store (blueprint §6.5 hard rule 2): the Hub drives
// the entry, calls `setChannelRuntime(hostRuntime)` (the `runtime` sidecar's
// named export, routed through here), and the drive surface — `startAccount`
// and `sendText` — reads the runtime back through `getSlackRuntime()`.
//
// The entry module references this module as its `runtime` sidecar
// (`{specifier: "./runtime.js", exportName: "setSlackChannelRuntime"}`), so
// the Hub's one uniform `entry.setChannelRuntime(runtime)` fills the store.

import type { HostRuntime } from "@getpaseo/channels-shared";

let runtime: HostRuntime | undefined;

/** Fill the store (the `runtime` sidecar's named export the entry references). */
export function setSlackChannelRuntime(next: HostRuntime): void {
  runtime = next;
}

/** Read the store. Absent only before the Hub has driven the entry (unit
 * tests that exercise `sendText`'s record path without a runtime get the
 * best-effort skip, matching the pinned `getOptionalSlackRuntime()?.` read). */
export function getSlackRuntime(): HostRuntime | undefined {
  return runtime;
}

/** Test seam: drop the store. */
export function clearSlackRuntimeForTest(): void {
  runtime = undefined;
}
