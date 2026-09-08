// The webhook mode's contract, over a real `node:http` listener: the 200 is
// written only after admission returned, a bad secret never reaches admission,
// and a failed handoff answers 5xx so Zalo redelivers.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedZaloAccount } from "../types.js";
import { zaloWebhookRuntime } from "../monitor.webhook.js";
import type { ZaloAdmission, ZaloAdmissionResult } from "./admission.js";
import { resolveZaloWebhookMode, startZaloWebhookSession } from "./webhook-session.js";

const ACCOUNT: ResolvedZaloAccount = {
  accountId: "default",
  enabled: true,
  token: "tok",
  tokenSource: "config",
  config: {},
};

const SECRET = "secret-token-1234";

function rawEvent(messageId = "m-1"): string {
  return JSON.stringify({
    event_name: "message.text.received",
    message: {
      message_id: messageId,
      from: { id: "user-1" },
      chat: { id: "chat-1", chat_type: "PRIVATE" },
      date: 1_700_000_000,
      text: "hello",
    },
  });
}

async function withSession(
  admission: ZaloAdmission,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  let port = 0;
  const ready = new Promise<void>((resolve) => {
    void startZaloWebhookSession({
      account: ACCOUNT,
      cfg: {},
      token: "tok",
      webhook: {
        path: "/zalo",
        webhookUrl: "https://bot.example.com/zalo",
        port: 0,
        host: "127.0.0.1",
      },
      webhookSecret: SECRET,
      admission,
      abortSignal: controller.signal,
      skipWebhookRegistration: true,
      onListening: (bound) => {
        port = bound;
        resolve();
      },
    });
  });
  await ready;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    controller.abort();
    // Let the session's finally run (unregister + server close).
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function post(baseUrl: string, body: string, secret = SECRET): Promise<Response> {
  return fetch(`${baseUrl}/zalo`, {
    method: "POST",
    headers: { "x-bot-api-secret-token": secret, "content-type": "application/json" },
    body,
  });
}

afterEach(() => {
  zaloWebhookRuntime.clearZaloWebhookSecurityStateForTest();
});

describe("resolveZaloWebhookMode", () => {
  it("derives the listen path from the webhook URL", () => {
    expect(resolveZaloWebhookMode({ webhookUrl: "https://bot.example.com/hooks/zalo" })).toEqual({
      path: "/hooks/zalo",
      webhookUrl: "https://bot.example.com/hooks/zalo",
      port: 0,
    });
  });

  it("is null without a webhookUrl (the account is in polling mode)", () => {
    expect(resolveZaloWebhookMode({})).toBeNull();
  });

  it("prefers an explicit webhookPath and reports port/host", () => {
    expect(
      resolveZaloWebhookMode({
        webhookUrl: "https://bot.example.com/hooks/zalo",
        webhookPath: "/custom",
        webhookPort: 8123,
        webhookHost: "127.0.0.1",
      }),
    ).toEqual({
      path: "/custom",
      webhookUrl: "https://bot.example.com/hooks/zalo",
      port: 8123,
      host: "127.0.0.1",
    });
  });
});

describe("zalo webhook session", () => {
  it("answers 200 with the durable marker only after admission returned", async () => {
    const order: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admission: ZaloAdmission = {
      receiveRaw: async () => {
        order.push("admission-start");
        await gate;
        order.push("admission-durable");
        return { kind: "durable" } satisfies ZaloAdmissionResult;
      },
      receiveUpdate: async () => ({ kind: "durable" }),
    };
    await withSession(admission, async (baseUrl) => {
      const pending = post(baseUrl, rawEvent());
      // The ack must not be written while admission is still in flight.
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(order).toEqual(["admission-start"]);
      release?.();
      const response = await pending;
      order.push(`ack-${response.status}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-openclaw-delivery-accepted")).toBe("durable");
      expect(order).toEqual(["admission-start", "admission-durable", "ack-200"]);
    });
  });

  it("answers 401 for a wrong secret and never calls admission", async () => {
    const receiveRaw = vi.fn(async () => ({ kind: "durable" }) as ZaloAdmissionResult);
    await withSession({ receiveRaw, receiveUpdate: receiveRaw }, async (baseUrl) => {
      const response = await post(baseUrl, rawEvent(), "wrong-secret-value");
      expect(response.status).toBe(401);
      expect(receiveRaw).not.toHaveBeenCalled();
    });
  });

  it("answers 500 when the handoff fails, so Zalo redelivers", async () => {
    const admission: ZaloAdmission = {
      receiveRaw: async () => {
        throw new Error("queue write failed");
      },
      receiveUpdate: async () => ({ kind: "durable" }),
    };
    await withSession(admission, async (baseUrl) => {
      const response = await post(baseUrl, rawEvent());
      expect(response.status).toBe(500);
      expect(response.headers.get("x-openclaw-delivery-accepted")).toBeNull();
    });
  });

  it("answers 400 for a payload admission calls permanently invalid", async () => {
    const admission: ZaloAdmission = {
      receiveRaw: async () => ({ kind: "invalid", reason: "not a Zalo envelope" }),
      receiveUpdate: async () => ({ kind: "durable" }),
    };
    await withSession(admission, async (baseUrl) => {
      const response = await post(baseUrl, "{}");
      expect(response.status).toBe(400);
    });
  });

  it("acks an ignored update without claiming durability", async () => {
    const admission: ZaloAdmission = {
      receiveRaw: async () => ({ kind: "ignored", reason: "unsupported-event" }),
      receiveUpdate: async () => ({ kind: "durable" }),
    };
    await withSession(admission, async (baseUrl) => {
      const response = await post(baseUrl, rawEvent());
      expect(response.status).toBe(200);
    });
  });
});

describe("startZaloWebhookSession failure paths", () => {
  it("leaves no webhook target behind when the listener cannot bind", async () => {
    // The target used to be registered before `listen`, so a bound port left the
    // account's path registered in the process-wide ported registry forever.
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", () => resolve()));
    const port = (blocker.address() as AddressInfo).port;
    const unregister = vi.fn();
    const register = vi
      .spyOn(zaloWebhookRuntime, "registerZaloWebhookTarget")
      .mockReturnValue(unregister);
    try {
      await expect(
        startZaloWebhookSession({
          account: ACCOUNT,
          cfg: {},
          token: "tok",
          webhook: {
            path: "/zalo-busy",
            webhookUrl: "https://bot.example.com/zalo-busy",
            port,
            host: "127.0.0.1",
          },
          webhookSecret: SECRET,
          admission: {
            receiveRaw: async () => ({ kind: "durable" }) as ZaloAdmissionResult,
            receiveUpdate: async () => ({ kind: "durable" }) as ZaloAdmissionResult,
          },
          abortSignal: new AbortController().signal,
          skipWebhookRegistration: true,
        }),
      ).rejects.toThrow(/EADDRINUSE/);
      expect(register).toHaveBeenCalledTimes(1);
      expect(unregister).toHaveBeenCalledTimes(1);
    } finally {
      register.mockRestore();
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});
