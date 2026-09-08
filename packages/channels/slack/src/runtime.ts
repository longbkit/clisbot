// upstream: extensions/slack/src/runtime.ts@5d8067a4483
// D-036: upstream stores the plugin runtime in OpenClaw's plugin runtime store
// (`openclaw/plugin-sdk/runtime-store`) and opens SQLite-backed keyed stores
// from the OpenClaw state directory. Fusion's Hub injects the runtime through
// `./fusion/runtime.ts`; the accessor names and throw-on-unset contract are
// unchanged. Mirrors the Telegram package's `runtime.ts` (D-TG-014).
//
// D-043: upstream runs one Slack account per OpenClaw process, so one slot
// holds the runtime. The Hub runs every account of every organization in one
// process, each with its own HostRuntime, keyed stores and logger, so the
// runtime is keyed by account id. The ported callers ask with no argument, so
// the account being served travels in `AsyncLocalStorage`: each Hub entry point
// into the drive surface wraps its work in `withSlackAccount`, and the zero-arg
// accessors resolve that account. A caller outside any scope resolves the
// unkeyed slot, which is what a single-account host and the ported unit tests
// install. Same shape as the Telegram vertical's `runtime.ts` (D-TG-046).
import { AsyncLocalStorage } from "node:async_hooks";
import type { SlackRuntime } from "./runtime.types.js";

/** Installed runtimes by account id; `""` is the unkeyed single-account slot. */
const runtimes = new Map<string, SlackRuntime>();
const currentAccount = new AsyncLocalStorage<string>();

/** Runs `run` with `accountId` as the account the zero-arg accessors resolve. */
export function withSlackAccount<T>(accountId: string, run: () => T): T {
  return currentAccount.run(accountId, run);
}

/** The account being served, when a Hub entry point scoped one. */
export function currentSlackAccountId(): string | undefined {
  return currentAccount.getStore();
}

export function setSlackRuntime(next: SlackRuntime | undefined, accountId = ""): void {
  if (next === undefined) {
    runtimes.delete(accountId);
    return;
  }
  runtimes.set(accountId, next);
}

export function getOptionalSlackRuntime(accountId?: string): SlackRuntime | undefined {
  return runtimes.get(accountId ?? currentAccount.getStore() ?? "");
}

export function getSlackRuntime(accountId?: string): SlackRuntime {
  const runtime = getOptionalSlackRuntime(accountId);
  if (!runtime) {
    throw new Error("Slack runtime not initialized");
  }
  return runtime;
}
