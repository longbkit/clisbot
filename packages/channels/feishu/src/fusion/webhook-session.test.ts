import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { resolveFeishuConnectionMode, startFeishuWebhookSession } from "./webhook-session.js";
import type { ResolvedFeishuAccount } from "../types.js";

const ENCRYPT_KEY = "test-encrypt-key";
const VERIFICATION_TOKEN = "verify-token";

/** A free port, taken by binding and releasing one. The ported transport takes
 * a port number rather than a listener, so the test cannot pass port 0. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", () => resolve()));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

function buildAccount(port: number): ResolvedFeishuAccount {
  return {
    accountId: "default",
    selectionSource: "explicit",
    enabled: true,
    configured: true,
    appId: "cli_test_app",
    appSecret: "test-secret",
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

function messageEnvelope(text: string, messageId = "om_1") {
  return {
    schema: "2.0",
    header: {
      event_id: "evt_1",
      event_type: "im.message.receive_v1",
      token: VERIFICATION_TOKEN,
      create_time: "1757000000000",
      tenant_key: "tk",
      app_id: "cli_test_app",
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

function signedHeaders(rawBody: string, signature?: string): Record<string, string> {
  const timestamp = "1757000000";
  const nonce = "nonce-1";
  const computed =
    signature ??
    createHash("sha256").update(timestamp + nonce + ENCRYPT_KEY + rawBody).digest("hex");
  return {
    "content-type": "application/json",
    "x-lark-request-timestamp": timestamp,
    "x-lark-request-nonce": nonce,
    "x-lark-signature": computed,
  };
}

let stop: AbortController | undefined;
let running: Promise<void> | undefined;

afterEach(async () => {
  stop?.abort();
  await running?.catch(() => {});
  stop = undefined;
  running = undefined;
});

async function startSession(
  handleInbound: (event: unknown) => Promise<{ dispatched: boolean; reason?: string }>,
): Promise<string> {
  const port = await freePort();
  stop = new AbortController();
  running = startFeishuWebhookSession({
    account: buildAccount(port),
    accountId: "default",
    abortSignal: stop.signal,
    runtime: { log: () => {}, error: () => {}, exit: () => {} },
    admission: {
      accountId: "default",
      botOpenId: "ou_bot",
      handleInbound: handleInbound as never,
    },
  });
  // The ported transport resolves nothing until abort; poll the port instead.
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await fetch(`${base}/feishu`, { method: "GET" });
      return base;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error("feishu webhook listener did not come up");
}

describe("startFeishuWebhookSession", () => {
  it("refuses a bad signature with 401 before it parses the body", async () => {
    let handled = 0;
    const base = await startSession(async () => {
      handled += 1;
      return { dispatched: true };
    });
    const body = JSON.stringify(messageEnvelope("hello"));
    const response = await fetch(`${base}/feishu`, {
      method: "POST",
      headers: signedHeaders(body, "deadbeef"),
      body,
    });
    expect(response.status).toBe(401);
    expect(handled).toBe(0);
  });

  it("answers the URL verification challenge without admitting anything", async () => {
    let handled = 0;
    const base = await startSession(async () => {
      handled += 1;
      return { dispatched: true };
    });
    const body = JSON.stringify({ type: "url_verification", challenge: "c-123", token: "t" });
    const response = await fetch(`${base}/feishu`, {
      method: "POST",
      headers: signedHeaders(body),
      body,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: "c-123" });
    expect(handled).toBe(0);
  });

  it("marks the 200 durable only when the event was admitted", async () => {
    const base = await startSession(async () => ({ dispatched: true }));
    const body = JSON.stringify(messageEnvelope("hello"));
    const response = await fetch(`${base}/feishu`, {
      method: "POST",
      headers: signedHeaders(body),
      body,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-openclaw-delivery-accepted")).toBe("durable");
  });

  it("omits the durable marker when the processor dropped the event", async () => {
    const base = await startSession(async () => ({ dispatched: false, reason: "duplicate" }));
    const body = JSON.stringify(messageEnvelope("hello"));
    const response = await fetch(`${base}/feishu`, {
      method: "POST",
      headers: signedHeaders(body),
      body,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-openclaw-delivery-accepted")).toBeNull();
  });

  it("answers 5xx when admission throws, so Feishu redelivers", async () => {
    const base = await startSession(async () => {
      throw new Error("queue write failed");
    });
    const body = JSON.stringify(messageEnvelope("hello"));
    const response = await fetch(`${base}/feishu`, {
      method: "POST",
      headers: signedHeaders(body),
      body,
    });
    expect(response.status).toBe(500);
  });

  it("refuses a request off the configured path with 404", async () => {
    const base = await startSession(async () => ({ dispatched: true }));
    const body = JSON.stringify(messageEnvelope("hello"));
    const response = await fetch(`${base}/other`, {
      method: "POST",
      headers: signedHeaders(body),
      body,
    });
    expect(response.status).toBe(404);
  });
});

describe("resolveFeishuConnectionMode", () => {
  it("defaults to the long connection", () => {
    expect(resolveFeishuConnectionMode({ config: {} })).toBe("websocket");
    expect(resolveFeishuConnectionMode({ config: { connectionMode: "webhook" } })).toBe("webhook");
  });
});
