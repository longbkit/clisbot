// The webhook signer, proven against the REAL Zalo receiver.
//
// Rule 1 of docs/lessons/2026-08-26-integration-seams-before-live-e2e.md: spike
// the external contract before building on it. `signWebhookRequest` claims Zalo
// authenticates with a plaintext `X-Bot-Api-Secret-Token`; the only thing that
// can confirm that is the ported `handleZaloWebhookRequest`, running behind a
// real `node:http` listener, admitting a request the signer built.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSimWebhookClient, signWebhookRequest } from "@getpaseo/channels-shared/sim";
import { zaloWebhookRuntime } from "../monitor.webhook.js";
import type { ResolvedZaloAccount } from "../types.js";
import type { ZaloAdmission, ZaloAdmissionResult } from "../fusion/admission.js";
import { startZaloWebhookSession } from "../fusion/webhook-session.js";

const ACCOUNT: ResolvedZaloAccount = {
  accountId: "default",
  enabled: true,
  token: "tok",
  tokenSource: "config",
  config: {},
};

/** 8-256 chars, the window `assertZaloWebhookMode` enforces. */
const SECRET = "sim-zalo-secret-token";

function rawEvent(messageId = "m-1"): Record<string, unknown> {
  return {
    event_name: "message.text.received",
    message: {
      message_id: messageId,
      from: { id: "user-1" },
      chat: { id: "chat-1", chat_type: "PRIVATE" },
      date: 1_700_000_000,
      text: "hello from the sim",
    },
  };
}

let stop: (() => Promise<void>) | undefined;

afterEach(async () => {
  await stop?.();
  stop = undefined;
  zaloWebhookRuntime.clearZaloWebhookSecurityStateForTest();
});

async function serve(admission: ZaloAdmission): Promise<string> {
  const controller = new AbortController();
  let resolvePort: (port: number) => void = () => undefined;
  const ready = new Promise<number>((resolve) => {
    resolvePort = resolve;
  });
  const running = startZaloWebhookSession({
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
    onListening: (bound) => resolvePort(bound),
  });
  const port = await ready;
  stop = async () => {
    controller.abort();
    await running;
  };
  return `http://127.0.0.1:${port}/zalo`;
}

describe("the webhook sim against the real Zalo receiver", () => {
  it("gets a signed delivery admitted and durably acked", async () => {
    const seen: string[] = [];
    const url = await serve({
      receiveRaw: async (raw: string) => {
        seen.push(raw);
        return { kind: "durable" } satisfies ZaloAdmissionResult;
      },
      receiveUpdate: async () => ({ kind: "durable" }),
    });
    const client = createSimWebhookClient();

    const response = await client.post(url, {
      platform: "zalo",
      secret: SECRET,
      body: rawEvent(),
    });

    expect(response.status).toBe(200);
    expect(response.headers["x-openclaw-delivery-accepted"]).toBe("durable");
    // The receiver saw the exact bytes the signer sent, not a re-serialization.
    expect(seen).toEqual([client.sent()[0]?.body]);
  });

  it("is refused with 401 when the secret is wrong, before admission runs", async () => {
    const receiveRaw = vi.fn(async () => ({ kind: "durable" }) as ZaloAdmissionResult);
    const url = await serve({ receiveRaw, receiveUpdate: receiveRaw });
    const signed = signWebhookRequest({ platform: "zalo", secret: SECRET, body: rawEvent() });

    const response = await fetch(url, {
      method: "POST",
      headers: { ...signed.headers, "x-bot-api-secret-token": "not-the-secret" },
      body: signed.body,
    });

    expect(response.status).toBe(401);
    expect(receiveRaw).not.toHaveBeenCalled();
  });
});
