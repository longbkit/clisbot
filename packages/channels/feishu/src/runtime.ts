// upstream: extensions/feishu/src/runtime.ts@5d8067a4483
// D-FS-006: upstream stores the plugin runtime in OpenClaw's global plugin
// runtime store (`openclaw/plugin-sdk/runtime-store`), which opens SQLite-backed
// keyed stores from the OpenClaw state directory and resolves media through the
// host's media services. Fusion's Hub injects the runtime through
// `./fusion/runtime.ts`; the accessor names (`setFeishuRuntime` /
// `getFeishuRuntime`) and the throw-on-unset contract are unchanged.
//
// D-FS-007: upstream runs one Feishu account per OpenClaw process, so one slot
// holds the runtime. The Hub runs every account of every organization in one
// process, each with its own HostRuntime, keyed stores and logger, so the
// runtime is keyed by account id. The ported callers ask with no argument, so
// the account being served travels in `AsyncLocalStorage`: each Hub entry point
// into the send/tool path wraps its work in `withFeishuAccount`, and the
// zero-arg accessors resolve that account. A caller outside any scope resolves
// the unkeyed slot, which is what a single-account host and the ported unit
// tests install. This mirrors the Discord vertical's `runtime.ts` (D-DC-003)
// and the Telegram one's (D-TG-046).
import { AsyncLocalStorage } from "node:async_hooks";
import type { PluginRuntime } from "@getpaseo/channels-core/plugin-sdk/channel-core";

/** One inbound/outbound media blob as the host's media services return it. */
export interface FeishuSavedMediaHandle {
  path: string;
  contentType?: string;
  fileName?: string;
}

/**
 * The runtime members the ported Feishu closure reads, on top of the shared
 * `PluginRuntime.state`. Upstream gets these from `PluginRuntime`'s full
 * OpenClaw declaration; core's carried type stops at `state`, so the extra
 * members are named here with the shapes the ported call sites use.
 */
export type FeishuPluginRuntime = PluginRuntime & {
  media: {
    loadWebMedia(
      url: string,
      options: { maxBytes: number; optimizeImages?: boolean; localRoots?: readonly string[] },
    ): Promise<{ buffer: Buffer; fileName?: string; contentType?: string }>;
    detectMime(input: { buffer: Buffer }): Promise<string | undefined> | string | undefined;
  };
  channel: {
    media: {
      saveMediaBuffer(
        buffer: Buffer,
        contentType: string | undefined,
        direction: "inbound" | "outbound",
        maxBytes: number,
        fileName?: string,
      ): Promise<FeishuSavedMediaHandle>;
      readRemoteMediaBuffer(params: {
        url: string;
        maxBytes: number;
        timeoutMs?: number;
      }): Promise<{ buffer: Buffer; contentType?: string; fileName?: string }>;
    };
  };
};

/** Installed runtimes by account id; `""` is the unkeyed single-account slot. */
const runtimes = new Map<string, FeishuPluginRuntime>();
const currentAccount = new AsyncLocalStorage<string>();

/** Runs `run` with `accountId` as the account the zero-arg accessors resolve. */
export function withFeishuAccount<T>(accountId: string, run: () => T): T {
  return currentAccount.run(accountId, run);
}

/** The account being served, when a Hub entry point scoped one. */
export function currentFeishuAccountId(): string | undefined {
  return currentAccount.getStore();
}

export function setFeishuRuntime(next: FeishuPluginRuntime | undefined, accountId = ""): void {
  if (next === undefined) {
    runtimes.delete(accountId);
    return;
  }
  runtimes.set(accountId, next);
}

export function getOptionalFeishuRuntime(accountId?: string): FeishuPluginRuntime | null {
  return runtimes.get(accountId ?? currentAccount.getStore() ?? "") ?? null;
}

export function getFeishuRuntime(accountId?: string): FeishuPluginRuntime {
  const runtime = getOptionalFeishuRuntime(accountId);
  if (!runtime) {
    throw new Error("Feishu runtime not initialized");
  }
  return runtime;
}
