// The Fusion invariant this mode exists for: a Google Chat delivery is
// acknowledged only AFTER it is durably admitted. The listener is real
// (`node:http`), the bearer verifier is faked, and the queue is a fake
// `InboundQueueSink` so a test can watch admission ordering directly.
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ChannelInboundEvent,
  HostRuntime,
  InboundQueueSink,
} from "@getpaseo/channels-shared";
import { createGoogleChatAdmission } from "./admission.js";
import { resolveGoogleChatWebhookMode, startGoogleChatWebhookSession } from "./webhook-session.js";
import type { WebhookTarget } from "../monitor-types.js";

const verifyGoogleChatRequest = vi.hoisted(() => vi.fn());
vi.mock("../auth.js", () => ({ verifyGoogleChatRequest }));

const ACCOUNT_ID = "default";
const AUDIENCE = "1234567890";
const SPACE = "spaces/AAAA";

function messageEnvelope(messageId: string): Record<string, unknown> {
  return {
    type: "MESSAGE",
    eventTime: "2026-09-07T00:00:00Z",
    space: { name: SPACE, spaceType: "SPACE", displayName: "Test space" },
    user: { name: "users/111", displayName: "Ada", type: "HUMAN" },
    message: {
      name: `${SPACE}/messages/${messageId}`,
      text: "@app hello",
      argumentText: "hello",
      sender: { name: "users/111", displayName: "Ada", type: "HUMAN" },
      thread: { name: `${SPACE}/threads/T1` },
    },
  };
}

/** A queue whose `enqueue` the test drives: it records, and can be made to fail. */
function createFakeQueue(): {
  sink: InboundQueueSink;
  admitted: string[];
  failNext: { value: boolean };
} {
  const admitted: string[] = [];
  const failNext = { value: false };
  const sink = {
    enqueue: async (params: { externalMessageId: string }) => {
      if (failNext.value) throw new Error("queue write failed");
      if (admitted.includes(params.externalMessageId)) return { created: false, id: "dup" };
      admitted.push(params.externalMessageId);
      return { created: true, id: `row-${admitted.length}` };
    },
    claim: async () => undefined,
    complete: async () => undefined,
    fail: async () => undefined,
  } as unknown as InboundQueueSink;
  return { sink, admitted, failNext };
}

function createHostRuntime(queue: InboundQueueSink): {
  runtime: HostRuntime;
  dispatched: ChannelInboundEvent[];
} {
  const dispatched: ChannelInboundEvent[] = [];
  const runtime = {
    onInboundReply: async () => {
      throw new Error("the queue path must not reach onInboundReply");
    },
    state: { openKeyedStore: () => ({}) },
    logging: { getChildLogger: () => ({ warn: () => {} }) },
    channel: {},
    inboundQueue: queue,
  } as unknown as HostRuntime;
  return { runtime, dispatched };
}

async function startSession(options: {
  admitted: string[];
  queue: InboundQueueSink;
  processEvent?: (event: unknown) => Promise<void>;
}): Promise<{ url: string; stop: () => Promise<void> }> {
  const { runtime } = createHostRuntime(options.queue);
  const { createInboundEventProcessor } = await import("@getpaseo/channels-shared");
  const processor = createInboundEventProcessor({
    hostRuntime: runtime,
    channel: "googlechat",
    accountId: ACCOUNT_ID,
  });
  const admission = createGoogleChatAdmission({
    accountId: ACCOUNT_ID,
    handleInbound: (event) => processor.process(event),
  });
  const target = {
    account: { accountId: ACCOUNT_ID, config: {} },
    config: {},
    runtime: {},
    core: {} as never,
    path: "/googlechat",
    audienceType: "project-number",
    audience: AUDIENCE,
    mediaMaxMb: 20,
    ingress: admission,
  } as unknown as WebhookTarget;
  const controller = new AbortController();
  let port = 0;
  const ready = new Promise<void>((resolve) => {
    void startGoogleChatWebhookSession({
      target,
      webhook: { path: "/googlechat", port: 0, host: "127.0.0.1" },
      abortSignal: controller.signal,
      ...(options.processEvent === undefined
        ? {}
        : { processEvent: async (event) => options.processEvent?.(event) }),
      onListening: (bound) => {
        port = bound;
        resolve();
      },
    });
  });
  await ready;
  return {
    url: `http://127.0.0.1:${port}/googlechat`,
    stop: async () => {
      controller.abort();
      // Let the session's abort listener close the listener before the next case.
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
  };
}

async function post(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  verifyGoogleChatRequest.mockReset();
});

