// Fusion-owned host adapter for `src/channels/message/send.ts#sendDurableMessageBatchCore`
// and `src/infra/outbound/session-context.ts#buildOutboundSessionContext` (D-CORE-260).
//
// Upstream's durable batch is the delivery engine: it renders a batch, drives the
// outbound queue, records live-preview state, mirrors the transcript and classifies
// suppression. Fusion's Hub owns durable delivery (goal slices 1-3, 8), so the port
// keeps the *contract* — upstream's `DurableMessageBatchSendResult` union, verbatim
// below — and routes each payload through the installed core outbound sender
// (`./message.host-adapter.ts`). Without an installed sender the call fails loudly.
//
// `buildOutboundSessionContext` keeps upstream's `OutboundSessionContext` shape and
// its "omit every empty field, return undefined when nothing is left" contract. The
// upstream body additionally resolves an OpenClaw session-key delivery route and the
// session's agent id; both are host-adapter stubs in this port (the Hub resolves the
// route and the agent before a send reaches a vertical), so the derivation here is
// only over the caller-declared facts.
import { normalizeChatType } from "../../channels/chat-type.js";
import { createMessageReceiptFromOutboundResults } from "../../channels/message/receipt.js";
import type { MessageReceipt } from "../../channels/message/types.js";
import { normalizeOptionalString } from "../../normalization-core/string-coerce.js";
import type { OutboundDeliveryResult } from "./deliver-types.js";
import { sendMessage, type MessageSendResult } from "./message.host-adapter.js";

/** Upstream's `SilentReplyConversationType`, from `src/shared/silent-reply-policy.ts`. */
type SilentReplyConversationType = "direct" | "group" | "internal";

/** Upstream's `OutboundSessionContext` (`src/infra/outbound/session-context.ts`). */
export type OutboundSessionContext = {
  /** Canonical session key used for internal hook dispatch. */
  key?: string;
  /** Session key used for policy resolution when delivery differs from the control session. */
  policyKey?: string;
  /** Explicit conversation type for policy resolution when a session key is generic. */
  conversationType?: SilentReplyConversationType;
  /** Caller-declared destination conversation kind for metadata-only audit projection. */
  conversationKind?: "direct" | "group" | "channel";
  /** Active agent id used for workspace-scoped media roots. */
  agentId?: string;
  /** Originating account id used for requester-scoped group policy resolution. */
  requesterAccountId?: string;
  /** Originating sender id used for sender-scoped outbound media policy. */
  requesterSenderId?: string;
  /** Originating sender display name for name-keyed sender policy matching. */
  requesterSenderName?: string;
  /** Originating sender username for username-keyed sender policy matching. */
  requesterSenderUsername?: string;
  /** Originating sender E.164 phone number for e164-keyed sender policy matching. */
  requesterSenderE164?: string;
};

/**
 * The agent id an agent-scoped session key names.
 *
 * Upstream reaches this through `resolveSessionAgentId`, which also consults the
 * configured agent list and the persisted store owner; both are host-owned in
 * Fusion and their adapters answer "unknown". The key parse is the part that is
 * a fact about the key itself, so it is kept: a caller that passes an
 * `agent:<id>:…` session key still gets the workspace-scoped media roots
 * upstream would give it.
 */
function readSessionKeyAgentId(sessionKey: string | undefined): string | undefined {
  const parts = sessionKey?.toLowerCase().split(":");
  return parts?.[0] === "agent" && parts[1] ? parts[1] : undefined;
}

/** Builds the outbound delivery session context, omitting empty policy fields. */
export function buildOutboundSessionContext(params: {
  cfg: unknown;
  sessionKey?: string | null;
  policySessionKey?: string | null;
  conversationType?: string | null;
  isGroup?: boolean | null;
  agentId?: string | null;
  requesterAccountId?: string | null;
  requesterSenderId?: string | null;
  requesterSenderName?: string | null;
  requesterSenderUsername?: string | null;
  requesterSenderE164?: string | null;
}): OutboundSessionContext | undefined {
  const key = normalizeOptionalString(params.sessionKey);
  const policyKey = normalizeOptionalString(params.policySessionKey);
  const declaredChatType = normalizeChatType(params.conversationType ?? undefined);
  // conversationKind feeds the metadata-only audit projection and must carry
  // only caller-declared destination facts; a guessed "direct" would over-collect.
  const conversationKind =
    declaredChatType ??
    (params.isGroup === true ? "group" : params.isGroup === false ? "direct" : undefined);
  // conversationType keeps upstream's policy derivation (declared type, then
  // isGroup) and intentionally folds channels into groups for silent-reply policy.
  const conversationType: SilentReplyConversationType | undefined =
    declaredChatType === "group" || declaredChatType === "channel"
      ? "group"
      : declaredChatType === "direct"
        ? "direct"
        : params.isGroup === true
          ? "group"
          : params.isGroup === false
            ? "direct"
            : undefined;
  const agentId = normalizeOptionalString(params.agentId) ?? readSessionKeyAgentId(key);
  const requesterAccountId = normalizeOptionalString(params.requesterAccountId);
  const requesterSenderId = normalizeOptionalString(params.requesterSenderId);
  const requesterSenderName = normalizeOptionalString(params.requesterSenderName);
  const requesterSenderUsername = normalizeOptionalString(params.requesterSenderUsername);
  const requesterSenderE164 = normalizeOptionalString(params.requesterSenderE164);
  if (
    !key &&
    !policyKey &&
    !conversationType &&
    !conversationKind &&
    !agentId &&
    !requesterAccountId &&
    !requesterSenderId &&
    !requesterSenderName &&
    !requesterSenderUsername &&
    !requesterSenderE164
  ) {
    return undefined;
  }
  return {
    ...(key ? { key } : {}),
    ...(policyKey ? { policyKey } : {}),
    ...(conversationType ? { conversationType } : {}),
    ...(conversationKind ? { conversationKind } : {}),
    ...(agentId ? { agentId } : {}),
    ...(requesterAccountId ? { requesterAccountId } : {}),
    ...(requesterSenderId ? { requesterSenderId } : {}),
    ...(requesterSenderName ? { requesterSenderName } : {}),
    ...(requesterSenderUsername ? { requesterSenderUsername } : {}),
    ...(requesterSenderE164 ? { requesterSenderE164 } : {}),
  };
}

