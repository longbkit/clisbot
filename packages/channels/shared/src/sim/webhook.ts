// Simulated webhook senders: the client side of the push-mode channels.
//
// Zalo, Feishu/Lark, Google Chat and Telegram-in-webhook-mode do not hold a
// socket — they POST to a public URL the vertical authenticates. So the sim for
// this family is a signer: it builds the request the way the platform builds
// it, and a test drives the vertical's REAL receiver with it. Every algorithm
// below was read off the verifier that has to accept it:
//
//   zalo       `X-Bot-Api-Secret-Token: <secret>` — plaintext shared secret,
//              compared constant-time in `zalo/src/monitor.webhook.ts:130`.
//   telegram   `X-Telegram-Bot-Api-Secret-Token: <secret>` — same shape,
//              `telegram/src/fusion/webhook-session.ts` (checked BEFORE the
//              body is read).
//   feishu     `X-Lark-Signature: sha256hex(timestamp + nonce + encryptKey +
//              rawBody)` with `X-Lark-Request-Timestamp` / `-Nonce`,
//              `feishu/src/monitor.transport.ts:116`.
//   googlechat `Authorization: Bearer <RS256 JWT>` — a real asymmetric token,
//              signed with a keypair this module generates.
//
// WHAT CANNOT BE SIMULATED TRUTHFULLY, and why:
//
//   * Google Chat's verifier fetches Google's signing certificates from a
//     HARDCODED URL (`googlechat/src/auth.ts:16`
//     `.../x509/chat@system.gserviceaccount.com`) with no injection seam, so
//     `verifyGoogleChatRequest` cannot be pointed at a local key. The token
//     this module mints IS a real RS256 JWT and `certs()` returns the public
//     half in Google's `{kid: pem}` shape, so a test verifies it with the same
//     `google-auth-library` call the vertical makes
//     (`verifySignedJwtWithCertsAsync`). Only the cert SOURCE is substituted.
//   * Nothing here mints a credential for a live account. Zalo/Telegram secrets
//     are whatever the account is configured with; there is no platform-side
//     secret to forge and none is invented.

import { createHash, createSign, generateKeyPairSync, randomUUID } from "node:crypto";

export type SimWebhookPlatform = "zalo" | "feishu" | "googlechat" | "telegram";

/** The RS256 keypair a Google Chat token is signed with, plus its public half. */
export interface SimGoogleChatKey {
  readonly kid: string;
  readonly privateKeyPem: string;
  /** Google's cert map shape: hand this to `verifySignedJwtWithCertsAsync`. */
  readonly certs: Readonly<Record<string, string>>;
}

export interface SimWebhookSignParams {
  readonly platform: SimWebhookPlatform;
  /**
   * zalo / telegram: the shared secret token the account is configured with.
   * feishu: the account's `encryptKey`.
   * googlechat: the expected AUDIENCE (project number or app URL) — the token
   * is asymmetric, so there is no shared secret to pass.
   */
  readonly secret: string;
  readonly body: string | Record<string, unknown>;
  /** Feishu signature input; Google Chat `iat`. Seconds. Defaults to now. */
  readonly timestamp?: string;
  /** Feishu signature input. Defaults to a random uuid. */
  readonly nonce?: string;
  /** Google Chat only. Defaults to the module's shared key and Chat's issuer. */
  readonly googleChat?: {
    readonly key?: SimGoogleChatKey;
    readonly issuer?: string;
    readonly subject?: string;
    readonly emailVerified?: boolean;
    readonly expiresInSeconds?: number;
  };
}

export interface SimSignedWebhookRequest {
  readonly headers: Record<string, string>;
  readonly body: string;
}

