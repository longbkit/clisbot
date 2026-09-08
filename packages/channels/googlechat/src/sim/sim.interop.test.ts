// The webhook signer, proven against the REAL Google Chat token verification.
//
// Google Chat does not sign with a shared secret: it sends an RS256 id token in
// `Authorization: Bearer`, and the vertical verifies it with
// `google-auth-library`'s `verifySignedJwtWithCertsAsync`
// (`src/auth.ts:194`). So the sim mints a REAL RS256 token, and the first case
// below hands it to that exact library call — a forged-shaped token would fail
// the signature check, not a string comparison.
//
// THE GAP, and it is a real one: `verifyGoogleChatRequest` fetches Google's
// certificates from a HARDCODED URL (`auth.ts:16`) through
// `fetchWithSsrFGuard`, with no injection seam. Nothing local can make the
// production verifier trust a locally minted key. The session case therefore
// substitutes the CERT SOURCE only — the mocked `../auth.js` runs the real
// `verifySignedJwtWithCertsAsync` against the sim's certs, so the token's
// signature, audience and issuer are all checked for real, and only the
// "where did the public key come from" step is local.
import { afterEach, describe, expect, it, vi } from "vitest";
import { OAuth2Client } from "google-auth-library";
import { createSimWebhookClient, googleChatSimKey, signWebhookRequest } from "@getpaseo/channels-shared/sim";
import type { ChannelInboundEvent, HostRuntime, InboundQueueSink } from "@getpaseo/channels-shared";

const AUDIENCE = "1234567890";
const SPACE = "spaces/AAAA";
const CHAT_ISSUER = "chat@system.gserviceaccount.com";

// Only the cert SOURCE is faked: the mock runs the real library verification.
const verifyGoogleChatRequest = vi.hoisted(() => vi.fn());
vi.mock("../auth.js", () => ({ verifyGoogleChatRequest }));

function messageEnvelope(messageId: string): Record<string, unknown> {
  return {
    type: "MESSAGE",
    eventTime: "2026-09-07T00:00:00Z",
    space: { name: SPACE, spaceType: "SPACE", displayName: "Sim space" },
    user: { name: "users/111", displayName: "Ada", type: "HUMAN" },
    message: {
      name: `${SPACE}/messages/${messageId}`,
      text: "@app hello from the sim",
      argumentText: "hello from the sim",
      sender: { name: "users/111", displayName: "Ada", type: "HUMAN" },
      thread: { name: `${SPACE}/threads/T1` },
    },
  };
}

function createFakeQueue(): { sink: InboundQueueSink; admitted: string[] } {
  const admitted: string[] = [];
  const sink = {
    enqueue: async (params: { externalMessageId: string }) => {
      if (admitted.includes(params.externalMessageId)) return { created: false, id: "dup" };
      admitted.push(params.externalMessageId);
      return { created: true, id: `row-${admitted.length}` };
    },
    claim: async () => undefined,
    complete: async () => undefined,
    fail: async () => undefined,
  } as unknown as InboundQueueSink;
  return { sink, admitted };
}

let stop: (() => Promise<void>) | undefined;

afterEach(async () => {
  await stop?.();
  stop = undefined;
  verifyGoogleChatRequest.mockReset();
});

