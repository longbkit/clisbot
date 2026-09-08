// Fusion-owned host adapter for `src/infra/outbound/message.ts` (D-CORE-032).
//
// `message.ts` is OpenClaw's core durable sender: it resolves the channel plugin,
// plans payloads, drives the delivery queue, mirrors the transcript and returns
// platform receipts. Every one of those responsibilities belongs to the Hub in
// Fusion (`ChannelStore` delivery ledger + the supervisor's outbound seam), so
// the port keeps the *contract* — the result shapes below are copied from
// upstream — and lets the host install the implementation.
//
// Without an installed sender the core send path fails loudly: a silent no-op
// would look like a delivered message to the agent.
import { AsyncLocalStorage } from "node:async_hooks";
import type { OutboundDeliveryResult } from "./deliver-types.js";
import type { NormalizedOutboundPayload } from "./deliver.host-adapter.js";

export type MessageSendResult = {
  channel: string;
  to: string;
  via: "direct" | "gateway";
  mediaUrl: string | null;
  mediaUrls?: string[];
  result?: OutboundDeliveryResult | { messageId: string };
  deliveryStatus?: "sent" | "suppressed" | "partial_failed" | "failed";
  suppressionReason?: string;
  /** Formatted send error when deliveryStatus is "failed" or "partial_failed". */
  error?: string;
  sentBeforeError?: boolean;
  payloadOutcomes?: unknown[];
  dryRun?: boolean;
};

export type MessagePollResult = {
  channel: string;
  to: string;
  question: string;
  options: string[];
  maxSelections: number;
  durationSeconds: number | null;
  durationHours: number | null;
  via: "direct" | "gateway";
  result?: Pick<OutboundDeliveryResult, "messageId" | "target" | "toJid" | "pollId" | "receipt">;
  dryRun?: boolean;
};

/**
 * Upstream's `MessageSendParams`, kept open so ported callers pass it unchanged.
 * The delivery callbacks are declared so their parameters keep contextual types
 * at the call sites in `outbound-send-service.ts`.
 */
export type MessageSendParams = {
  to: string;
  content: string;
  channel?: string;
  accountId?: string;
  threadId?: string | number;
  dryRun?: boolean;
  idempotencyKey?: string;
  abortSignal?: AbortSignal;
  /** Runs on identified platform evidence before queue acknowledgement. */
  onDeliveryResult?: (result: OutboundDeliveryResult) => Promise<void> | void;
  /** Reports the effective payload only after an identified direct send. */
  onDeliveredPayload?: (payload: NormalizedOutboundPayload) => void;
  [key: string]: unknown;
};

export type MessagePollParams = {
  to: string;
  question: string;
  options: string[];
  channel?: string;
  accountId?: string;
  threadId?: string;
  dryRun?: boolean;
  [key: string]: unknown;
};

export type CoreOutboundSender = {
  sendMessage: (params: MessageSendParams) => Promise<MessageSendResult>;
  sendPoll: (params: MessagePollParams) => Promise<MessagePollResult>;
};

let installed: CoreOutboundSender | undefined;

/**
 * The sender for the call currently in flight. A host that serves more than one
 * tenant runs concurrent sends: two overlapping calls each need their own
 * conversation-bound sender, and a process-global slot would let the later call
 * post through the earlier call's seam. `AsyncLocalStorage` gives each call its
 * own, and the calls no longer uninstall each other on the way out.
 */
const callSender = new AsyncLocalStorage<CoreOutboundSender>();

/**
 * Installs a process-global sender. Single-tenant hosts and tests that never run
 * two sends at once can use this; concurrent callers must use
 * `runWithCoreOutboundSender`, which takes precedence.
 */
export function setCoreOutboundSender(sender: CoreOutboundSender | undefined): void {
  installed = sender;
}

/** Runs `run` with `sender` as the durable sender for that call and everything it awaits. */
export function runWithCoreOutboundSender<T>(sender: CoreOutboundSender, run: () => T): T {
  return callSender.run(sender, run);
}

function requireSender(): CoreOutboundSender {
  const sender = callSender.getStore() ?? installed;
  if (!sender) {
    throw new Error(
      "No core outbound sender is installed; the host must call setCoreOutboundSender before core delivery.",
    );
  }
  return sender;
}

export async function sendMessage(params: MessageSendParams): Promise<MessageSendResult> {
  return await requireSender().sendMessage(params);
}

export async function sendPoll(params: MessagePollParams): Promise<MessagePollResult> {
  return await requireSender().sendPoll(params);
}
