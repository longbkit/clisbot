// Fusion-owned webhook receive mode (goal slice 20, D-TG-055).
//
// UNEXERCISED IN PRODUCTION: no live scenario runs it, because it needs a public
// HTTPS URL the dev host does not have. It is wired, typechecked and unit-tested
// against a fake `Api` + a real `node:http` server, and nothing else. Do not
// report webhook mode as verified.
//
// Upstream's `webhook.ts` (680 lines) owns much more: a shared multi-account
// server registry, TLS certificate upload, health/status endpoints, the
// setWebhook retry ladder and the OpenClaw runtime plumbing. Fusion keeps the
// three facts that make the mode correct and the same admission invariant the
// poll has: verify `X-Telegram-Bot-Api-Secret-Token` before touching the body,
// respond 200 only AFTER the update is durably admitted (the webhook's 200 is
// its ACK, exactly as the offset watermark is the poll's), and answer a callback
// query before handing it on.
//
// The endpoint is a PUBLIC HTTPS URL, so the two guards below are load-bearing:
//
//   * The secret is REQUIRED, not optional. Without it the only thing standing
//     between the open internet and an admitted "Telegram" update is a
//     guessable path (`/telegram/<accountId>`), and an admitted update runs an
//     agent turn under whatever identity the body claims. `startAccount`
//     refuses webhook mode with no secret rather than serving an unauthenticated
//     endpoint.
//   * The body is read through the ported `readRequestBodyWithLimit` with
//     upstream's pre-auth/post-auth profiles, so an unauthenticated caller
//     cannot stream an unbounded body into the Hub's heap.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { formatErrorMessage } from "@getpaseo/channels-core/plugin-sdk/error-runtime";
import {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
  WEBHOOK_BODY_READ_DEFAULTS,
} from "@getpaseo/channels-core/plugin-sdk/webhook-ingress";
import { safeEqualSecret } from "@getpaseo/channels-core/security/secret-equal";
import type { HostChildLogger } from "@getpaseo/channels-shared";
import type { CallbackQuery, Update } from "grammy/types";
import { resolveTelegramAllowedUpdates } from "../allowed-updates.js";
import type { TelegramApi } from "../client/bot-api.js";
import {
  createTelegramApprovalDispatcher,
  type TelegramApprovalDispatcher,
} from "./approval-dispatch.js";
import {
  buildTelegramInboundEvent,
  type TelegramInboundBuild,
  type TelegramInboundParams,
} from "./inbound-adapter.js";

/** The account config fields that switch an account into webhook mode. */
export interface TelegramWebhookMode {
  /** The public HTTPS URL Telegram posts updates to. */
  publicUrl: string;
  /** The listen port for the owned `node:http` server. */
  port: number;
  /** The request path (defaults to `/telegram/<accountId>`). */
  path?: string;
  /** The shared secret echoed in `X-Telegram-Bot-Api-Secret-Token`. Required:
   * `assertTelegramWebhookMode` refuses a webhook account without one. */
  secret?: string;
  host?: string;
}

/** Reads webhook mode out of an account's config. `null` = polling (default). */
export function resolveTelegramWebhookMode(config: {
  webhookUrl?: unknown;
  webhookPort?: unknown;
  webhookPath?: unknown;
  webhookSecret?: unknown;
  webhookHost?: unknown;
}): TelegramWebhookMode | null {
  const publicUrl = typeof config.webhookUrl === "string" ? config.webhookUrl.trim() : "";
  if (publicUrl === "") return null;
  const port = typeof config.webhookPort === "number" ? config.webhookPort : 0;
  return {
    publicUrl,
    port,
    ...(typeof config.webhookPath === "string" && config.webhookPath !== ""
      ? { path: config.webhookPath }
      : {}),
    ...(typeof config.webhookSecret === "string" && config.webhookSecret !== ""
      ? { secret: config.webhookSecret }
      : {}),
    ...(typeof config.webhookHost === "string" && config.webhookHost !== ""
      ? { host: config.webhookHost }
      : {}),
  };
}

/**
 * Webhook mode's precondition, the mirror of the Zalo vertical's
 * `assertZaloWebhookMode`. Fails CLOSED: a webhook account with no secret is a
 * configuration error, never an endpoint that admits whatever posts to it.
 * Telegram's `secret_token` accepts 1-256 chars of `A-Za-z0-9_-`; the 8-256
 * window is the Hub's own (`channels/config/schema.ts`) and the Zalo
 * vertical's, so one number governs every webhook channel.
 */
export function assertTelegramWebhookMode(webhook: TelegramWebhookMode): void {
  if (!webhook.publicUrl.startsWith("https://")) {
    throw new Error("Telegram webhook URL must use HTTPS");
  }
  const secret = webhook.secret;
  if (secret === undefined || secret.length < 8 || secret.length > 256) {
    throw new Error(
      "Telegram webhook mode requires `webhookSecret` (8-256 characters): without it the public endpoint would admit any caller",
    );
  }
  if (!/^[A-Za-z0-9_-]+$/.test(secret)) {
    throw new Error("Telegram webhookSecret must only contain A-Z, a-z, 0-9, _ and -");
  }
}