export interface SimWebhookResponse {
  readonly status: number;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** One delivery a `SimWebhookClient` made, in send order. */
export interface SimWebhookDelivery {
  readonly at: number;
  readonly url: string;
  readonly platform: SimWebhookPlatform;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly response: SimWebhookResponse;
}

export interface SimWebhookClient {
  post(url: string, params: SimWebhookSignParams): Promise<SimWebhookResponse>;
  /** Every delivery this client made, oldest first. */
  sent(): readonly SimWebhookDelivery[];
  clear(): void;
}

const GOOGLE_CHAT_ISSUER = "chat@system.gserviceaccount.com";

/** Mints a fresh RS256 keypair. 2048-bit generation costs ~100 ms, so tests
 * that do not need key isolation should use the shared `googleChatSimKey()`. */
export function createGoogleChatSimKey(kid = `sim-key-${randomUUID()}`): SimGoogleChatKey {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { kid, privateKeyPem: privateKey, certs: Object.freeze({ [kid]: publicKey }) };
}

let sharedGoogleChatKey: SimGoogleChatKey | undefined;

/** The process-wide Google Chat key, generated on first use. */
export function googleChatSimKey(): SimGoogleChatKey {
  sharedGoogleChatKey ??= createGoogleChatSimKey("sim-googlechat-key");
  return sharedGoogleChatKey;
}

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function rawBodyOf(body: SimWebhookSignParams["body"]): string {
  return typeof body === "string" ? body : JSON.stringify(body);
}

/** A real RS256 id token in the shape `verifyGoogleChatRequest` expects. */
function signGoogleChatToken(params: SimWebhookSignParams): string {
  const key = params.googleChat?.key ?? googleChatSimKey();
  const issuer = params.googleChat?.issuer ?? GOOGLE_CHAT_ISSUER;
  const issuedAt = Number(params.timestamp ?? Math.floor(Date.now() / 1_000));
  const header = { alg: "RS256", typ: "JWT", kid: key.kid };
  const payload = {
    iss: issuer,
    aud: params.secret,
    sub: params.googleChat?.subject ?? issuer,
    email: issuer,
    email_verified: params.googleChat?.emailVerified ?? true,
    iat: issuedAt,
    exp: issuedAt + (params.googleChat?.expiresInSeconds ?? 3_600),
  };
  const signingInput = `${base64url(header)}.${base64url(payload)}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(key.privateKeyPem)
    .toString("base64url");
  return `${signingInput}.${signature}`;
}

/**
 * Builds the exact request the platform would send. The returned `body` is the
 * byte-identical string the signature covers — post THAT, not a re-serialized
 * object, or a signature that is correct here fails at the verifier.
 */
export function signWebhookRequest(params: SimWebhookSignParams): SimSignedWebhookRequest {
  const body = rawBodyOf(params.body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (params.platform === "zalo") {
    headers["x-bot-api-secret-token"] = params.secret;
    return { headers, body };
  }
  if (params.platform === "telegram") {
    headers["x-telegram-bot-api-secret-token"] = params.secret;
    return { headers, body };
  }
  if (params.platform === "googlechat") {
    headers["authorization"] = `Bearer ${signGoogleChatToken(params)}`;
    return { headers, body };
  }
  const timestamp = params.timestamp ?? String(Math.floor(Date.now() / 1_000));
  const nonce = params.nonce ?? randomUUID();
  headers["x-lark-request-timestamp"] = timestamp;
  headers["x-lark-request-nonce"] = nonce;
  headers["x-lark-signature"] = createHash("sha256")
    .update(timestamp + nonce + params.secret + body)
    .digest("hex");
  return { headers, body };
}

/** Signs, POSTs, and reads the answer back. One call per delivery. */
export async function postSignedWebhook(
  url: string,
  params: SimWebhookSignParams,
): Promise<SimWebhookResponse> {
  const signed = signWebhookRequest(params);
  const response = await fetch(url, { method: "POST", headers: signed.headers, body: signed.body });
  return {
    status: response.status,
    body: await response.text(),
    headers: Object.fromEntries(response.headers.entries()),
  };
}

/** A signer that keeps a log, so a test asserts what it sent as well as what
 * came back — the `SimRecorder` role on the sending side of this family. */
export function createSimWebhookClient(): SimWebhookClient {
  const startedAt = Date.now();
  const log: SimWebhookDelivery[] = [];
  return {
    async post(url, params) {
      const signed = signWebhookRequest(params);
      const response = await fetch(url, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
      });
      const result: SimWebhookResponse = {
        status: response.status,
        body: await response.text(),
        headers: Object.fromEntries(response.headers.entries()),
      };
      log.push({
        at: Date.now() - startedAt,
        url,
        platform: params.platform,
        headers: signed.headers,
        body: signed.body,
        response: result,
      });
      return result;
    },
    sent: () => [...log],
    clear: () => {
      log.length = 0;
    },
  };
}
