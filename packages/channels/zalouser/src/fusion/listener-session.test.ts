// The L2 listener session (D-ZU-015): admission runs before the message is let
// go, a failing admission is retried in place and only dropped loudly once the
// budget is spent, and a listener fault fails the account.

import { describe, expect, it, vi } from "vitest";
import type { ZalouserAdmission } from "./admission.js";
import { startZalouserListenerSession, ZALOUSER_ADMISSION_MAX_ATTEMPTS } from "./listener-session.js";
import { createZcaMessage } from "./test-support.js";

type ListenerStart = Parameters<typeof startZalouserListenerSession>[0]["startListener"];

/** A `startZaloListener` double: hands back the message pump plus the error
 * callback, so a case can push a message or fail the listener at will. */
function fakeListener() {
  let push: ((message: ReturnType<typeof createZcaMessage>) => Promise<void>) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const stop = vi.fn();
  const start = (async (params: {
    onMessage: (message: ReturnType<typeof createZcaMessage>) => Promise<void>;
    onError: (error: Error) => void;
  }) => {
    push = params.onMessage;
    fail = params.onError;
    return { stop };
  }) as unknown as ListenerStart;
  return {
    start,
    stop,
    push: (message: ReturnType<typeof createZcaMessage>) => push?.(message),
    fail: (error: Error) => fail?.(error),
  };
}

function admissionStub(receive: ZalouserAdmission["receive"]): ZalouserAdmission {
  return { receive };
}

describe("startZalouserListenerSession", () => {
  it("admits a message before the handler returns, then resolves on abort", async () => {
    const listener = fakeListener();
    const receive = vi.fn(async () => ({ kind: "durable" }) as const);
    const controller = new AbortController();
    const statuses: Record<string, unknown>[] = [];

    const session = startZalouserListenerSession({
      accountId: "acct",
      profile: "default",
      admission: admissionStub(receive),
      abortSignal: controller.signal,
      setStatus: (patch) => statuses.push(patch),
      startListener: listener.start,
    });

    await listener.push(createZcaMessage({}));
    expect(receive).toHaveBeenCalledTimes(1);

    controller.abort();
    await expect(session).resolves.toBeUndefined();
    expect(listener.stop).toHaveBeenCalled();
    expect(statuses).toContainEqual(expect.objectContaining({ lifecycle: "ready" }));
  });

  it("retries a failing admission in place and only drops it once the budget is spent", async () => {
    const listener = fakeListener();
    const receive = vi.fn(async () => {
      throw new Error("queue unavailable");
    });
    const controller = new AbortController();
    const errors: string[] = [];

    const session = startZalouserListenerSession({
      accountId: "acct",
      profile: "default",
      admission: admissionStub(receive),
      abortSignal: controller.signal,
      logger: { warn: () => {}, error: (message: string) => errors.push(message) },
      startListener: listener.start,
    });

    await listener.push(createZcaMessage({}));

    expect(receive).toHaveBeenCalledTimes(ZALOUSER_ADMISSION_MAX_ATTEMPTS);
    expect(errors.at(-1)).toMatch(/dropped after 5 admission attempts/);

    controller.abort();
    await session;
    // The real 500ms · attempt backoff runs, so the five attempts take ~5s.
  }, 20_000);

  it("succeeds on a retry without dropping the message", async () => {
    const listener = fakeListener();
    let calls = 0;
    const receive = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return { kind: "durable" } as const;
    });
    const controller = new AbortController();
    const errors: string[] = [];

    const session = startZalouserListenerSession({
      accountId: "acct",
      profile: "default",
      admission: admissionStub(receive),
      abortSignal: controller.signal,
      logger: { warn: () => {}, error: (message: string) => errors.push(message) },
      startListener: listener.start,
    });

    await listener.push(createZcaMessage({}));

    expect(receive).toHaveBeenCalledTimes(2);
    expect(errors).toEqual([]);

    controller.abort();
    await session;
  });

  it("fails the account when the listener faults, and flags an auth loss as terminal", async () => {
    const listener = fakeListener();
    const controller = new AbortController();
    const statuses: Record<string, unknown>[] = [];

    const session = startZalouserListenerSession({
      accountId: "acct",
      profile: "default",
      admission: admissionStub(async () => ({ kind: "durable" })),
      abortSignal: controller.signal,
      setStatus: (patch) => statuses.push(patch),
      startListener: listener.start,
    });
    // Let the session install its handlers before the fault.
    await Promise.resolve();
    listener.fail(Object.assign(new Error("session expired"), { status: 401 }));

    await expect(session).rejects.toThrow(/session expired/);
    expect(statuses).toContainEqual(expect.objectContaining({ terminalDisconnect: true }));
  });
});