export interface TelegramWebhookSessionOptions extends TelegramInboundParams {
  api: TelegramApi;
  abortSignal: AbortSignal;
  admit: (build: TelegramInboundBuild) => Promise<void>;
  onApprovalCallback?: (callbackQuery: CallbackQuery) => Promise<void>;
  logger?: HostChildLogger;
  setStatus?: (patch: Record<string, unknown>) => void;
  webhook: TelegramWebhookMode;
  /** Test seam: skip the outbound `setWebhook` registration. */
  skipRegistration?: boolean;
  /** Reports the bound port once the listener is up (port 0 = ephemeral). */
  onListening?: (port: number) => void;
}

/** Runs until `abortSignal` fires. */
export async function startTelegramWebhookSession(
  options: TelegramWebhookSessionOptions,
): Promise<void> {
  assertTelegramWebhookMode(options.webhook);
  const path = options.webhook.path ?? `/telegram/${options.accountId}`;
  // One dispatcher per session: a redelivered click (the 500 path) must not run
  // the approval seam twice.
  const approvals = createTelegramApprovalDispatcher({
    accountId: options.accountId,
    seam: options.onApprovalCallback,
    logger: options.logger,
  });
  const server = createServer((req, res) => {
    void handleRequest(options, path, approvals, req, res);
  });
  await listen(server, options.webhook.port, options.webhook.host);
  const address = server.address();
  if (options.onListening !== undefined && address !== null && typeof address === "object") {
    options.onListening(address.port);
  }
  if (options.skipRegistration !== true) {
    await options.api.setWebhook?.(options.webhook.publicUrl, {
      allowed_updates: resolveTelegramAllowedUpdates(),
      ...(options.webhook.secret === undefined ? {} : { secret_token: options.webhook.secret }),
    });
  }
  options.setStatus?.({ mode: "webhook", connected: true, lastConnectedAt: Date.now() });
  try {
    await waitForAbort(options.abortSignal);
  } finally {
    options.setStatus?.({ mode: "webhook", connected: false });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function handleRequest(
  options: TelegramWebhookSessionOptions,
  path: string,
  approvals: TelegramApprovalDispatcher,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST" || (req.url ?? "").split("?")[0] !== path) {
    res.writeHead(404).end();
    return;
  }
  // Authenticate BEFORE the body is touched, and fail closed when the account
  // carries no secret (`assertTelegramWebhookMode` should have refused the
  // start, so reaching here means the listener was driven directly).
  const expected = options.webhook.secret;
  const provided = req.headers["x-telegram-bot-api-secret-token"];
  if (
    expected === undefined ||
    typeof provided !== "string" ||
    !safeEqualSecret(provided, expected)
  ) {
    res.writeHead(401).end();
    return;
  }
  let update: Update;
  try {
    // Post-auth profile: an authenticated Telegram update is at most 1 MB.
    // `destroyOnLimit: false` is upstream's response-first variant — the
    // refusal is still immediate, but the status reaches the caller instead of
    // arriving as a socket reset.
    update = JSON.parse(
      await readRequestBodyWithLimit(req, WEBHOOK_BODY_READ_DEFAULTS.postAuthResponseFirst),
    ) as Update;
  } catch (error) {
    options.logger?.warn("telegram webhook body read failed", {
      accountId: options.accountId,
      error: formatErrorMessage(error),
    });
    if (isRequestBodyLimitError(error)) {
      res.writeHead(error.statusCode).end(requestBodyErrorToText(error.code));
      return;
    }
    res.writeHead(400).end();
    return;
  }
  try {
    await admitWebhookUpdate(options, approvals, update);
  } catch (error) {
    // 500 keeps Telegram redelivering: the update was NOT durably admitted.
    options.logger?.warn("telegram webhook admission failed (will be redelivered)", {
      accountId: options.accountId,
      updateId: update.update_id,
      error: formatErrorMessage(error),
    });
    res.writeHead(500).end();
    return;
  }
  res.writeHead(200).end();
}

async function admitWebhookUpdate(
  options: TelegramWebhookSessionOptions,
  approvals: TelegramApprovalDispatcher,
  update: Update,
): Promise<void> {
  if (update.callback_query !== undefined) {
    await options.api
      .answerCallbackQuery({ callback_query_id: update.callback_query.id })
      .catch(() => undefined);
  }
  const build = buildTelegramInboundEvent(update, {
    accountId: options.accountId,
    botId: options.botId,
    ...(options.botUsername === undefined ? {} : { botUsername: options.botUsername }),
  });
  // Durable admission FIRST: a throw answers 500 and Telegram redelivers the
  // update, so an approval seam that already ran would answer twice.
  if (build !== null) await options.admit(build);
  if (update.callback_query !== undefined) {
    await approvals.dispatch(update.callback_query);
  }
}

function listen(server: Server, port: number, host?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    if (host === undefined) server.listen(port, () => resolve());
    else server.listen(port, host, () => resolve());
  });
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
