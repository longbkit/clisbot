// Fusion-owned host adapter for `src/infra/outbound/outbound-session.ts` (D-CORE-039).
//
// Upstream derives an OpenClaw session key for an outbound destination and writes
// a session entry into the file-backed session store so a later inbound message
// from that conversation lands in the same agent session. Fusion binds a
// conversation to an Agent through the Hub's Route/binding tables, so the port
// stops here: route resolution reports "no session route" and the durable write
// is a no-op the Hub already performed.
import type { ChannelId, ChannelPlugin, OpenClawConfig } from "../../channels/plugins/types.public.js";
import type { ResolvedMessagingTarget } from "./target-resolver.host-adapter.js";

export type RoutePeer = { id: string; kind?: string };

export type OutboundSessionRoute = {
  sessionKey: string;
  baseSessionKey: string;
  /** Route authority for explicit recipient session selection. */
  recipientSessionExact?: boolean | "direct-alias" | "delivery-identity";
  peer: RoutePeer;
  chatType: "direct" | "group" | "channel";
  /** Canonical conversation identity mirrored into MsgContext.From. */
  from: string;
  /** Routable delivery address mirrored into MsgContext.To. */
  to: string;
  threadId?: string | number;
};

export type ResolveOutboundSessionRouteParams = {
  cfg: OpenClawConfig;
  channel: ChannelId;
  plugin?: ChannelPlugin;
  agentId: string;
  accountId?: string | null;
  target: string;
  currentSessionKey?: string;
  resolvedTarget?: ResolvedMessagingTarget;
  replyToId?: string | null;
  threadId?: string | number | null;
};

export async function resolveOutboundSessionRoute(
  _params: ResolveOutboundSessionRouteParams,
): Promise<OutboundSessionRoute | null> {
  return null;
}

export async function ensureOutboundSessionEntry(_params: unknown): Promise<void> {}
