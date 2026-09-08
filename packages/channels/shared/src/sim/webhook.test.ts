// The webhook signer's transport contract, over a real `node:http` listener.
//
// Every ALGORITHM here is proven where its verifier lives, because a signer
// checked against a re-implementation of its own rule proves nothing:
//   zalo       packages/channels/zalo/src/sim/sim.interop.test.ts
//   feishu     packages/channels/feishu/src/sim/sim.interop.test.ts
//   googlechat packages/channels/googlechat/src/sim/sim.interop.test.ts
//   telegram   packages/channels/telegram/src/sim/webhook.interop.test.ts
//
// What is left for this file is the part those four share: the request reaches
// the listener with the signed headers attached, and the body on the wire is
// byte-identical to the body the signature was computed over.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createSimWebhookClient, postSignedWebhook, signWebhookRequest } from "./webhook.js";

interface Received {
  headers: Record<string, string>;
  body: string;
}

let server: Server | undefined;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

/** A listener that echoes back exactly what it received. */
async function echoServer(status = 200): Promise<{ url: string; received: Received[] }> {
  const received: Received[] = [];
  const listener = createServer((request: IncomingMessage, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([key, value]) => [key, String(value ?? "")]),
        ),
        body: Buffer.concat(chunks).toString("utf8"),
      });
      response.writeHead(status, { "content-type": "text/plain" });
      response.end("ok");
    });
  });
  server = listener;
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", () => resolve()));
  return { url: `http://127.0.0.1:${(listener.address() as AddressInfo).port}/hook`, received };
}

describe("signWebhookRequest", () => {
  it("carries each platform's auth header and nothing else's", () => {
    const body = { hello: "world" };
    expect(signWebhookRequest({ platform: "zalo", secret: "s3cret-token", body }).headers).toEqual({
      "content-type": "application/json",
      "x-bot-api-secret-token": "s3cret-token",
    });
    expect(
      signWebhookRequest({ platform: "telegram", secret: "s3cret-token", body }).headers,
    ).toEqual({
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "s3cret-token",
    });
    const feishu = signWebhookRequest({
      platform: "feishu",
      secret: "encrypt-key",
      body,
      timestamp: "1757000000",
      nonce: "nonce-1",
    });
    expect(Object.keys(feishu.headers).sort()).toEqual([
      "content-type",
      "x-lark-request-nonce",
      "x-lark-request-timestamp",
      "x-lark-signature",
    ]);
    expect(
      signWebhookRequest({ platform: "googlechat", secret: "1234567890", body }).headers[
        "authorization"
      ],
    ).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/u);
  });

  it("returns the exact bytes the signature covers", async () => {
    // Re-serializing the object at send time is the classic way to break a
    // signature that was correct when it was computed.
    const signed = signWebhookRequest({
      platform: "feishu",
      secret: "encrypt-key",
      body: { b: 2, a: 1 },
      timestamp: "1757000000",
      nonce: "nonce-1",
    });
    const echo = await echoServer();

    await postSignedWebhook(echo.url, {
      platform: "feishu",
      secret: "encrypt-key",
      body: { b: 2, a: 1 },
      timestamp: "1757000000",
      nonce: "nonce-1",
    });

    expect(echo.received[0]?.body).toBe(signed.body);
    expect(echo.received[0]?.headers["x-lark-signature"]).toBe(signed.headers["x-lark-signature"]);
  });

  it("changes the Feishu signature when the body changes", () => {
    const one = signWebhookRequest({
      platform: "feishu",
      secret: "encrypt-key",
      body: { a: 1 },
      timestamp: "1757000000",
      nonce: "nonce-1",
    });
    const two = signWebhookRequest({
      platform: "feishu",
      secret: "encrypt-key",
      body: { a: 2 },
      timestamp: "1757000000",
      nonce: "nonce-1",
    });
    expect(one.headers["x-lark-signature"]).not.toBe(two.headers["x-lark-signature"]);
  });
});

describe("createSimWebhookClient", () => {
  it("logs what it sent alongside what came back", async () => {
    const echo = await echoServer(503);
    const client = createSimWebhookClient();

    const response = await client.post(echo.url, {
      platform: "zalo",
      secret: "s3cret-token",
      body: { event_name: "message.text.received" },
    });

    expect(response).toMatchObject({ status: 503, body: "ok" });
    expect(client.sent()).toHaveLength(1);
    expect(client.sent()[0]).toMatchObject({
      url: echo.url,
      platform: "zalo",
      body: '{"event_name":"message.text.received"}',
      response: { status: 503 },
    });
    expect(client.sent()[0]?.headers["x-bot-api-secret-token"]).toBe("s3cret-token");
  });
});