async function serve(): Promise<{ url: string; admitted: string[] }> {
  const queue = createFakeQueue();
  const runtime = {
    onInboundReply: async () => {
      throw new Error("the queue path must not reach onInboundReply");
    },
    state: { openKeyedStore: () => ({}) },
    logging: { getChildLogger: () => ({ warn: () => undefined }) },
    channel: {},
    inboundQueue: queue.sink,
  } as unknown as HostRuntime;
  const { createInboundEventProcessor } = await import("@getpaseo/channels-shared");
  const processor = createInboundEventProcessor({
    hostRuntime: runtime,
    channel: "googlechat",
    accountId: "default",
  });
  const { createGoogleChatAdmission } = await import("../fusion/admission.js");
  const { startGoogleChatWebhookSession } = await import("../fusion/webhook-session.js");
  const admission = createGoogleChatAdmission({
    accountId: "default",
    handleInbound: (event: ChannelInboundEvent) => processor.process(event),
  });
  const controller = new AbortController();
  let resolvePort: (port: number) => void = () => undefined;
  const ready = new Promise<number>((resolve) => {
    resolvePort = resolve;
  });
  void startGoogleChatWebhookSession({
    target: {
      account: { accountId: "default", config: {} },
      config: {},
      runtime: {},
      core: {} as never,
      path: "/googlechat",
      audienceType: "project-number",
      audience: AUDIENCE,
      mediaMaxMb: 20,
      ingress: admission,
    } as never,
    webhook: { path: "/googlechat", port: 0, host: "127.0.0.1" },
    abortSignal: controller.signal,
    onListening: (bound) => resolvePort(bound),
  });
  const port = await ready;
  stop = async () => {
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  return { url: `http://127.0.0.1:${port}/googlechat`, admitted: queue.admitted };
}

describe("the webhook sim's Google Chat token", () => {
  it("verifies with the same google-auth-library call the vertical makes", async () => {
    const key = googleChatSimKey();
    const signed = signWebhookRequest({
      platform: "googlechat",
      secret: AUDIENCE,
      body: messageEnvelope("M0"),
    });
    const bearer = signed.headers["authorization"]?.slice("Bearer ".length) ?? "";

    const ticket = await new OAuth2Client().verifySignedJwtWithCertsAsync(
      bearer,
      key.certs,
      AUDIENCE,
      [CHAT_ISSUER],
    );

    expect(ticket.getPayload()).toMatchObject({
      iss: CHAT_ISSUER,
      aud: AUDIENCE,
      email_verified: true,
    });
  });

  it("fails that verification for the wrong audience", async () => {
    const key = googleChatSimKey();
    const signed = signWebhookRequest({
      platform: "googlechat",
      secret: "9999999999",
      body: messageEnvelope("M0"),
    });
    const bearer = signed.headers["authorization"]?.slice("Bearer ".length) ?? "";

    await expect(
      new OAuth2Client().verifySignedJwtWithCertsAsync(bearer, key.certs, AUDIENCE, [CHAT_ISSUER]),
    ).rejects.toThrow(/audience/iu);
  });

  it("fails that verification when signed by a different key", async () => {
    const { createGoogleChatSimKey } = await import("@getpaseo/channels-shared/sim");
    const other = createGoogleChatSimKey("sim-other-key");
    const signed = signWebhookRequest({
      platform: "googlechat",
      secret: AUDIENCE,
      body: messageEnvelope("M0"),
      googleChat: { key: other },
    });
    const bearer = signed.headers["authorization"]?.slice("Bearer ".length) ?? "";

    await expect(
      new OAuth2Client().verifySignedJwtWithCertsAsync(
        bearer,
        googleChatSimKey().certs,
        AUDIENCE,
        [CHAT_ISSUER],
      ),
    ).rejects.toThrow();
  });
});

describe("the webhook sim against the real Google Chat receiver", () => {
  it("gets a bearer-signed delivery admitted and durably acked", async () => {
    // Real verification, local certs: only the cert source is substituted.
    verifyGoogleChatRequest.mockImplementation(
      async (params: { bearer?: string; audience?: string }) => {
        try {
          await new OAuth2Client().verifySignedJwtWithCertsAsync(
            params.bearer ?? "",
            googleChatSimKey().certs,
            params.audience ?? "",
            [CHAT_ISSUER],
          );
          return { ok: true };
        } catch (error) {
          return { ok: false, reason: error instanceof Error ? error.message : "invalid token" };
        }
      },
    );
    const session = await serve();
    const client = createSimWebhookClient();

    const response = await client.post(session.url, {
      platform: "googlechat",
      secret: AUDIENCE,
      body: messageEnvelope("M1"),
    });

    expect(response.status).toBe(200);
    expect(response.headers["x-openclaw-delivery-accepted"]).toBe("durable");
    expect(session.admitted).toEqual([`${SPACE}/messages/M1`]);
  });

  it("answers 401 and admits nothing for a token the audience rejects", async () => {
    verifyGoogleChatRequest.mockImplementation(
      async (params: { bearer?: string; audience?: string }) => {
        try {
          await new OAuth2Client().verifySignedJwtWithCertsAsync(
            params.bearer ?? "",
            googleChatSimKey().certs,
            params.audience ?? "",
            [CHAT_ISSUER],
          );
          return { ok: true };
        } catch (error) {
          return { ok: false, reason: error instanceof Error ? error.message : "invalid token" };
        }
      },
    );
    const session = await serve();
    const client = createSimWebhookClient();

    const response = await client.post(session.url, {
      platform: "googlechat",
      secret: "9999999999",
      body: messageEnvelope("M2"),
    });

    expect(response.status).toBe(401);
    expect(session.admitted).toEqual([]);
  });
});
