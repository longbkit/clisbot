// upstream: extensions/telegram/src/runtime.ts@5d8067a4483
// D-TG-014: upstream stores the plugin runtime in OpenClaw's plugin runtime
// store (`openclaw/plugin-sdk/runtime-store`) and opens SQLite-backed keyed
// stores from the OpenClaw state directory. Fusion's Hub injects the runtime
// through `./fusion/runtime.ts`; the accessor names and throw-on-unset contract
// are unchanged.
//
// D-TG-046: upstream runs one Telegram account per OpenClaw process, so one
// slot holds the runtime. The Hub runs every account of every organization in
// one process, each with its own HostRuntime, keyed stores and logger, so the
// runtime is keyed by account id. The ported callers ask with no argument, so
// the account being served travels in `AsyncLocalStorage`: each Hub entry point
// into the send path wraps its work in `withTelegramAccount`, and the zero-arg
// accessors resolve that account. A caller outside any scope resolves the
// unkeyed slot, which is what a single-account host and the ported unit tests
// install.
import { AsyncLocalStorage } from "node:async_hooks";
import type { TelegramRuntime } from "./runtime.types.js";

/** Installed runtimes by account id; `""` is the unkeyed single-account slot. */
const runtimes = new Map<string, TelegramRuntime>();
const currentAccount = new AsyncLocalStorage<string>();

/** Runs `run` with `accountId` as the account the zero-arg accessors resolve. */
export function withTelegramAccount<T>(accountId: string, run: () => T): T {
  return currentAccount.run(accountId, run);
}

/** The account being served, when a Hub entry point scoped one. */
export function currentTelegramAccountId(): string | undefined {
  return currentAccount.getStore();
}

export function setTelegramRuntime(next: TelegramRuntime | undefined, accountId = ""): void {
  if (next === undefined) {
    runtimes.delete(accountId);
    return;
  }
  runtimes.set(accountId, next);
}

export function getOptionalTelegramRuntime(accountId?: string): TelegramRuntime | undefined {
  return runtimes.get(accountId ?? currentAccount.getStore() ?? "");
}

export function getTelegramRuntime(accountId?: string): TelegramRuntime {
  const runtime = getOptionalTelegramRuntime(accountId);
  if (!runtime) {
    throw new Error("Telegram runtime not initialized");
  }
  return runtime;
}
