// Fusion-owned long-connection receive mode (D-FS-016).
//
// Lark's long connection is the SDK's `WSClient`: the app dials
// `open.feishu.cn` (or `open.larksuite.com`) outbound and events arrive over
// that socket, so no public URL is needed. Upstream's `monitor.transport.ts`
// already owns the whole loop — client construction, the reconnect ladder with
// its terminal-error classification, the cleanup on abort and the status
// patches — and it is carried whole. This module is only the seam: it builds
// the account's `Lark.EventDispatcher`, registers the Fusion admission handlers
// on it, and runs `monitorWebSocket` until `abortSignal` fires.
//
// A WS event is admitted through the same path a webhook event is: the
// dispatcher handler awaits durable admission before it returns, so the SDK's
// ack follows admission, never precedes it.
import type { HostChildLogger } from "@getpaseo/channels-shared";
import { createEventDispatcher } from "../client.js";
import { monitorWebSocket } from "../monitor.transport.js";
import type { ResolvedFeishuAccount } from "../types.js";
import { createFeishuAdmission, type FeishuAdmissionOptions } from "./admission.js";
import type { FeishuStatusSink } from "./status-sink.js";
import type { RuntimeEnv } from "./runtime-api.js";

export interface FeishuWsSessionOptions {
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
export async function startFeishuWsSession(options: FeishuWsSessionOptions): Promise<void> {
  const dispatcher = (options.createEventDispatcherImpl ?? createEventDispatcher)(options.account);
  createFeishuAdmission(dispatcher, options.admission);
  options.logger?.info?.("feishu websocket session starting", { accountId: options.accountId });
  await monitorWebSocket({
    account: options.account,
    accountId: options.accountId,
    eventDispatcher: dispatcher,
    abortSignal: options.abortSignal,
    ...(options.runtime === undefined ? {} : { runtime: options.runtime }),
    ...(options.statusSink === undefined ? {} : { statusSink: options.statusSink }),
  });
}
