import type { HostRuntime } from "../loader/host.js";
import { planeInboundDeferral, type PlaneLogger } from "../plane/types.js";
import { claimedInbound } from "./claimed-inbound.js";
import type { ChannelIngressDeferral } from "./drain.js";
import { ingressAttempt } from "./attempt.js";

interface DispatchQueuedInboundOptions {
  channel: string;
  accountId: string;
  hostRuntime: Pick<HostRuntime, "onInboundReply" | "inboundLedger">;
  payload: unknown;
  ingressId: string;
  logger: PlaneLogger;
}

/** Dispatch one durable event; the queue owns completion, the ledger is its audit. */
export async function dispatchQueuedInbound(
  options: DispatchQueuedInboundOptions,
): Promise<ChannelIngressDeferral | undefined> {
  const { hostRuntime, channel, accountId, payload, ingressId } = options;
  const params = claimedInbound(payload, ingressId);
  const conversationId = params.ctxPayload?.["ChatId"];
  const messageId = params.ctxPayload?.["MessageSid"];
  const senderId = params.ctxPayload?.["SenderId"];
  const hasNativeIdentity = typeof conversationId === "string" && typeof messageId === "string";
  const audit = hasNativeIdentity
    ? { channel, accountId, externalConversationId: conversationId, externalMessageId: messageId }
    : undefined;
  const ledger = hostRuntime.inboundLedger;
  // Admission can survive a crash before the transport records its audit.
  // Repair that gap before any command or agent side effect, including on restart.
  if (ledger !== undefined && audit !== undefined) {
    await ledger.record({
      ...audit,
      ...(typeof senderId === "string" && senderId !== "" ? { senderIdentity: senderId } : {}),
    });
  }
  ingressAttempt.getStore()?.throwIfAborted();
  const result = await hostRuntime.onInboundReply(params);
  if (!result.dispatched) {
    const deferral = planeInboundDeferral(result);
    if (deferral !== undefined) return { kind: "deferred", ...deferral };
  }
  if (!result.dispatched || ledger === undefined || audit === undefined) return undefined;
  try {
    await ledger.consume({ ...audit, turnId: `${channel}:${audit.externalMessageId}` });
  } catch (error) {
    // The plane has already handled the message. An audit fault must not
    // replay its side effects or keep later commands behind it in the lane.
    options.logger.warn("channel inbound audit failed after dispatch", {
      channel,
      account: accountId,
      event: ingressId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return undefined;
}
