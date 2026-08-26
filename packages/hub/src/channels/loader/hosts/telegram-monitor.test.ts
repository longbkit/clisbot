// The host Telegram monitor (telegram-monitor.md, option A): getUpdates
// long-polling against an injected fetch, offset persistence in the keyed-store
// seam, in-flight dedupe, own-message suppression, the flat ctxPayload
// hand-off to `onInboundReply`, and the abort-only resolve contract. No real
// Bot API call — `fetch` is injected through `apiRoot` + a local test server is
// avoided by pointing `apiRoot` at a stub via `globalThis.fetch` capture.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InboundReplyParams, InboundReplyResult } from "../host.js";
import { createHostRuntime } from "../host.js";
import { createHostKeyedStoreRoot } from "../../state/keyed-store.js";
import { startHostTelegramMonitor } from "./telegram-monitor.js";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

interface RecordedUpdate {
  url: string;
  init?: RequestInit | undefined;
}

/** An index access that is safe after a length check (the tests assert the
 * length before reading the element). */
function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`expected an element at ${index}`);
  return item;
}

/** The monitor's poll loop awaits only store lookups and the provider fetch,
 * both of which the fake below resolves as microtasks. A `for(;;)` loop of pure
 * microtask awaits never yields to the macrotask queue, so the test's timer
 * ticks (and vitest's own deadlines) could not run while the monitor polled —
 * the fake therefore yields one macrotask per call, modeling the real Bot API
 * socket round-trip. Without this, the monitor busy-polls the fake and the
 * test hangs (it did). */
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function fakeBotApi(handler: (call: number, url: string) => { status?: number; body: unknown }) {
  let call = 0;
  const seen: RecordedUpdate[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    call += 1;
    seen.push({ url, init });
    await macrotask();
    const result = handler(call, url);
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchFn, seen, calls: () => call };
}

const BOT = { id: 777001, username: "hub_bot_under_test" };
const EXTERNAL_SENDER = {
  id: 888002,
  is_bot: true,
  first_name: "External",
  username: "external_sender",
};

function groupUpdate(updateId: number, overrides: Record<string, unknown> = {}): unknown {
  return {
    update_id: updateId,
    message: {
      message_id: 1000 + updateId,
      chat: { id: -100100, type: "supergroup", title: "Test Group" },
      from: EXTERNAL_SENDER,
      text: "hello",
      date: 1700000000 + updateId,
      ...overrides,
    },
  };
}

function nativeOptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    token: "123:TEST_TOKEN",
    accountId: "hub-acct",
    config: {
      channels: { telegram: { accounts: { "hub-acct": {} } } },
    },
    abortSignal: new AbortController().signal,
    botInfo: BOT,
    ...overrides,
  };
}

/** Drive the monitor against a fetch that answers every call, until the
 * predicate holds; then abort and expect a clean resolve (the monitor's
 * resolve-only-on-abort contract). */
