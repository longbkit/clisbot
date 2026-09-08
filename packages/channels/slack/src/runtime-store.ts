// The channel's host-runtime store (blueprint §6.5 hard rule 2): the Hub drives
// the entry, calls `setChannelRuntime(hostRuntime)` (the `runtime` sidecar's
// named export, routed through here), and the drive surface — `startAccount`
// and `sendText` — reads the runtime back through `getSlackHostRuntime()`.
//
// The entry module references this module as its `runtime` sidecar
// (`{specifier: "./runtime-store.js", exportName: "setSlackChannelRuntime"}`),
// so the Hub's one uniform `entry.setChannelRuntime(runtime)` fills the store.
//
// KEYED BY ACCOUNT. The Hub loads one vertical per (channel, account) out of
// one cached ESM module and calls `setChannelRuntime` for each of them, so a
// single slot means the last account loaded owns every other account's state
// root and logger: account A's sent-message records land in B's keyed store, A's
// lines under B's logger. Each account therefore binds its own HostRuntime when
// it starts (`plugin.gateway.startAccount`) or when a send names it, and the
// unkeyed slot stays as the compatibility fallback for a caller with no account
// scope. Same shape as the Telegram vertical's `runtime-store.ts`.
//
// Upstream's own `runtime.ts` is a different store: the plugin runtime the
// ported channel code reads its keyed state stores from. It lives next door in
// `runtime.ts` / `runtime.types.ts`, and `fusion/runtime.ts` fills it from the
// same HostRuntime this module receives (D-036), keyed by the same account id.

import type { HostRuntime } from "@getpaseo/channels-shared";
import { disposeSlackRuntime, installSlackRuntime } from "./fusion/runtime.js";
import { currentSlackAccountId, withSlackAccount } from "./runtime.js";

/** Bound HostRuntimes by account id; `""` is the entry-injected fallback. */
const hostRuntimes = new Map<string, HostRuntime>();

/** Fill the store (the `runtime` sidecar's named export the entry references). */
export function setSlackChannelRuntime(next: HostRuntime): void {
  hostRuntimes.set("", next);
  installSlackRuntime(next);
}

/** Bind one account to the HostRuntime the Hub handed its start (or its send),
 * and install that account's ported plugin runtime. */
export function registerSlackAccountRuntime(accountId: string, runtime: HostRuntime): void {
  if (accountId === "") return;
  hostRuntimes.set(accountId, runtime);
  installSlackRuntime(runtime, accountId);
}

/** Release one account's binding and its ported runtime (`plugin.disposeAccount`
 * — the Hub loader calls it when it unloads that account's vertical). Only the
 * named account is released; its siblings keep running. */
export function disposeSlackAccountRuntime(accountId: string): void {
  hostRuntimes.delete(accountId);
  disposeSlackRuntime(accountId);
}

/** Read the store: the named account, else the account currently being served,
 * else the unkeyed slot. Absent only before the Hub has driven the entry (unit
 * tests that exercise `sendText`'s record path without a runtime get the
 * best-effort skip, matching the pinned `getOptionalSlackRuntime()?.` read). */
export function getSlackHostRuntime(accountId?: string): HostRuntime | undefined {
  const id = accountId ?? currentSlackAccountId();
  return (id === undefined ? undefined : hostRuntimes.get(id)) ?? hostRuntimes.get("");
}

/**
 * Runs one drive-surface call under its own account: binds the HostRuntime the
 * Hub passed with the call (the module-global slot is only a fallback) and makes
 * the account current, so everything the call awaits — the thread-participation
 * cache, the sent-message records, the `[slack/…]` log lines — resolves that
 * account's state and logger. Mirrors the Telegram vertical's
 * `withAccountRuntime`.
 */
export async function withSlackAccountRuntime<T>(
  args: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const accountId = String(args["accountId"] ?? "");
  if (accountId === "") return await run();
  const host = (args["hostRuntime"] as HostRuntime | undefined) ?? getSlackHostRuntime(accountId);
  if (host !== undefined) registerSlackAccountRuntime(accountId, host);
  return await withSlackAccount(accountId, run);
}

/** Test seam: drop the store. */
export function clearSlackRuntimeForTest(): void {
  for (const accountId of hostRuntimes.keys()) disposeSlackRuntime(accountId);
  hostRuntimes.clear();
}
