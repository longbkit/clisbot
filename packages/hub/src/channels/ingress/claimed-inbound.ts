import type { InboundReplyParams } from "../loader/host.js";

/**
 * A stored ingress payload as the plane receives it: stamped with its row id,
 * which is the message's identity when the channel carried no native id. The
 * drain hands a claim to the plane this way, and a binding's inbox reads its
 * stored messages back the same way.
 */
export function claimedInbound(payload: unknown, ingressId: string): InboundReplyParams {
  const stored = payload as InboundReplyParams;
  return {
    ...stored,
    ctxPayload: { ...stored.ctxPayload, ClisbotInboundOperationId: ingressId },
  };
}