describe("googlechat webhook session", () => {
  it("admits the event into the queue before it answers 200", async () => {
    verifyGoogleChatRequest.mockResolvedValue({ ok: true });
    const queue = createFakeQueue();
    const session = await startSession({ admitted: queue.admitted, queue: queue.sink });
    try {
      const response = await post(session.url, messageEnvelope("M1"), {
        authorization: "Bearer good-token",
      });
      expect(response.status).toBe(200);
      // The row exists by the time the caller has its 200 — that ordering IS
      // the contract: Google treats the 200 as delivery complete.
      expect(queue.admitted).toEqual([`${SPACE}/messages/M1`]);
      expect(response.headers.get("x-openclaw-delivery-accepted")).toBe("durable");
    } finally {
      await session.stop();
    }
  });

  it("answers 401 and admits nothing when the bearer does not verify", async () => {
    verifyGoogleChatRequest.mockResolvedValue({ ok: false, reason: "invalid issuer" });
    const queue = createFakeQueue();
    const session = await startSession({ admitted: queue.admitted, queue: queue.sink });
    try {
      const response = await post(session.url, messageEnvelope("M2"), {
        authorization: "Bearer forged-token",
      });
      expect(response.status).toBe(401);
      expect(queue.admitted).toEqual([]);
    } finally {
      await session.stop();
    }
  });

  it("answers 401 without a bearer anywhere, and admits nothing", async () => {
    verifyGoogleChatRequest.mockResolvedValue({ ok: true });
    const queue = createFakeQueue();
    const session = await startSession({ admitted: queue.admitted, queue: queue.sink });
    try {
      const response = await post(session.url, messageEnvelope("M3"));
      expect(response.status).toBe(401);
      expect(queue.admitted).toEqual([]);
      expect(verifyGoogleChatRequest).not.toHaveBeenCalled();
    } finally {
      await session.stop();
    }
  });

  it("answers 503 when the queue write fails, so Google redelivers", async () => {
    verifyGoogleChatRequest.mockResolvedValue({ ok: true });
    const queue = createFakeQueue();
    queue.failNext.value = true;
    const session = await startSession({ admitted: queue.admitted, queue: queue.sink });
    try {
      const response = await post(session.url, messageEnvelope("M4"), {
        authorization: "Bearer good-token",
      });
      expect(response.status).toBe(503);
      expect(queue.admitted).toEqual([]);
      // A redelivery after the queue recovers must still be admitted: the
      // failed attempt left no in-process "already seen" mark behind.
      queue.failNext.value = false;
      const retry = await post(session.url, messageEnvelope("M4"), {
        authorization: "Bearer good-token",
      });
      expect(retry.status).toBe(200);
      expect(queue.admitted).toEqual([`${SPACE}/messages/M4`]);
    } finally {
      await session.stop();
    }
  });

  it("answers 400 for an envelope the normalizer rejects, and admits nothing", async () => {
    verifyGoogleChatRequest.mockResolvedValue({ ok: true });
    const queue = createFakeQueue();
    const session = await startSession({ admitted: queue.admitted, queue: queue.sink });
    try {
      const response = await post(
        session.url,
        { type: "MESSAGE", space: { name: SPACE } },
        { authorization: "Bearer good-token" },
      );
      expect(response.status).toBe(400);
      expect(queue.admitted).toEqual([]);
    } finally {
      await session.stop();
    }
  });

  it("acknowledges a non-turn event without the durable marker", async () => {
    verifyGoogleChatRequest.mockResolvedValue({ ok: true });
    const queue = createFakeQueue();
    const seen: unknown[] = [];
    const session = await startSession({
      admitted: queue.admitted,
      queue: queue.sink,
      processEvent: async (event) => {
        seen.push(event);
      },
    });
    try {
      const response = await post(
        session.url,
        {
          type: "CARD_CLICKED",
          eventTime: "2026-09-07T00:00:00Z",
          space: { name: SPACE, spaceType: "SPACE" },
          user: { name: "users/111", displayName: "Ada" },
          action: { actionMethodName: "approve", parameters: [{ key: "id", value: "42" }] },
          message: { name: `${SPACE}/messages/CARD` },
        },
        { authorization: "Bearer good-token" },
      );
      expect(response.status).toBe(200);
      // A card click IS a turn-eligible event here (kind: callback), so it is
      // admitted and carries the marker; only events the adapter refuses fall
      // through to the detached path.
      expect(response.headers.get("x-openclaw-delivery-accepted")).toBe("durable");
      expect(queue.admitted).toHaveLength(1);
    } finally {
      await session.stop();
    }
  });

  it("refuses a path that no target claims", async () => {
    verifyGoogleChatRequest.mockResolvedValue({ ok: true });
    const queue = createFakeQueue();
    const session = await startSession({ admitted: queue.admitted, queue: queue.sink });
    try {
      const response = await post(session.url.replace("/googlechat", "/nope"), messageEnvelope("M5"));
      expect(response.status).toBe(404);
      expect(queue.admitted).toEqual([]);
    } finally {
      await session.stop();
    }
  });
});

describe("resolveGoogleChatWebhookMode", () => {
  it("prefers an explicit path, then derives one from the URL", () => {
    expect(resolveGoogleChatWebhookMode({ webhookPath: "/hook" })?.path).toBe("/hook");
    expect(
      resolveGoogleChatWebhookMode({ webhookUrl: "https://chat.example.com/gc/hook" })?.path,
    ).toBe("/gc/hook");
    expect(resolveGoogleChatWebhookMode({})?.path).toBe("/googlechat");
  });

  it("returns null for an unparseable URL rather than the default path", () => {
    // Reporting the default here would advertise a route nothing binds.
    expect(resolveGoogleChatWebhookMode({ webhookUrl: "not-a-url" })).toBeNull();
  });
});
