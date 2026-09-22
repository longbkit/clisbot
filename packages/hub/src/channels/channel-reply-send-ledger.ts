// The delivery ledger for one `message` send (channel-reply-send.ts).
//
// One send can produce several platform messages (the reply text, then one per
// attachment), so the ledger records one row per message under the same
// `eventTurnId`, numbered by `sequence`. Sequence 0 is the idempotency anchor:
// it is claimed before any platform I/O. A prior attempt replays the whole send
// only when every row under the key is `posted`; a partly delivered send
// resumes at its first undelivered message and skips the rest.
import type { ChannelReplyMcp } from "./channel-reply.js";
import type { HubOutboundSendResult } from "./message-actions.js";
import type { ChannelReplyBindingRef } from "./plane/types.js";

/** What the anchor row says about a send that may already have happened. */
export type SendReservation =
  | { decision: "post" }
  | { decision: "replayed"; messageId?: string | undefined }
  | { decision: "in-flight" };

export interface SendLedger {
  /** Claims the send's anchor row (sequence 0) and reports what to do with it. */
  reserve(): Promise<SendReservation>;
  /** Records, posts and confirms one platform message. */
  post(run: () => Promise<HubOutboundSendResult>): Promise<HubOutboundSendResult>;
  /** Fails whatever row is open after the runner threw before posting. */
  failOpenRow(reason: string): Promise<void>;
}

/** One send's ledger position. */
interface SendLedgerState {
  mcp: ChannelReplyMcp;
  ref: ChannelReplyBindingRef;
  eventTurnId: string;
  next: number;
  /** The row recorded and not yet settled, if any. */
  open: number | undefined;
  /** Sequences an earlier attempt already delivered, with their native ids;
   * the resumed run skips them instead of posting them twice. */
  alreadyPosted: Map<number, string | undefined>;
}

export function createSendLedger(
  mcp: ChannelReplyMcp,
  ref: ChannelReplyBindingRef,
  eventTurnId: string,
): SendLedger {
  const state: SendLedgerState = {
    mcp,
    ref,
    eventTurnId,
    next: 0,
    open: undefined,
    alreadyPosted: new Map(),
  };
  return {
    reserve: () => reserveAnchor(state),
    post: (run) => postMessage(state, run),
    failOpenRow: (reason) => failOpenRow(state, reason),
  };
}

function rowKey(state: SendLedgerState, sequence: number) {
  return {
    organizationId: state.mcp.organizationId,
    accountId: state.ref.accountId,
    externalConversationId: state.ref.externalConversationId,
    externalThreadId: state.ref.externalThreadId,
    eventTurnId: state.eventTurnId,
    sequence,
  };
}

function recordRow(state: SendLedgerState, sequence: number) {
  return state.mcp.store.recordDelivery({ ...rowKey(state, sequence), channel: state.ref.channel });
}

async function reserveAnchor(state: SendLedgerState): Promise<SendReservation> {
  const recorded = await recordRow(state, 0);
  state.next = 1;
  // A `failed` prior row is re-armed by `recordDelivery` (status back to
  // `recorded`, `attempts` incremented) and posts again on the same row: one
  // failed send must not burn the key for the rest of the execution. Only a
  // `posted` row replays, and only an in-flight or unknown outcome refuses.
  if (recorded.created || recorded.record.status === "failed") {
    state.open = 0;
    return { decision: "post" };
  }
  if (recorded.record.status !== "posted") return { decision: "in-flight" };
  const messageId = recorded.record.externalMessageId;
  return await resumeOrReplay(state, messageId);
}

/**
 * The anchor landed, but a send is only replayed once EVERY message it
 * produced landed. A retry after a failed attachment resumes from the first
 * row that is not posted; the delivered ones are skipped in `post`.
 */
async function resumeOrReplay(
  state: SendLedgerState,
  anchorMessageId: string | null,
): Promise<SendReservation> {
  const { mcp, ref } = state;
  const rows = await mcp.store.listTurnDeliveries(
    mcp.organizationId,
    ref.accountId,
    ref.externalConversationId,
    ref.externalThreadId,
    state.eventTurnId,
  );
  if (rows.every((entry) => entry.status === "posted")) {
    return {
      decision: "replayed",
      ...(anchorMessageId === null ? {} : { messageId: anchorMessageId }),
    };
  }
  for (const entry of rows) {
    if (entry.status !== "posted") continue;
    state.alreadyPosted.set(entry.sequence, entry.externalMessageId ?? undefined);
  }
  state.next = 0;
  state.open = undefined;
  return { decision: "post" };
}

async function postMessage(
  state: SendLedgerState,
  run: () => Promise<HubOutboundSendResult>,
): Promise<HubOutboundSendResult> {
  // Sequence 0 is already recorded by `reserve`; later messages claim their
  // own row before the post, keeping record-before-post per message.
  const sequence = state.open ?? state.next++;
  if (state.alreadyPosted.has(sequence)) {
    const externalMessageId = state.alreadyPosted.get(sequence);
    return { ok: true, ...(externalMessageId === undefined ? {} : { externalMessageId }) };
  }
  if (state.open === undefined) {
    const recorded = await recordRow(state, sequence);
    if (!recorded.created && recorded.record.status !== "failed") {
      return { ok: false, error: "delivery is already recorded; not re-posting" };
    }
  }
  state.open = sequence;
  const result = await run();
  await settleMessage(state, sequence, result);
  state.open = undefined;
  return result;
}

async function settleMessage(
  state: SendLedgerState,
  sequence: number,
  result: HubOutboundSendResult,
): Promise<void> {
  const key = rowKey(state, sequence);
  if (result.ok) {
    await state.mcp.store.confirmDelivery({
      ...key,
      externalMessageId: result.externalMessageId ?? "",
      postedAt: new Date(),
    });
    return;
  }
  // A post that may have landed keeps its row `recorded`: the key stays
  // claimed, so a retry under it refuses instead of double-posting.
  if (result.failure?.mayHavePosted === true) return;
  await state.mcp.store.failDelivery({
    ...key,
    failureReason: result.error ?? "the channel post failed",
  });
}

async function failOpenRow(state: SendLedgerState, reason: string): Promise<void> {
  if (state.open === undefined) return;
  await state.mcp.store.failDelivery({ ...rowKey(state, state.open), failureReason: reason });
  state.open = undefined;
}
