// Fusion-owned test doubles for the zalouser vertical: a HostRuntime whose
// keyed stores are plain Maps, and a fake `zca-js` client good enough to drive
// the QR state machine and the listener session.
//
// Upstream's own doubles (`src/test-support/*`, `zalo-js.test-mocks.ts`) exist
// to drive the omitted OpenClaw monitor pipeline; these drive the Fusion seams.

import type {
  HostKeyedStore,
  HostKeyedStoreOptions,
  HostRuntime,
  InboundReplyParams,
  InboundReplyResult,
  KeyedStoreEntry,
} from "@getpaseo/channels-shared";
import type { API, LoginQRCallbackEvent, Message } from "../zca-client.js";

/** A HostRuntime backed by in-process Maps, one per opened namespace. */
export function createHostRuntimeStub(
  onInboundReply: (params: InboundReplyParams) => Promise<InboundReplyResult> = async () => ({
    dispatched: true,
  }),
): {
  runtime: HostRuntime;
  stores: Map<string, Map<string, unknown>>;
  inbound: InboundReplyParams[];
} {
  const stores = new Map<string, Map<string, unknown>>();
  const inbound: InboundReplyParams[] = [];
  const runtime: HostRuntime = {
    onInboundReply: async (params) => {
      inbound.push(params);
      return await onInboundReply(params);
    },
    state: {
      openKeyedStore: (options: HostKeyedStoreOptions): HostKeyedStore => {
        const rows = stores.get(options.namespace) ?? new Map<string, unknown>();
        stores.set(options.namespace, rows);
        return {
          register: async (key, value) => void rows.set(key, value),
          registerIfAbsent: async (key, value) => {
            if (rows.has(key)) return false;
            rows.set(key, value);
            return true;
          },
          update: async (key, updateValue) => {
            const next = updateValue(rows.get(key));
            if (next === undefined) return rows.delete(key);
            rows.set(key, next);
            return true;
          },
          lookup: async (key) => rows.get(key),
          consume: async (key) => {
            const value = rows.get(key);
            rows.delete(key);
            return value;
          },
          delete: async (key) => rows.delete(key),
          entries: async () =>
            Array.from(rows, ([key, value]): KeyedStoreEntry<unknown> => ({
              key,
              value,
              createdAt: 0,
            })),
          clear: async () => rows.clear(),
        };
      },
    },
    logging: {
      getChildLogger: () => ({ warn: () => {} }),
      shouldLogVerbose: () => false,
    },
    channel: {},
  };
  return { runtime, stores, inbound };
}

/** One inbound `zca-js` message envelope. */
export function createZcaMessage(overrides: {
  type?: number;
  data?: Record<string, unknown>;
  isSelf?: boolean;
}): Message {
  return {
    type: overrides.type ?? 0,
    threadId: "111",
    isSelf: overrides.isSelf ?? false,
    data: {
      msgId: "msg-1",
      cliMsgId: "cli-1",
      uidFrom: "111",
      idTo: "222",
      content: "hello",
      ts: "1757203200000",
      ...overrides.data,
    },
  };
}

/** The steps a fake QR login walks through, in order. */
export type FakeQrStep =
  | { kind: "generated"; image: string }
  | { kind: "scanned" }
  | { kind: "expired" }
  | { kind: "declined" }
  | { kind: "logged-in"; imei?: string; userAgent?: string };

/**
 * A `createZalo` double: it replays `steps` into the QR callback, then resolves
 * `loginQR` with a stub API. `retryFails` makes the expiry retry throw, which is
 * what makes upstream report the expiry instead of silently regenerating.
 */
