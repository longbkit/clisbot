// The polling mode's contract. Zalo's `getUpdates` has no offset, so the
// durability rule the loop must hold is "admit before the next call".
import { describe, expect, it, vi } from "vitest";
import { ZaloApiError } from "../api.js";
import type { ZaloAdmission } from "./admission.js";
import {
  startZaloPollingSession,
  ZALO_POLL_MIN_INTERVAL_MS,
  ZALO_UPDATE_MAX_ATTEMPTS,
} from "./polling-session.js";

function update(messageId: string) {
  return {
    event_name: "message.text.received" as const,
    message: {
      message_id: messageId,
      from: { id: "user-1" },
      chat: { id: "chat-1", chat_type: "PRIVATE" as const },
      date: 1_700_000_000,
      text: "hello",
    },
  };
}

/** A fetcher that answers `getUpdates` from a queued script, in order. */
function scriptedFetcher(script: Array<{ result?: unknown; error?: ZaloApiError }>) {
  let call = 0;
  const calls: string[] = [];
  const fetcher = (async (input: string) => {
    const step = script[Math.min(call, script.length - 1)];
    call += 1;
    calls.push(input);
    if (step?.error) throw step.error;
    return Response.json({ ok: true, result: step?.result });
  }) as unknown as Parameters<typeof startZaloPollingSession>[0]["fetcher"];
  return { fetcher, calls, callCount: () => call };
}

const noopStatus = () => {};

describe("startZaloPollingSession", () => {
  it("admits an update before it asks for the next one", async () => {
    const order: string[] = [];
    const script = scriptedFetcher([{ result: update("m-1") }, { result: update("m-2") }]);
    const wrapped = (async (input: string, init?: RequestInit) => {
      order.push("getUpdates");
      return await (script.fetcher as never as (i: string, x?: RequestInit) => Promise<Response>)(
        input,
        init,
      );
    }) as never;
    const admission: ZaloAdmission = {
      receiveRaw: async () => ({ kind: "durable" }),
      receiveUpdate: async () => {
        order.push("admit");
        return { kind: "durable" };
      },
    };
    await startZaloPollingSession({
      token: "tok",
      accountId: "default",
      admission,
      abortSignal: new AbortController().signal,
      fetcher: wrapped,
      skipWebhookCleanup: true,
      maxPolls: 2,
      setStatus: noopStatus,
    });
    expect(order).toEqual(["getUpdates", "admit", "getUpdates", "admit"]);
  });

  it("retries a failed admission in place and drops the update loudly once the budget is spent", async () => {
    const script = scriptedFetcher([{ result: update("m-1") }]);
    let attempts = 0;
    const error = vi.fn();
    const admission: ZaloAdmission = {
      receiveRaw: async () => ({ kind: "durable" }),
      receiveUpdate: async () => {
        attempts += 1;
        throw new Error("queue write failed");
      },
    };
    await startZaloPollingSession({
      token: "tok",
      accountId: "default",
      admission,
      abortSignal: new AbortController().signal,
      fetcher: script.fetcher,
      skipWebhookCleanup: true,
      maxPolls: 1,
      logger: { error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as never,
      setStatus: noopStatus,
    });
    expect(attempts).toBe(ZALO_UPDATE_MAX_ATTEMPTS);
    expect(error.mock.calls[0]?.[0]).toContain("dropped after");
    // The backoff between admission attempts is real time (0.5s + 1s + 1.5s +
    // 2s), so this case needs more than vitest's 5s default.
  }, 20_000);

  it("treats a 408 as an empty window and keeps polling", async () => {
    const timeout = new ZaloApiError("Zalo API timeout: getUpdates", 408, "no updates");
    const script = scriptedFetcher([{ error: timeout }, { result: update("m-1") }]);
    const receiveUpdate = vi.fn(async () => ({ kind: "durable" }) as const);
    await startZaloPollingSession({
      token: "tok",
      accountId: "default",
      admission: { receiveRaw: async () => ({ kind: "durable" }), receiveUpdate },
      abortSignal: new AbortController().signal,
      fetcher: script.fetcher,
      skipWebhookCleanup: true,
      maxPolls: 2,
      setStatus: noopStatus,
    });
    expect(receiveUpdate).toHaveBeenCalledTimes(1);
  });

  it("paces the loop when the provider answers a timeout immediately", async () => {
    // A gateway that answers 408 without holding the request turns upstream's
    // "no updates, poll again" rule into a hot loop. The floor sleep is what
    // keeps a broken long poll from burning a core.
    vi.useFakeTimers();
    try {
      const timeout = new ZaloApiError("Zalo API timeout: getUpdates", 408, "no updates");
      const script = scriptedFetcher([{ error: timeout }]);
      const warn = vi.fn();
      const done = startZaloPollingSession({
        token: "tok",
        accountId: "default",
        admission: {
          receiveRaw: async () => ({ kind: "durable" }),
          receiveUpdate: async () => ({ kind: "durable" }),
        },
        abortSignal: new AbortController().signal,
        fetcher: script.fetcher,
        skipWebhookCleanup: true,
        maxPolls: 3,
        logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() } as never,
        setStatus: noopStatus,
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(script.callCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(ZALO_POLL_MIN_INTERVAL_MS);
      expect(script.callCount()).toBe(2);
      await vi.advanceTimersByTimeAsync(ZALO_POLL_MIN_INTERVAL_MS);
      expect(script.callCount()).toBe(3);
      // The last poll's floor sleep still has to elapse before the loop exits.
      await vi.advanceTimersByTimeAsync(ZALO_POLL_MIN_INTERVAL_MS);
      await done;

      // Logged once per session, not once per poll.
      expect(warn.mock.calls.filter(([line]) => /pacing polls/.test(String(line)))).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops on an auth error and reports a terminal disconnect", async () => {
    const script = scriptedFetcher([
      { error: new ZaloApiError("unauthorized", 401, "bad token") },
      { result: update("never") },
    ]);
    const patches: Record<string, unknown>[] = [];
    await startZaloPollingSession({
      token: "tok",
      accountId: "default",
      admission: {
        receiveRaw: async () => ({ kind: "durable" }),
        receiveUpdate: async () => ({ kind: "durable" }),
      },
      abortSignal: new AbortController().signal,
      fetcher: script.fetcher,
      skipWebhookCleanup: true,
      maxPolls: 5,
      setStatus: (patch) => patches.push(patch),
    });
    // The loop returned on the first call rather than polling five times.
    expect(script.callCount()).toBe(1);
    expect(patches.at(-1)).toMatchObject({ connected: false, terminalDisconnect: true });
  });

  it("clears a stale webhook before the first poll", async () => {
    const seen: string[] = [];
    const fetcher = (async (input: string) => {
      seen.push(new URL(input).pathname.split("/").at(-1) ?? "");
      if (input.endsWith("/getWebhookInfo")) {
        return Response.json({ ok: true, result: { url: "https://old.example.com/zalo" } });
      }
      return Response.json({ ok: true, result: undefined });
    }) as never;
    await startZaloPollingSession({
      token: "tok",
      accountId: "default",
      admission: {
        receiveRaw: async () => ({ kind: "durable" }),
        receiveUpdate: async () => ({ kind: "durable" }),
      },
      abortSignal: new AbortController().signal,
      fetcher,
      maxPolls: 1,
      setStatus: noopStatus,
    });
    expect(seen.slice(0, 3)).toEqual(["getWebhookInfo", "deleteWebhook", "getUpdates"]);
  });
});
