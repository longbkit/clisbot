// Fusion-owned Cloud Pub/Sub REST client for the `pubsub` receive mode (D-GC-020).
//
// Upstream has no Pub/Sub delivery: its Chat app is an HTTP endpoint only. A
// Chat app configured with a Cloud Pub/Sub connection publishes every
// interaction event to a topic; this module pulls them off the operator's
// subscription and settles them. Three calls, no SDK: `@google-cloud/pubsub`
// is a gRPC client with its own streaming lease manager, and the receive loop
// needs a pull and an ack.
//
// The access token is minted from the same validated service-account document
// the Chat client uses, under the Pub/Sub scope. The ported `auth.ts` caches
// one `GoogleAuth` per account for the Chat scope only, so this keeps its own.

import { formatErrorMessage } from "@clisbot/channels-core/plugin-sdk/error-runtime";
import type { ResolvedGoogleChatAccount } from "../accounts.js";
import {
  getGoogleAuthTransport,
  loadGoogleAuthRuntime,
  resolveValidatedGoogleChatCredentials,
} from "../google-auth.runtime.js";
import { buildHostnameAllowlistPolicyFromSuffixAllowlist, fetchWithSsrFGuard } from "./ssrf-fetch.js";

const PUBSUB_API_BASE = "https://pubsub.googleapis.com/v1";
const PUBSUB_SCOPE = "https://www.googleapis.com/auth/pubsub";
const PUBSUB_POLICY = buildHostnameAllowlistPolicyFromSuffixAllowlist(["googleapis.com"]);
/** A pull is a long poll: Pub/Sub holds it open until messages arrive or its
 * own deadline passes, so the client deadline sits above that. */
const PULL_TIMEOUT_MS = 120_000;
const SETTLE_TIMEOUT_MS = 30_000;
/** `projects/<project>/subscriptions/<name>`, the only form the REST path takes. */
const SUBSCRIPTION_NAME = /^projects\/[^/\s]+\/subscriptions\/[^/\s]+$/u;

export class GoogleChatPubSubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GoogleChatPubSubError";
  }
}

export interface PubSubReceivedMessage {
  ackId: string;
  /** The Chat event JSON, base64-encoded. */
  data: string | undefined;
  messageId: string | undefined;
}

export interface GoogleChatPubSubClient {
  pull(signal: AbortSignal): Promise<PubSubReceivedMessage[]>;
  acknowledge(ackIds: readonly string[]): Promise<void>;
  /** Returns messages for redelivery now, without waiting out the ack deadline. */
  release(ackIds: readonly string[]): Promise<void>;
}

export function isPubSubSubscriptionName(value: string): boolean {
  return SUBSCRIPTION_NAME.test(value);
}

export function createGoogleChatPubSubClient(
  account: ResolvedGoogleChatAccount,
  subscription: string,
): GoogleChatPubSubClient {
  if (!isPubSubSubscriptionName(subscription)) {
    throw new Error(
      `googlechat subscription must be projects/<project>/subscriptions/<name>, got ${subscription}`,
    );
  }
  const accessToken = pubSubTokenSource(account);
  const call = async (
    verb: string,
    body: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> =>
    await postPubSub({ subscription, verb, body, token: await accessToken(), timeoutMs, signal });
  return {
    async pull(signal) {
      const body = await call("pull", { maxMessages: 10 }, PULL_TIMEOUT_MS, signal);
      return readReceivedMessages(body);
    },
    async acknowledge(ackIds) {
      if (ackIds.length === 0) return;
      await call("acknowledge", { ackIds }, SETTLE_TIMEOUT_MS);
    },
    async release(ackIds) {
      if (ackIds.length === 0) return;
      await call("modifyAckDeadline", { ackIds, ackDeadlineSeconds: 0 }, SETTLE_TIMEOUT_MS);
    },
  };
}

async function postPubSub(params: {
  subscription: string;
  verb: string;
  body: Record<string, unknown>;
  token: string;
  timeoutMs: number;
  signal: AbortSignal | undefined;
}): Promise<unknown> {
  const { verb, signal } = params;
  const { response, release } = await fetchWithSsrFGuard({
    url: `${PUBSUB_API_BASE}/${params.subscription}:${verb}`,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${params.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(params.body),
    },
    auditContext: `googlechat.pubsub.${verb}`,
    timeoutMs: params.timeoutMs,
    policy: PUBSUB_POLICY,
    ...(signal === undefined ? {} : { signal }),
  });
  try {
    const text = await response.text();
    if (!response.ok) {
      throw new GoogleChatPubSubError(
        response.status,
        `Pub/Sub ${verb} ${response.status}: ${pubSubErrorMessage(text) ?? response.statusText}`,
      );
    }
    return text === "" ? {} : (JSON.parse(text) as unknown);
  } finally {
    await release();
  }
}

function pubSubTokenSource(account: ResolvedGoogleChatAccount): () => Promise<string> {
  let client: Promise<{ getAccessToken(): Promise<unknown> }> | null = null;
  const load = async () => {
    const [{ GoogleAuth }, transporter, credentials] = await Promise.all([
      loadGoogleAuthRuntime(),
      getGoogleAuthTransport(),
      resolveValidatedGoogleChatCredentials(account),
    ]);
    const auth = new GoogleAuth({
      ...(credentials ? { credentials } : {}),
      clientOptions: { transporter },
      scopes: [PUBSUB_SCOPE],
    });
    return await auth.getClient();
  };
  return async () => {
    client ??= load().catch((error: unknown) => {
      client = null;
      throw error;
    });
    const access = await (await client).getAccessToken();
    const token =
      typeof access === "string" ? access : (access as { token?: string | null } | null)?.token;
    if (typeof token !== "string" || token === "") {
      throw new Error("Missing Pub/Sub access token");
    }
    return token;
  };
}

function readReceivedMessages(body: unknown): PubSubReceivedMessage[] {
  const received = (body as { receivedMessages?: unknown } | null)?.receivedMessages;
  if (!Array.isArray(received)) return [];
  return received.flatMap((entry): PubSubReceivedMessage[] => {
    const ackId = (entry as { ackId?: unknown } | null)?.ackId;
    if (typeof ackId !== "string" || ackId === "") return [];
    const message = (entry as { message?: { data?: unknown; messageId?: unknown } }).message;
    return [
      {
        ackId,
        data: typeof message?.data === "string" ? message.data : undefined,
        messageId: typeof message?.messageId === "string" ? message.messageId : undefined,
      },
    ];
  });
}

function pubSubErrorMessage(text: string): string | undefined {
  try {
    const message = (JSON.parse(text) as { error?: { message?: unknown } }).error?.message;
    return typeof message === "string" ? message : undefined;
  } catch {
    return text === "" ? undefined : formatErrorMessage(text).slice(0, 500);
  }
}
