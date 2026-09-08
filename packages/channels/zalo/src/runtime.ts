// upstream: extensions/zalo/src/runtime.ts@5d8067a4483
// D-ZL-002: upstream stores the plugin runtime in OpenClaw's global plugin
// runtime store (`openclaw/plugin-sdk/runtime-store`), which opens SQLite-backed
// keyed stores from the OpenClaw state directory. Fusion's Hub injects the
// runtime through `./fusion/runtime.ts`; the accessor names and the
// throw-on-unset contract are unchanged.
//
// D-ZL-003: upstream runs one Zalo account per OpenClaw process, so one slot
// holds the runtime. The Hub runs every account of every organization in one
// process, each with its own HostRuntime, keyed stores and logger, so the
// runtime is keyed by account id. The ported callers ask with no argument, so
// the account being served travels in `AsyncLocalStorage`: each Hub entry point
// into the send path wraps its work in `withZaloAccount`, and the zero-arg
// accessors resolve that account. A caller outside any scope resolves the
// unkeyed slot, which is what a single-account host and the ported unit tests
// install. Same shape as the Google Chat (D-GC-003), Discord (D-DC-003) and
// Telegram (D-TG-046) verticals.
// Zalo plugin module implements runtime behavior.
import { AsyncLocalStorage } from "node:async_hooks";
import type { PluginRuntime } from "@getpaseo/channels-core/plugin-sdk/channel-core";

/** Installed runtimes by account id; `""` is the unkeyed single-account slot. */
const runtimes = new Map<string, PluginRuntime>();
const currentAccount = new AsyncLocalStorage<string>();

/** Runs `run` with `accountId` as the account the zero-arg accessors resolve. */
export function withZaloAccount<T>(accountId: string, run: () => T): T {
  return currentAccount.run(accountId, run);
}

/** The account being served, when a Hub entry point scoped one. */
export function currentZaloAccountId(): string | undefined {
  return currentAccount.getStore();
}

export function setZaloRuntime(next: PluginRuntime | undefined, accountId = ""): void {
  if (next === undefined) {
    runtimes.delete(accountId);
    return;
  }
  runtimes.set(accountId, next);
}

export function getOptionalZaloRuntime(accountId?: string): PluginRuntime | null {
  return runtimes.get(accountId ?? currentAccount.getStore() ?? "") ?? null;
}

export function getZaloRuntime(accountId?: string): PluginRuntime {
  const runtime = getOptionalZaloRuntime(accountId);
  if (!runtime) {
    throw new Error("Zalo runtime not initialized");
  }
  return runtime;
}
