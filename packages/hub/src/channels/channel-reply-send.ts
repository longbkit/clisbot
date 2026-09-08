// The `message` tool's `send` action: the Hub's delivery half (slice 11b of
// docs/audits/2026-09-07-openclaw-channel-port-goal.md).
//
// `send` used to post straight through the Hub outbound seam, which meant the
// upstream send params — `media`, `attachments[]`, `buffer`, `caption`,
// `asVoice`, `presentation` — were advertised in the schema and then dropped.
// It now runs on the same ported runner every other action uses
// (`message-actions.ts` -> core's `executeMessageSend`), with two Hub-owned
// seams plugged into it: the delivery ledger as core's durable sender, and the
// capability's Project-scoped media stager as core's media store.
//
// One `send` can become several platform messages (the reply text, then one per
// attachment). They share one `eventTurnId` and one output-budget attempt; each
// gets its own ledger row, numbered by `sequence`.

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { accountScope, type ChannelReplyCapability } from "./channel-reply-capabilities.js";
import type { ChannelReplyMcp } from "./channel-reply.js";
import { errorText, toolFailure, toolSuccess } from "./channel-reply-results.js";
import { isMediaChannel } from "./channel-message-tool.js";
import {
  ChannelMediaRefusedError,
  createChannelMediaStager,
  type ChannelMediaStager,
  type StagedChannelMedia,
} from "./media/outbound-stager.js";
import {
  runChannelMessageAction,
  type ChannelDeliveryFact,
  type ChannelMessageActionOutcome,
  type HubOutboundSendParams,
  type HubOutboundSendResult,
} from "./message-actions.js";
import { mintPresentationCommandButtons } from "./command-buttons.js";
import {
  admitMessagePresentation,
  type MessagePresentation,
  type MessagePresentationBlockNote,
} from "@getpaseo/channels-core/plugin-sdk/interactive-runtime";
import type { ChannelReplyBindingRef } from "./plane/types.js";

/** One reserved output-budget attempt. Reserving returns `undefined` when the
 * execution's channel-reply budget is spent. */
export interface ChannelReplyOutputAttempt {
  complete(): Promise<void>;
  fail(): Promise<void>;
}

export type ReserveChannelReplyOutput = () => Promise<ChannelReplyOutputAttempt | undefined>;

export interface ChannelSendCall {
  mcp: ChannelReplyMcp;
  capability: ChannelReplyCapability;
  args: Record<string, unknown>;
  reserveOutput: ReserveChannelReplyOutput;
}

/** Validates, reserves, and runs one `send`. */
export async function executeChannelSend(call: ChannelSendCall): Promise<CallToolResult> {
  const invalid = validateSendArgs(call.args);
  if (invalid !== undefined) return invalid;
  const attempt = await call.reserveOutput();
  if (attempt === undefined) return toolFailure("Channel reply output limit reached");
  // Record-before-post: the ledger row lands before the channel post.
  const eventTurnId = deliveryKey(call.capability, readIdempotencyKey(call.args));
  const ledger = createSendLedger(call.mcp, call.capability.ref, eventTurnId);
  const anchor = await ledger.reserve();
  if (anchor.decision !== "post") {
    return await finishReservedDelivery(call, attempt, { ...anchor, eventTurnId });
  }
  return await runSend(call, attempt, eventTurnId, ledger);
}

/** Refuses a malformed send payload before anything is recorded. */
function validateSendArgs(args: Record<string, unknown>): CallToolResult | undefined {
  const text = readSendText(args, hasSendMedia(args));
  if (text !== undefined && typeof text !== "string") return text;
  const idempotencyKey = args["idempotencyKey"];
  if (idempotencyKey === undefined) return undefined;
  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.trim() === "" ||
    idempotencyKey.length > 256
  ) {
    return toolFailure("`idempotencyKey` must be a non-empty string of at most 256 characters");
  }
  return undefined;
}

function readIdempotencyKey(args: Record<string, unknown>): string | undefined {
  const value = args["idempotencyKey"];
  return typeof value === "string" ? value : undefined;
}