/** Upstream's `DurableMessageSendContextParams`, kept open so ported callers pass it unchanged. */
export type DurableMessageBatchSendParams = {
  to: string;
  channel?: string;
  accountId?: string;
  payloads: ReadonlyArray<Record<string, unknown>>;
  replyToId?: string;
  threadId?: string | number | null;
  idempotencyKey?: string;
  session?: OutboundSessionContext;
  [key: string]: unknown;
};

type DurableMessageSuppressionReason = string;
type DurableMessageFailureStage = "platform_send" | "queue" | "unknown";

/** Upstream's result union (`src/channels/message/send.ts`), narrowed to the carried statuses. */
export type DurableMessageBatchSendResult =
  | {
      status: "sent";
      results: OutboundDeliveryResult[];
      receipt: MessageReceipt;
    }
  | {
      status: "suppressed";
      results: [];
      receipt: MessageReceipt;
      reason: DurableMessageSuppressionReason;
    }
  | {
      status: "partial_failed";
      results: OutboundDeliveryResult[];
      receipt: MessageReceipt;
      error: unknown;
      sentBeforeError: true;
    }
  | {
      status: "failed";
      error: unknown;
      stage?: DurableMessageFailureStage;
    };

function readPayloadText(payload: Record<string, unknown>): string {
  const text = payload.text;
  return typeof text === "string" ? text : "";
}

/** Maps one host send result onto upstream's `OutboundDeliveryResult`. */
function toDeliveryResult(
  channel: string,
  to: string,
  result: MessageSendResult,
): OutboundDeliveryResult {
  const messageId =
    result.result && "messageId" in result.result && typeof result.result.messageId === "string"
      ? result.result.messageId
      : "";
  return {
    channel,
    messageId,
    target: { kind: "chat", id: to },
  };
}

/**
 * Sends one durable batch through the installed core outbound sender.
 *
 * One host send per payload, in order. The first failure stops the batch: earlier
 * payloads already reached the platform, so the outcome is `partial_failed` rather
 * than `failed`, matching upstream's retry contract.
 */
export async function sendDurableMessageBatch(
  params: DurableMessageBatchSendParams,
): Promise<DurableMessageBatchSendResult> {
  const channel = params.channel ?? "";
  const results: OutboundDeliveryResult[] = [];
  const threadId = params.threadId ?? undefined;
  for (const payload of params.payloads) {
    let sent: MessageSendResult;
    try {
      const { threadId: _threadId, ...rest } = params;
      sent = await sendMessage({
        ...rest,
        to: params.to,
        content: readPayloadText(payload),
        payload,
        ...(channel ? { channel } : {}),
        ...(params.accountId === undefined ? {} : { accountId: params.accountId }),
        ...(threadId === undefined || threadId === null ? {} : { threadId }),
      });
    } catch (error) {
      return results.length > 0
        ? {
            status: "partial_failed",
            results,
            receipt: buildReceipt(results, params),
            error,
            sentBeforeError: true,
          }
        : { status: "failed", error, stage: "platform_send" };
    }
    if (sent.deliveryStatus === "suppressed") {
      return {
        status: "suppressed",
        results: [],
        receipt: buildReceipt([], params),
        reason: sent.suppressionReason ?? "suppressed",
      };
    }
    if (sent.deliveryStatus === "failed" || sent.deliveryStatus === "partial_failed") {
      const error = new Error(sent.error ?? "the channel send failed");
      return results.length > 0 || sent.sentBeforeError === true
        ? {
            status: "partial_failed",
            results,
            receipt: buildReceipt(results, params),
            error,
            sentBeforeError: true,
          }
        : { status: "failed", error, stage: "platform_send" };
    }
    results.push(toDeliveryResult(channel, params.to, sent));
  }
  return { status: "sent", results, receipt: buildReceipt(results, params) };
}

function buildReceipt(
  results: readonly OutboundDeliveryResult[],
  params: DurableMessageBatchSendParams,
): MessageReceipt {
  const threadId = params.threadId == null ? undefined : String(params.threadId);
  return createMessageReceiptFromOutboundResults({
    results,
    ...(threadId ? { threadId } : {}),
    ...(params.replyToId ? { replyToId: params.replyToId } : {}),
  });
}
