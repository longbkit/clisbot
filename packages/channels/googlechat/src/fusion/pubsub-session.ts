// Fusion-owned Pub/Sub receive mode (D-GC-020).
//
// The alternative to the webhook for a Host with no public HTTPS address: the
// Chat app publishes its interaction events to a Cloud Pub/Sub topic and this
// loop pulls them from the operator's subscription — the Poll family of the
// durable-admission table (docs/features/channels/README.md), with Pub/Sub's
// ack standing in for the watermark:
//
//   * a message is ACKED only after `admission.receive` returned, i.e. after the
//     event is durably in the Hub ingress queue (or is a well-formed non-turn
//     event, or a payload no retry can fix);
//   * an admission that THROWS releases the message (ack deadline 0) so Pub/Sub
//     redelivers it, and the loop backs off before the next pull.
//
// No request authentication runs here. On the webhook path the bearer JWT is
// what proves Google sent the request; here the pull itself is authenticated
// with the account's own service account, and only the Chat service account
// (`chat-api-push@system.gserviceaccount.com`) is granted publish on the topic.
//
// Pub/Sub delivers at least once. A redelivery after a lost ack is caught by the
// shared inbound processor's message-id dedupe, the same as a webhook retry.

import { formatErrorMessage } from "@clisbot/channels-core/plugin-sdk/error-runtime";
import type { HostChildLogger } from "@clisbot/channels-shared";
import type { GoogleChatWebhookAdmission } from "./admission.js";
import type { GoogleChatPubSubClient, PubSubReceivedMessage } from "./pubsub-api.js";

const MAX_BACKOFF_MS = 30_000;

export interface GoogleChatPubSubSessionOptions {
  client: GoogleChatPubSubClient;
  admission: GoogleChatWebhookAdmission;
  subscription: string;
  abortSignal: AbortSignal;
  logger?: HostChildLogger;
  setStatus?: (patch: Record<string, unknown>) => void;
  /** Test seam: how the loop waits between failed attempts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

interface Settlement {
  ack: string[];
  release: string[];
}

/** Runs until `abortSignal` fires. */
export async function startGoogleChatPubSubSession(
  options: GoogleChatPubSubSessionOptions,
): Promise<void> {
  const { client, abortSignal, logger } = options;
  const sleep = options.sleep ?? abortableSleep;
  const status = (connected: boolean, extra: Record<string, unknown> = {}) =>
    options.setStatus?.({ mode: "pubsub", connected, subscription: options.subscription, ...extra });
  let failures = 0;
  status(true, { lastConnectedAt: Date.now() });
  try {
    while (!abortSignal.aborted) {
      let messages: PubSubReceivedMessage[];
      try {
        messages = await client.pull(abortSignal);
      } catch (error) {
        if (abortSignal.aborted) break;
        failures += 1;
        const lastError = formatErrorMessage(error);
        logger?.warn("googlechat pubsub pull failed", { failures, error: lastError });
        status(false, { lastError });
        await sleep(backoffMs(failures), abortSignal);
        continue;
      }
      if (failures > 0) status(true, { lastConnectedAt: Date.now() });
      failures = 0;
      const settlement = await admitAll(messages, options.admission, logger);
      await settle(client, settlement, logger);
      // A store that refused admission is likely to refuse the redelivery too.
      if (settlement.release.length > 0) await sleep(backoffMs(1), abortSignal);
    }
  } finally {
    status(false);
  }
}

async function admitAll(
  messages: readonly PubSubReceivedMessage[],
  admission: GoogleChatWebhookAdmission,
  logger: HostChildLogger | undefined,
): Promise<Settlement> {
  const settlement: Settlement = { ack: [], release: [] };
  for (const message of messages) {
    const admitted = await admitOne(message, admission, logger);
    settlement[admitted ? "ack" : "release"].push(message.ackId);
  }
  return settlement;
}

/** True when the message may be acked: admitted, or never admittable. */
async function admitOne(
  message: PubSubReceivedMessage,
  admission: GoogleChatWebhookAdmission,
  logger: HostChildLogger | undefined,
): Promise<boolean> {
  const envelope = decodeEnvelope(message.data);
  if (envelope === undefined) {
    logger?.warn("googlechat pubsub message is not a Chat event; dropped", {
      messageId: message.messageId,
    });
    return true;
  }
  try {
    const result = await admission.receive(envelope);
    if (result.kind === "invalid") {
      logger?.warn("googlechat pubsub event refused", {
        messageId: message.messageId,
        reason: result.reason,
      });
    }
    return true;
  } catch (error) {
    logger?.warn("googlechat pubsub admission failed; released for redelivery", {
      messageId: message.messageId,
      error: formatErrorMessage(error),
    });
    return false;
  }
}

function decodeEnvelope(data: string | undefined): unknown {
  if (data === undefined || data === "") return undefined;
  try {
    return JSON.parse(Buffer.from(data, "base64").toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
}

/** A failed settle is not fatal: an unacked message comes back after its ack
 * deadline and the processor's dedupe absorbs it. */
async function settle(
  client: GoogleChatPubSubClient,
  settlement: Settlement,
  logger: HostChildLogger | undefined,
): Promise<void> {
  await client.acknowledge(settlement.ack).catch((error: unknown) => {
    logger?.warn("googlechat pubsub acknowledge failed", { error: formatErrorMessage(error) });
  });
  await client.release(settlement.release).catch((error: unknown) => {
    logger?.warn("googlechat pubsub release failed", { error: formatErrorMessage(error) });
  });
}

function backoffMs(failures: number): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, failures - 1));
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