export function createFakeZalo(params: {
  steps: FakeQrStep[];
  retryFails?: boolean;
  api?: Partial<API>;
  stepDelayMs?: number;
}): {
  createZalo: () => Promise<{
    login: (credentials: unknown) => Promise<API>;
    loginQR: (
      options?: unknown,
      callback?: (event: LoginQRCallbackEvent) => unknown,
    ) => Promise<API>;
  }>;
  aborted: () => boolean;
  api: API;
} {
  let abortedFlag = false;
  const api = createFakeApi(params.api);
  const actions = {
    retry: () => {
      if (params.retryFails === true) throw new Error("retry refused");
    },
    abort: () => {
      abortedFlag = true;
    },
  };
  return {
    aborted: () => abortedFlag,
    api,
    createZalo: async () => ({
      login: async () => api,
      loginQR: async (_options, callback) => {
        let resolveLogin: (() => void) | undefined;
        const loggedIn = new Promise<void>((resolve) => {
          resolveLogin = resolve;
        });
        for (const step of params.steps) {
          if (params.stepDelayMs !== undefined) {
            await new Promise((resolve) => setTimeout(resolve, params.stepDelayMs));
          }
          callback?.(toCallbackEvent(step, actions));
          if (step.kind === "logged-in") resolveLogin?.();
        }
        if (!params.steps.some((step) => step.kind === "logged-in")) {
          // A login that never completes: hang until the test's timeout, which
          // is exactly what a QR nobody scans does.
          await new Promise(() => {});
        }
        await loggedIn;
        return api;
      },
    }),
  };
}

function toCallbackEvent(
  step: FakeQrStep,
  actions: { retry: () => void; abort: () => void },
): LoginQRCallbackEvent {
  switch (step.kind) {
    case "generated":
      return {
        type: 0,
        data: { code: "code", image: step.image },
        actions: { saveToFile: async () => undefined, ...actions },
      };
    case "expired":
      return { type: 1, data: null, actions };
    case "scanned":
      return { type: 2, data: { avatar: "", display_name: "Owner" }, actions };
    case "declined":
      return { type: 3, data: { code: "code" }, actions };
    case "logged-in":
      return {
        type: 4,
        data: {
          cookie: [{ key: "zpsid", value: "fresh" }],
          imei: step.imei ?? "imei-fresh",
          userAgent: step.userAgent ?? "agent-fresh",
        },
        actions: null,
      };
  }
}

/** A `zca-js` API stub: the members the ported closure calls. */
export function createFakeApi(overrides: Partial<API> = {}): API {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const listener = {
    on: (event: string, callback: (...args: unknown[]) => void) => {
      const set = handlers.get(event) ?? new Set();
      set.add(callback);
      handlers.set(event, set);
    },
    off: (event: string, callback: (...args: unknown[]) => void) => {
      handlers.get(event)?.delete(callback);
    },
    start: () => {},
    stop: () => {},
    /** Test-only: fan an event out to the registered handlers. */
    emit: (event: string, ...args: unknown[]) => {
      for (const callback of handlers.get(event) ?? []) callback(...args);
    },
  };
  return {
    listener,
    getContext: () => ({ imei: "imei-1", userAgent: "agent-1", language: "vi" }),
    getCookie: () => ({ toJSON: () => ({ cookies: [{ key: "zpsid", value: "abc" }] }) }),
    fetchAccountInfo: async () => ({
      userId: "999",
      username: "owner",
      displayName: "Owner",
      zaloName: "Owner",
      avatar: "",
    }),
    getOwnId: () => "999",
    getAllFriends: async () => [],
    getAllGroups: async () => ({ gridVerMap: {} }),
    getGroupInfo: async () => ({ gridInfoMap: {} }),
    getGroupMembersInfo: async () => ({ profiles: {} }),
    sendMessage: async () => ({ msgId: "sent-1" }),
    uploadAttachment: async () => [],
    sendVoice: async () => ({ msgId: "voice-1" }),
    sendLink: async () => ({ msgId: "link-1" }),
    sendTypingEvent: async () => ({ status: 0 }),
    addReaction: async () => undefined,
    sendDeliveredEvent: async () => undefined,
    sendSeenEvent: async () => undefined,
    ...overrides,
  } as unknown as API;
}