/** True when the send carries a file in any of the upstream media params. */
function hasSendMedia(args: Record<string, unknown>): boolean {
  const attachments = args["attachments"];
  return (
    isNonEmptyString(args["media"]) ||
    isNonEmptyString(args["buffer"]) ||
    (Array.isArray(attachments) && attachments.length > 0)
  );
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/** Canonical `message` with Paseo's `text` alias; both present must agree. A
 * send that carries a file needs no body — the file is the message. */
function readSendText(
  args: Record<string, unknown>,
  hasMedia: boolean,
): string | undefined | CallToolResult {
  const textArg = args["text"];
  const messageArg = args["message"];
  if (textArg !== undefined && (typeof textArg !== "string" || textArg.trim() === "")) {
    return toolFailure("`text` must be a non-empty string when provided");
  }
  if (messageArg !== undefined && (typeof messageArg !== "string" || messageArg.trim() === "")) {
    return toolFailure("`message` must be a non-empty string when provided");
  }
  if (typeof textArg === "string" && typeof messageArg === "string" && textArg !== messageArg) {
    return toolFailure("`message` and `text` must contain the same text when both are provided");
  }
  if (typeof messageArg === "string") return messageArg;
  if (typeof textArg === "string") return textArg;
  return hasMedia ? undefined : toolFailure("`message` or `text` must be a non-empty string");
}

/**
 * The delivery-ledger key for one `send`.
 *
 * `idempotencyKey` comes from the model and is only meaningful inside the turn
 * that produced it — "reply-1" recurs every turn — so it is namespaced by the
 * capability's TURN: the plane's per-inbound id on the channel path
 * (`turnId`, restamped by `noteTurn`), the durable execution on the automation
 * path. Without that namespace the second turn in a thread read the first
 * turn's posted row and answered "already posted" while posting nothing.
 *
 * A capability with neither — one restored after a Hub restart, before its
 * next inbound — falls back to its Agent and then to a per-request UUID, which
 * costs replay protection rather than the message.
 *
 * With no key at all every call is its own delivery: the agent drives retries,
 * and a fresh UUID keeps each one a real post.
 */
function deliveryKey(
  capability: ChannelReplyCapability,
  idempotencyKey: string | undefined,
): string {
  if (idempotencyKey === undefined) return `channel-reply:${randomUUID()}`;
  const turn =
    capability.turnId ?? capability.outputBudget?.executionId ?? capability.agentId ?? randomUUID();
  return `channel-reply:${turn}:${idempotencyKey}`;
}

/**
 * The `send` action on the production path.
 *
 * Upstream's runner owns everything between the tool arguments and the platform
 * post: alias normalization, the media list, the reply/thread resolution and the
 * presentation fallback. The Hub owns delivery, so the runner's durable sender is
 * `ledger.post` — one recorded, confirmed row per platform message — and its
 * media stager is the capability's Project-scoped one.
 */
async function runSend(
  call: ChannelSendCall,
  attempt: ChannelReplyOutputAttempt,
  eventTurnId: string,
  ledger: SendLedger,
): Promise<CallToolResult> {
  const { mcp, capability } = call;
  const ref = capability.ref;
  const seam = ambiguityAwarePost(mcp, ref);
  // Admission before the runner: core's normalizer drops a table the model
  // wrote without a caption, and everything downstream would then be reporting
  // a message that never carried it (D-W6-02).
  const admission = admitMessagePresentation(call.args["presentation"]);
  let outcome: ChannelMessageActionOutcome;
  try {
    outcome = await runChannelMessageAction({
      ...accountScope(capability),
      action: "send",
      params: issuedSendParams(call, eventTurnId, admission.presentation),
      conversation: {
        to: ref.externalConversationId,
        ...(ref.externalThreadId === null ? {} : { threadId: ref.externalThreadId }),
      },
      send: async (params) => await ledger.post(async () => await seam.post(params)),
      stageMedia: sendFileStager(capability),
      ...(capability.requesterSenderId === undefined
        ? {}
        : { requesterSenderId: capability.requesterSenderId }),
      ...(capability.outputBudget === undefined
        ? {}
        : { sessionId: capability.outputBudget.executionId }),
    });
  } catch (error) {
    await settleFailedSend(ledger, attempt, seam, errorText(error));
    return toolFailure(`message post failed: ${errorText(error)}`);
  }
  const structuredContent = sendStructuredContent(
    ref,
    { args: call.args, eventTurnId },
    outcome,
    admission.notes,
  );
  if (!outcome.ok) {
    const reason = outcome.error ?? "the channel post failed";
    await settleFailedSend(ledger, attempt, seam, reason);
    return {
      content: [{ type: "text" as const, text: `message post failed: ${reason}` }],
      structuredContent,
      isError: true,
    };
  }
  await attempt.complete();
  return {
    content: [{ type: "text" as const, text: postedText(admission.notes) }],
    structuredContent,
  };
}

/** The posted message's tool text, naming what admission changed. The model
 * reads this line even when it ignores `structuredContent`, so a block that was
 * repaired or refused is never invisible to the author of the message. */
function postedText(notes: readonly MessagePresentationBlockNote[]): string {
  if (notes.length === 0) return "message posted";
  const detail = notes
    .map((note) => `block ${note.index} (${note.type}) ${note.outcome}: ${note.reason}`)
    .join("; ");
  return `message posted — presentation: ${detail}`;
}

/**
 * The send's params with every command button reissued by the Hub.
 *
 * A `{ type: "command" }` button is a control that runs a session command when
 * a member clicks it. The vertical writes the model's text straight into the
 * platform's callback payload and the inbound adapter hands the same text back
 * as the action id, so an un-minted button is an unauthenticated `/new` or
 * `/stop` for anyone in the conversation. Minting replaces the command with an
 * opaque one-shot token bound to this organization, account, agent, turn,
 * conversation and requester (`command-buttons.ts`); the command text itself
 * never leaves the Hub.
 *
 * A capability with no requester mints nothing: `mintChannelCommandButton`
 * refuses an empty actor list, the send fails, and no button is posted that
 * everyone could click.
 */
function issuedSendParams(
  call: ChannelSendCall,
  eventTurnId: string,
  admitted: MessagePresentation | undefined,
): Record<string, unknown> {
  if (call.args["presentation"] === undefined) return { ...call.args };
  // Nothing survived admission: send the text alone rather than hand the runner
  // blocks it will drop again.
  if (admitted === undefined) {
    const { presentation: _refused, ...rest } = call.args;
    return rest;
  }
  const { capability } = call;
  const ref = capability.ref;
  return {
    ...call.args,
    presentation: mintPresentationCommandButtons(admitted, {
      organizationId: capability.organizationId,
      channel: ref.channel,
      accountId: ref.accountId,
      agentId: capability.agentId ?? "",
      turnId: eventTurnId,
      conversationId: ref.externalConversationId,
      ...(ref.externalThreadId === null ? {} : { threadId: ref.externalThreadId }),
      allowedActorIds:
        capability.requesterSenderId === undefined ? [] : [capability.requesterSenderId],
    }),
  };
}

/**
 * The Hub's post seam, remembering whether it ever threw.
 *
 * A seam that returns `ok: false` reported a decided outcome — the channel
 * refused the message. A seam that THREW did not: the transport died with the
 * request in flight, so the message may have landed. The two settle
 * differently, and only the seam knows which happened.
 */
function ambiguityAwarePost(
  mcp: ChannelReplyMcp,
  ref: ChannelReplyBindingRef,
): { post: (params: HubOutboundSendParams) => Promise<HubOutboundSendResult>; threw: boolean } {
  const seam = {
    threw: false,
    post: async (params: HubOutboundSendParams): Promise<HubOutboundSendResult> => {
      try {
        return params.media === undefined
          ? await mcp.post(
              ref,
              params.text,
              params.presentation === undefined ? undefined : { presentation: params.presentation },
            )
          : await mediaPost(mcp, ref, params.media);
      } catch (error) {
        seam.threw = true;
        throw error;
      }
    },
  };
  return seam;
}

/**
 * Closes out a send that did not deliver.
 *
 * A decided failure fails the open ledger row and releases the output lease, so
 * the same key posts again and the ceiling is not spent on a message nobody
 * received. An ambiguous one — the post seam threw — leaves both standing: the
 * row keeps the key claimed so a retry under it refuses, and the pending lease
 * keeps the execution from spending the ceiling twice on one message that may
 * already be in the conversation.
 */
async function settleFailedSend(
  ledger: SendLedger,
  attempt: ChannelReplyOutputAttempt,
  seam: { threw: boolean },
  reason: string,
): Promise<void> {
  if (seam.threw) return;
  await ledger.failOpenRow(reason);
  await attempt.fail();
}

/** The `send` result the agent reads. Shape is Fusion's delivery contract, not
 * upstream's action projection: it names the fixed conversation the capability
 * is bound to and the ledger key the retry would replay. */
function sendStructuredContent(
  ref: ChannelReplyBindingRef,
  call: { args: Record<string, unknown>; eventTurnId: string },
  outcome: ChannelMessageActionOutcome,
  presentationNotes: readonly MessagePresentationBlockNote[],
): Record<string, unknown> {
  const deliveries = reportableDeliveries(outcome);
  return {
    // What admission repaired or the normalizer refused, per authored block.
    ...(presentationNotes.length === 0 ? {} : { presentationNotes }),
    ok: outcome.ok,
    action: "send",
    channel: ref.channel,
    accountId: ref.accountId,
    to: ref.externalConversationId,
    ...(ref.externalThreadId === null ? {} : { threadId: ref.externalThreadId }),
    ...(outcome.messageId === undefined ? {} : { messageId: outcome.messageId }),
    deliveryId: call.eventTurnId,
    final: call.args["final"] !== false,
    ...(deliveries === undefined ? {} : { deliveries }),
    ...(outcome.sentBeforeError === true ? { sentBeforeError: true } : {}),
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
  };
}

/** Per-message receipts are reported when a send produced more than one platform
 * message, or when a vertical answered with the G11 `mediaPosted` fact. A plain
 * text reply keeps the one-message contract it always had. */
function reportableDeliveries(
  outcome: ChannelMessageActionOutcome,
): ChannelDeliveryFact[] | undefined {
  const deliveries = outcome.deliveries;
  if (deliveries === undefined) return undefined;
  const carriesMediaFact = deliveries.some((entry) => entry.mediaPosted !== undefined);
  return deliveries.length > 1 || carriesMediaFact ? deliveries : undefined;
}

/** Posts one staged file through the account's native upload path. */
async function mediaPost(
  mcp: ChannelReplyMcp,
  ref: ChannelReplyBindingRef,
  file: StagedChannelMedia,
): Promise<HubOutboundSendResult> {
  if (mcp.mediaPost === undefined) {
    return { ok: false, error: "this channel does not support file sending" };
  }
  const result = await mcp.mediaPost(ref, file);
  return {
    ok: result.ok,
    ...(result.externalMessageId === undefined
      ? {}
      : { externalMessageId: result.externalMessageId }),
    ...(result.mediaPosted === undefined ? {} : { mediaPosted: result.mediaPosted }),
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}

/** The capability's Project-scoped stager. A channel without a native upload
 * path refuses every file by name instead of staging bytes nobody can post. */
function sendFileStager(capability: ChannelReplyCapability): ChannelMediaStager {
  const { channel } = capability.ref;
  if (!isMediaChannel(channel)) {
    return () => {
      throw new ChannelMediaRefusedError(`${channel} has no native file-upload path`);
    };
  }
  return createChannelMediaStager({
    channel,
    ...(capability.projectRoot === undefined ? {} : { projectRoot: capability.projectRoot }),
  });
}

/** What the anchor row says about a send that may already have happened. */
type SendReservation =
  | { decision: "post" }
  | { decision: "replayed"; messageId?: string | undefined }
  | { decision: "in-flight" };

interface SendLedger {
  /** Claims the send's anchor row (sequence 0) and reports what to do with it. */
  reserve(): Promise<SendReservation>;
  /** Records, posts and confirms one platform message. */
  post(run: () => Promise<HubOutboundSendResult>): Promise<HubOutboundSendResult>;
  /** Fails whatever row is open after the runner threw before posting. */
  failOpenRow(reason: string): Promise<void>;
}

/**
 * The delivery ledger for one `send`.
 *
 * One send can produce several platform messages (the reply text, then one per
 * attachment), so the ledger records one row per message under the same
 * `eventTurnId`, numbered by `sequence`. Sequence 0 is the idempotency anchor:
 * it is claimed before any platform I/O. A prior attempt replays the whole send
 * only when every row under the key is `posted`; a partly delivered send
 * resumes at its first undelivered message and skips the rest.
 */
function createSendLedger(
  mcp: ChannelReplyMcp,
  ref: ChannelReplyBindingRef,
  eventTurnId: string,
): SendLedger {
  const row = (sequence: number) => ({
    organizationId: mcp.organizationId,
    accountId: ref.accountId,
    externalConversationId: ref.externalConversationId,
    externalThreadId: ref.externalThreadId,
    eventTurnId,
    sequence,
  });
  let next = 0;
  let open: number | undefined;
  /** Sequences an earlier attempt already delivered, with their native ids;
   * the resumed run skips them instead of posting them twice. */
  const alreadyPosted = new Map<number, string | undefined>();
  const record = async (sequence: number) =>
    await mcp.store.recordDelivery({ ...row(sequence), channel: ref.channel });
  return {
    async reserve() {
      const recorded = await record(0);
      next = 1;
      // A `failed` prior row is re-armed by `recordDelivery` (status back to
      // `recorded`, `attempts` incremented) and posts again on the same row: one
      // failed send must not burn the key for the rest of the execution. Only a
      // `posted` row replays, and only an in-flight or unknown outcome refuses.
      if (recorded.created || recorded.record.status === "failed") {
        open = 0;
        return { decision: "post" };
      }
      if (recorded.record.status !== "posted") return { decision: "in-flight" };
      // The anchor landed, but a send is only replayed once EVERY message it
      // produced landed. A retry after a failed attachment resumes from the
      // first row that is not posted; the delivered ones are skipped in `post`.
      const rows = await mcp.store.listTurnDeliveries(
        mcp.organizationId,
        ref.accountId,
        ref.externalConversationId,
        ref.externalThreadId,
        eventTurnId,
      );
      if (rows.every((entry) => entry.status === "posted")) {
        return {
          decision: "replayed",
          ...(recorded.record.externalMessageId === null
            ? {}
            : { messageId: recorded.record.externalMessageId }),
        };
      }
      for (const entry of rows) {
        if (entry.status !== "posted") continue;
        alreadyPosted.set(entry.sequence, entry.externalMessageId ?? undefined);
      }
      next = 0;
      open = undefined;
      return { decision: "post" };
    },
    async post(run) {
      // Sequence 0 is already recorded by `reserve`; later messages claim their
      // own row before the post, keeping record-before-post per message.
      const sequence = open ?? next++;
      if (alreadyPosted.has(sequence)) {
        const externalMessageId = alreadyPosted.get(sequence);
        return { ok: true, ...(externalMessageId === undefined ? {} : { externalMessageId }) };
      }
      if (open === undefined) {
        const recorded = await record(sequence);
        if (!recorded.created && recorded.record.status !== "failed") {
          return { ok: false, error: "delivery is already recorded; not re-posting" };
        }
      }
      open = sequence;
      const result = await run();
      if (!result.ok) {
        await mcp.store.failDelivery({
          ...row(sequence),
          failureReason: result.error ?? "the channel post failed",
        });
        open = undefined;
        return result;
      }
      await mcp.store.confirmDelivery({
        ...row(sequence),
        externalMessageId: result.externalMessageId ?? "",
        postedAt: new Date(),
      });
      open = undefined;
      return result;
    },
    async failOpenRow(reason) {
      if (open === undefined) return;
      await mcp.store.failDelivery({ ...row(open), failureReason: reason });
      open = undefined;
    },
  };
}

/** Answers a send whose anchor row was already claimed by an earlier attempt. */
async function finishReservedDelivery(
  call: ChannelSendCall,
  attempt: ChannelReplyOutputAttempt,
  reserved: Exclude<SendReservation, { decision: "post" }> & { eventTurnId: string },
): Promise<CallToolResult> {
  const ref = call.capability.ref;
  if (reserved.decision === "in-flight") {
    await attempt.fail();
    return toolFailure("delivery is already in progress or has an unknown outcome; not re-posting");
  }
  await attempt.complete();
  return toolSuccess("message already posted", {
    ok: true,
    action: "send",
    channel: ref.channel,
    accountId: ref.accountId,
    to: ref.externalConversationId,
    ...(ref.externalThreadId === null ? {} : { threadId: ref.externalThreadId }),
    messageId: reserved.messageId,
    deliveryId: reserved.eventTurnId,
    final: call.args["final"] !== false,
    replayed: true,
  });
}