async function driveUntil(
  fetchFn: FetchFn,
  options: Record<string, unknown>,
  hostRuntime: ReturnType<typeof createHostRuntime>,
  predicate: () => boolean,
): Promise<void> {
  const controller = new AbortController();
  options = { ...options, abortSignal: controller.signal };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchFn as unknown as typeof fetch;
  const monitor = startHostTelegramMonitor({
    hostRuntime,
    accountId: "hub-acct",
    options,
    logger: { warn: () => undefined },
  });
  try {
    const deadline = Date.now() + 5000;
    while (!predicate() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    controller.abort();
    await monitor;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("startHostTelegramMonitor", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("hands external sender messages to onInboundReply with the flat ctxPayload", async () => {
    const inbound: InboundReplyParams[] = [];
    const hostRuntime = createHostRuntime({
      onInboundReply: async (params) => {
        inbound.push(params);
        return {
          dispatched: true,
          dispatchResult: { queuedFinal: false, counts: {} },
        } satisfies InboundReplyResult;
      },
      state: createHostKeyedStoreRoot(),
    });
    const { fetchFn } = fakeBotApi(() => ({
      body: { ok: true, result: [groupUpdate(1), groupUpdate(2, { text: "second" })] },
    }));
    await driveUntil(fetchFn, nativeOptions(), hostRuntime, () => inbound.length === 2);

    expect(inbound).toHaveLength(2);
    const first = at(inbound, 0).ctxPayload;
    expect(at(inbound, 0).channel).toBe("telegram");
    expect(at(inbound, 0).accountId).toBe("hub-acct");
    expect(first["Body"]).toBe("hello");
    expect(first["ChatType"]).toBe("group");
    expect(first["ChatId"]).toBe("-100100");
    expect(first["MessageSid"]).toBe("1001");
    expect(first["SenderId"]).toBe("888002");
    expect(first["WasMentioned"]).toBe(false);
    expect(first["AccountId"]).toBe("hub-acct");
    expect(first["Timestamp"]).toBe((1700000000 + 1) * 1000);
    expect(at(inbound, 1).ctxPayload["Body"]).toBe("second");
    // The poll offset persisted to the keyed-store seam for the restart window.
    const store = hostRuntime.state.openSyncKeyedStore({
      namespace: "telegram.update-offsets",
      maxEntries: 1000,
    });
    expect(store.lookup("hub-acct")).toBe(2);
  });

  it("dedupes already-processed update ids across polls (no re-delivery)", async () => {
    const inbound: number[] = [];
    const hostRuntime = createHostRuntime({
      onInboundReply: async (params) => {
        inbound.push(Number(params.ctxPayload["MessageSid"]));
        return { dispatched: true, dispatchResult: { queuedFinal: false, counts: {} } };
      },
      state: createHostKeyedStoreRoot(),
    });
    const { fetchFn, seen } = fakeBotApi(() => ({
      // The provider re-serves update 1 on every poll (offset not yet consumed
      // server-side); the monitor must deliver it exactly once.
      body: { ok: true, result: [groupUpdate(1)] },
    }));
    await driveUntil(
      fetchFn,
      nativeOptions(),
      hostRuntime,
      () => seen.length >= 3 && inbound.length === 1,
    );
    expect(inbound).toEqual([1001]);
  });

  it("suppresses the bot's own messages (the relay's replies never loop)", async () => {
    const inbound: InboundReplyParams[] = [];
    const hostRuntime = createHostRuntime({
      onInboundReply: async (params) => {
        inbound.push(params);
        return { dispatched: true, dispatchResult: { queuedFinal: false, counts: {} } };
      },
      state: createHostKeyedStoreRoot(),
    });
    const ownMessage = groupUpdate(1, { from: { ...BOT, is_bot: true }, text: "my reply" });
    const { fetchFn } = fakeBotApi(() => ({
      body: { ok: true, result: [groupUpdate(2), ownMessage] },
    }));
    await driveUntil(fetchFn, nativeOptions(), hostRuntime, () => inbound.length === 1);
    expect(at(inbound, 0).ctxPayload["MessageSid"]).toBe("1002");
  });

  it("marks a @username mention in the group as mentionedBot", async () => {
    const inbound: InboundReplyParams[] = [];
    const hostRuntime = createHostRuntime({
      onInboundReply: async (params) => {
        inbound.push(params);
        return { dispatched: true, dispatchResult: { queuedFinal: false, counts: {} } };
      },
      state: createHostKeyedStoreRoot(),
    });
    const text = "ping @hub_bot_under_test now";
    const mentioned = groupUpdate(1, {
      text,
      entities: [{ type: "mention", offset: 5, length: 19 }],
    });
    const { fetchFn } = fakeBotApi(() => ({
      body: { ok: true, result: [mentioned] },
    }));
    await driveUntil(fetchFn, nativeOptions(), hostRuntime, () => inbound.length === 1);
    expect(at(inbound, 0).ctxPayload["WasMentioned"]).toBe(true);
  });

  it("maps a forum topic message to ChatType group with MessageThreadId", async () => {
    const inbound: InboundReplyParams[] = [];
    const hostRuntime = createHostRuntime({
      onInboundReply: async (params) => {
        inbound.push(params);
        return { dispatched: true, dispatchResult: { queuedFinal: false, counts: {} } };
      },
      state: createHostKeyedStoreRoot(),
    });
    const { fetchFn } = fakeBotApi(() => ({
      body: {
        ok: true,
        result: [groupUpdate(1, { message_thread_id: 42, chat: { id: -200200, type: "forum" } })],
      },
    }));
    await driveUntil(fetchFn, nativeOptions(), hostRuntime, () => inbound.length === 1);
    expect(at(inbound, 0).ctxPayload["ChatType"]).toBe("group");
    expect(at(inbound, 0).ctxPayload["MessageThreadId"]).toBe("42");
    expect(at(inbound, 0).ctxPayload["ChatId"]).toBe("-200200");
  });

  it("maps a DM to ChatType direct and treats it as mentioned", async () => {
    const inbound: InboundReplyParams[] = [];
    const hostRuntime = createHostRuntime({
      onInboundReply: async (params) => {
        inbound.push(params);
        return { dispatched: true, dispatchResult: { queuedFinal: false, counts: {} } };
      },
      state: createHostKeyedStoreRoot(),
    });
    const { fetchFn } = fakeBotApi(() => ({
      body: {
        ok: true,
        result: [
          {
            update_id: 1,
            message: {
              message_id: 5,
              chat: { id: 314159, type: "private" },
              from: { id: 314159, first_name: "Human" },
              text: "hi",
              date: 1700000000,
            },
          },
        ],
      },
    }));
    await driveUntil(fetchFn, nativeOptions(), hostRuntime, () => inbound.length === 1);
    expect(at(inbound, 0).ctxPayload["ChatType"]).toBe("direct");
    expect(at(inbound, 0).ctxPayload["WasMentioned"]).toBe(true);
  });

  it("resolves on abort without rejecting (the native lifecycle contract)", async () => {
    const hostRuntime = createHostRuntime({
      onInboundReply: async () => ({
        dispatched: true,
        dispatchResult: { queuedFinal: false, counts: {} },
      }),
      state: createHostKeyedStoreRoot(),
    });
    // Every poll returns no updates: the monitor stays in the long-poll loop
    // until the abort.
    const { fetchFn } = fakeBotApi(() => ({ body: { ok: true, result: [] } }));
    await driveUntil(fetchFn, nativeOptions(), hostRuntime, () => true);
  });

  it("rejects on a 401 token fault (P13 account failure)", async () => {
    const hostRuntime = createHostRuntime({
      onInboundReply: async () => ({
        dispatched: true,
        dispatchResult: { queuedFinal: false, counts: {} },
      }),
      state: createHostKeyedStoreRoot(),
    });
    const { fetchFn } = fakeBotApi(() => ({
      status: 401,
      body: { ok: false, description: "Unauthorized" },
    }));
    globalThis.fetch = fetchFn as unknown as typeof fetch;
    try {
      const controller = new AbortController();
      const monitor = startHostTelegramMonitor({
        hostRuntime,
        accountId: "hub-acct",
        options: nativeOptions({ abortSignal: controller.signal }),
        logger: { warn: () => undefined },
      });
      await expect(monitor).rejects.toThrow(/401/);
    } finally {
      globalThis.fetch = originalFetch; // restored via the describe-level capture
    }
  });

  it("throws when driven without a token", async () => {
    const hostRuntime = createHostRuntime({
      onInboundReply: async () => ({
        dispatched: true,
        dispatchResult: { queuedFinal: false, counts: {} },
      }),
      state: createHostKeyedStoreRoot(),
    });
    expect(() =>
      startHostTelegramMonitor({
        hostRuntime,
        accountId: "hub-acct",
        options: nativeOptions({ token: "  " }),
        logger: { warn: () => undefined },
      }),
    ).toThrow(/token/);
  });

  it("throws on a webhook drive (P0 transport mode is polling only)", async () => {
    const hostRuntime = createHostRuntime({
      onInboundReply: async () => ({
        dispatched: true,
        dispatchResult: { queuedFinal: false, counts: {} },
      }),
      state: createHostKeyedStoreRoot(),
    });
    expect(() =>
      startHostTelegramMonitor({
        hostRuntime,
        accountId: "hub-acct",
        options: nativeOptions({ useWebhook: true }),
        logger: { warn: () => undefined },
      }),
    ).toThrow(/long-polling only/);
  });
});
