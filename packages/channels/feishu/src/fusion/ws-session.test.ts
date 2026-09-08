import * as Lark from "@larksuiteoapi/node-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelInboundEvent } from "@getpaseo/channels-shared";
import type { ResolvedFeishuAccount } from "../types.js";

// The SDK boundary: `monitorWebSocket` constructs the real `WSClient`, which
// would dial open.feishu.cn. The fake keeps the whole ported loop — reconnect
// ladder, cleanup, status patches — and only replaces the socket.
const wsState: {
  dispatcher?: Lark.EventDispatcher;
  starts: number;
  closes: number;
  callbacks?: Record<string, (() => void) | ((err: Error) => void)>;
} = { starts: 0, closes: 0 };

vi.mock("../client.js", async () => {
  const actual = await vi.importActual<typeof import("../client.js")>("../client.js");
  return {
    ...actual,
    createFeishuWSClient: async (
      _account: unknown,
      callbacks: Record<string, (() => void) | ((err: Error) => void)>,
    ) => {
      wsState.callbacks = callbacks;
      return {
        start: async ({ eventDispatcher }: { eventDispatcher: Lark.EventDispatcher }) => {
          wsState.dispatcher = eventDispatcher;
          wsState.starts += 1;
        },
        close: () => {
          wsState.closes += 1;
        },
      };
    },
  };
});

const { startFeishuWsSession } = await import("./ws-session.js");

const account = {
  accountId: "default",
  enabled: true,
  configured: true,
  appId: "cli_test_app",
  appSecret: "test-secret",
  encryptKey: "test-encrypt-key",
  verificationToken: "verify-token",
  domain: "feishu",
  config: {},
} as unknown as ResolvedFeishuAccount;

function messageEnvelope(text: string) {
  return {
    schema: "2.0",
    header: {
      event_id: "evt_1",
      event_type: "im.message.receive_v1",
      token: "verify-token",
      create_time: "1757000000000",
      tenant_key: "tk",
      app_id: "cli_test_app",
    },
    event: {
      sender: { sender_id: { open_id: "ou_sender" }, sender_type: "user" },
      message: {
        message_id: "om_1",
        chat_id: "oc_1",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text }),
        create_time: "1757000000000",
      },
    },
  };
}

let stop: AbortController | undefined;
let running: Promise<void> | undefined;

afterEach(async () => {
  stop?.abort();
  await running?.catch(() => {});
  stop = undefined;
  running = undefined;
  wsState.dispatcher = undefined;
  wsState.callbacks = undefined;
  wsState.starts = 0;
  wsState.closes = 0;
});

describe("startFeishuWsSession", () => {
  it("drives an inbound WS event through admission and stops on abort", async () => {
    const admitted: ChannelInboundEvent[] = [];
    const statuses: Record<string, unknown>[] = [];
    stop = new AbortController();
    running = startFeishuWsSession({
      account,
      accountId: "default",
      abortSignal: stop.signal,
      runtime: { log: () => {}, error: () => {}, exit: () => {} },
      statusSink: (patch) => statuses.push(patch),
      admission: {
        accountId: "default",
        botOpenId: "ou_bot",
        handleInbound: async (event) => {
          admitted.push(event);
          return { dispatched: true };
        },
      },
    });
    for (let attempt = 0; attempt < 50 && wsState.dispatcher === undefined; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(wsState.starts).toBe(1);
    // The SDK's ready callback is what publishes the connected status patch.
    (wsState.callbacks?.onReady as (() => void) | undefined)?.();
    await wsState.dispatcher?.invoke(messageEnvelope("hi from ws") as never, {
      needCheck: false,
    });
    expect(admitted).toHaveLength(1);
    expect(admitted[0]).toMatchObject({ body: "hi from ws", chatType: "direct" });
    expect(statuses.some((patch) => patch.connected === true)).toBe(true);

    stop.abort();
    await running;
    expect(wsState.closes).toBeGreaterThanOrEqual(1);
  });
});
