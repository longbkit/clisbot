// The webhook signer, proven against the REAL Feishu/Lark receiver.
//
// Rule 1 of docs/lessons/2026-08-26-integration-seams-before-live-e2e.md: spike
// the external contract before building on it. `signWebhookRequest` claims Lark
// signs with `sha256hex(timestamp + nonce + encryptKey + rawBody)` over three
// `X-Lark-*` headers; the only thing that can confirm that is the ported
// `monitor.transport.ts` check, which runs BEFORE the body is parsed, behind a
// real `node:http` listener.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createSimWebhookClient, signWebhookRequest } from "@getpaseo/channels-shared/sim";
import { startFeishuWebhookSession } from "../fusion/webhook-session.js";
import type { ResolvedFeishuAccount } from "../types.js";

const ENCRYPT_KEY = "sim-feishu-encrypt-key";
const VERIFICATION_TOKEN = "sim-verify-token";

/** The ported transport takes a port number, not a listener, so port 0 is out:
 * bind one, release it, and hand the number over. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", () => resolve()));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

function account(port: number): ResolvedFeishuAccount {
  return {
    accountId: "default",
    selectionSource: "explicit",
    enabled: true,
    configured: true,
    appId: "cli_sim_app",
    appSecret: "sim-secret",
    encryptKey: ENCRYPT_KEY,
    verificationToken: VERIFICATION_TOKEN,
    domain: "feishu",
    config: {
      connectionMode: "webhook",
      webhookPath: "/feishu",
      webhookPort: port,
      webhookHost: "127.0.0.1",
    },
  } as unknown as ResolvedFeishuAccount;
}

function messageEnvelope(text: string, messageId = "om_sim_1"): Record<string, unknown> {
  return {
    schema: "2.0",
    header: {
      event_id: "evt_sim_1",
      event_type: "im.message.receive_v1",
      token: VERIFICATION_TOKEN,
      create_time: "1757000000000",
      tenant_key: "tk",
      app_id: "cli_sim_app",
    },
    event: {
      sender: { sender_id: { open_id: "ou_sender" }, sender_type: "user" },
      message: {
        message_id: messageId,
        chat_id: "oc_1",
        chat_type: "group",
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
  await running?.catch(() => undefined);
  stop = undefined;
  running = undefined;
});

async function serve(
  handleInbound: () => Promise<{ dispatched: boolean; reason?: string }>,
): Promise<string> {
  const port = await freePort();
  stop = new AbortController();
  running = startFeishuWebhookSession({
    account: account(port),
    accountId: "default",
    abortSignal: stop.signal,
    runtime: { log: () => undefined, error: () => undefined, exit: () => undefined },
    admission: {
      accountId: "default",
      botOpenId: "ou_bot",
      handleInbound: handleInbound as never,
    },
  });
  // The ported transport resolves nothing until abort; poll the port instead.
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fetch(`${base}/feishu`, { method: "GET" });
      return `${base}/feishu`;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error("feishu webhook listener did not come up");
}

describe("the webhook sim against the real Feishu receiver", () => {
  it("gets a signed delivery admitted and durably acked", async () => {
    let admitted = 0;
    const url = await serve(async () => {
      admitted += 1;
      return { dispatched: true };
    });
    const client = createSimWebhookClient();

    const response = await client.post(url, {
      platform: "feishu",
      secret: ENCRYPT_KEY,
      body: messageEnvelope("hello from the sim"),
    });

    expect(response.status).toBe(200);
    expect(response.headers["x-openclaw-delivery-accepted"]).toBe("durable");
    expect(admitted).toBe(1);
  });

  it("is refused with 401 when the body no longer matches the signature", async () => {
    let admitted = 0;
    const url = await serve(async () => {
      admitted += 1;
      return { dispatched: true };
    });
    const signed = signWebhookRequest({
      platform: "feishu",
      secret: ENCRYPT_KEY,
      body: messageEnvelope("hello from the sim"),
      timestamp: "1757000000",
      nonce: "nonce-1",
    });

    // The signature covers the body; a tampered body must not verify, and the
    // check runs before any JSON parse, so admission never sees it.
    const response = await fetch(url, {
      method: "POST",
      headers: signed.headers,
      body: signed.body.replace("hello from the sim", "tampered by the sim"),
    });

    expect(response.status).toBe(401);
    expect(admitted).toBe(0);
  });

  it("is refused with 401 when the encrypt key is wrong", async () => {
    const url = await serve(async () => ({ dispatched: true }));
    const client = createSimWebhookClient();

    const response = await client.post(url, {
      platform: "feishu",
      secret: "not-the-encrypt-key",
      body: messageEnvelope("hello from the sim"),
    });

    expect(response.status).toBe(401);
  });
});
