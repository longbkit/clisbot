// Fusion-owned webhook receive mode (D-FS-017).
//
// UNEXERCISED IN PRODUCTION: Lark event subscription needs a public HTTPS
// endpoint the dev host does not have, so no live scenario runs this. It is
// wired, typechecked and unit-tested against a real `node:http` listener, and
// nothing else. Do not report Feishu webhook inbound as verified.
//
// Upstream's `monitor.transport.ts::monitorWebhook` already owns the whole
// listener — path matching, method/content-type/rate-limit/body-size guards,
// the HMAC signature check BEFORE any JSON parse, `Lark.generateChallenge` for
// the URL verification handshake, and the 200 that only carries the accepted
// marker after a durable invocation. It is carried whole, including the fact
// that the encrypt key is required in this mode. This module is only the seam:
// it builds the dispatcher, registers the Fusion admission handlers, and passes
// the durable invoker in.
import type { HostChildLogger } from "@getpaseo/channels-shared";
import { createEventDispatcher } from "../client.js";
import { monitorWebhook } from "../monitor.transport.js";
import type { ResolvedFeishuAccount } from "../types.js";
import { createFeishuAdmission, type FeishuAdmissionOptions } from "./admission.js";
import type { FeishuStatusSink } from "./status-sink.js";
import type { RuntimeEnv } from "./runtime-api.js";

export interface FeishuWebhookSessionOptions {
  account: ResolvedFeishuAccount;
  accountId: string;
  admission: FeishuAdmissionOptions;
  abortSignal: AbortSignal;
  runtime?: RuntimeEnv;
  statusSink?: FeishuStatusSink;
  logger?: HostChildLogger;
  /** Test seam: an already-built dispatcher (the ported one needs SDK creds). */
  createEventDispatcherImpl?: typeof createEventDispatcher;
}

/** Runs until `abortSignal` fires. */
export async function startFeishuWebhookSession(
  options: FeishuWebhookSessionOptions,
): Promise<void> {
  const dispatcher = (options.createEventDispatcherImpl ?? createEventDispatcher)(options.account);
  const admission = createFeishuAdmission(dispatcher, options.admission);
  options.logger?.info?.("feishu webhook session starting", {
    accountId: options.accountId,
    webhookPath: options.account.config.webhookPath,
  });
  await monitorWebhook({
    account: options.account,
    accountId: options.accountId,
    eventDispatcher: dispatcher,
    invokeWebhookEvent: admission.invokeWebhookEvent,
    abortSignal: options.abortSignal,
    ...(options.runtime === undefined ? {} : { runtime: options.runtime }),
    ...(options.statusSink === undefined ? {} : { statusSink: options.statusSink }),
  });
}

/** The connection mode the account is configured for. Upstream's default is
 * the long connection, which is also the only mode that needs no public URL. */
export function resolveFeishuConnectionMode(account: {
  config: { connectionMode?: unknown };
}): "websocket" | "webhook" {
  return account.config.connectionMode === "webhook" ? "webhook" : "websocket";
}
