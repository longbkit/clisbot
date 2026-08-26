// Shared vocabulary for the channel execution plane (plan §4-S2/§4-S5/§4-S6).
// One place for the shapes that the bindings, relay, and approval engines all
// read, so no engine re-derives an inbound message, a post, or an outcome. The
// facade (`execution.ts`) composes the three engines; this module is the common
// word they speak. The daemon wire types (`daemon/types.ts`) and the store
// (`db/channels.ts`) stay owned by their modules — this is only the in-plane
// seam.

import type {
  ChannelControlPlane,
  CompiledChannelAccount,
  CompiledRoute,
  RouteTarget,
} from "../config/compile.js";
import type { CreateAgentConfig } from "../daemon/types.js";
import type { InboundReplyParams, InboundReplyResult } from "../loader/host.js";

/** A channel native to P0 (the two verticals the control plane drives). */
export type P0ChannelName = "slack" | "telegram";

/** The native conversation shape an inbound message arrives in. */
export interface InboundConversationDetail {
  /** The route-match descriptor's kind, in the route match vocabulary. */
  kind: "dm" | "channel" | "thread" | "group" | "topic";
  /** The id `kind` refers to (thread ts / topic id / channel id / peer id). */
  id: string;
  /** The root channel / group / DM peer id — the binding key's conversation. */
  rootConversationId: string;
  /** The native thread/topic id within the root conversation (null at root level). */
  threadId: string | null;
}

/**
 * A normalized inbound channel message: the fields the execution plane decides
 * over. The vertical's normalization (the loader seam) produces this flat
 * shape from the raw `ctxPayload`; the plane never reads the raw payload.
 */
export interface InboundMessage {
  channel: string;
  accountId: string;
  /** The channel identity of the sender (`<channel>:<provider-id>`). */
  senderIdentity: string;
  /** The message text (command text for approval replies). */
  text: string;
  /** True when the bot was explicitly mentioned/addressed. */
  mentionedBot: boolean;
  conversation: InboundConversationDetail;
}

/** What the plane did with one inbound message. */
export type InboundOutcome =
  | { kind: "bound"; agentId: string; newSession: boolean }
  | { kind: "steered"; agentId: string }
  | { kind: "command"; handled: boolean; detail?: string | undefined }
  | { kind: "ignored"; reason: string };

/** The reply result a host returns for an inbound message, plus the plane's
 * structured outcome for tests and diagnostics. */
export type PlaneInboundResult = InboundReplyResult & {
  outcome?: InboundOutcome | undefined;
};

/** Minimal structured logger the plane writes through (host `logging.getChildLogger`). */
export interface PlaneLogger {
  debug?: (message: string, meta?: unknown) => void;
  info?: (message: string, meta?: unknown) => void;
  warn: (message: string, meta?: unknown) => void;
  error?: (message: string, meta?: unknown) => void;
}

/** Wall-clock seam so the happy path never reads a real timer (idle TTL, throttle). */
export interface PlaneClock {
  now(): number;
}

/** Where one outbound post lands (channel-native, resolved by `reply.anchor`). */
export interface OutboundPostParams {
  channel: P0ChannelName;
  accountId: string;
  /** The conversation to post into. */
  to: string;
  /** The thread to post into; omitted when the reply anchors at channel level. */
  threadId?: string | undefined;
  text: string;
}

export interface OutboundPostResult {
  ok: boolean;
  /** The native message id the channel assigned (Slack `ts`, Telegram id). */
  externalMessageId?: string | undefined;
  error?: string | undefined;
}

/** The channel's send path (its published send adapter, in-process). */
export type PostFn = (params: OutboundPostParams) => Promise<OutboundPostResult>;

/** Resolve a route's agent target (names into `hub.yml`) into a daemon create config. */
export type AgentSpecResolver = (
  target: Extract<RouteTarget, { kind: "agent" }>,
) => CreateAgentConfig;

/** Render the back-link to a live session (threadLink); absent = no link rendered. */
export type SessionLinkRenderer = (agentId: string) => string;

/**
 * Normalize a channel's raw inbound event into the plane's flat shape. The
 * loader seam hands the plane `InboundReplyParams` (whose `ctxPayload` is
 * channel-specific); this is where the channel-native conversation shape,
 * sender identity, and mention flag are read. Null = the event is not a
 * plane-bound message (e.g. a media-only event) and is ignored.
 */
export type InboundNormalizer = (params: InboundReplyParams) => InboundMessage | null;

/** Everything the execution plane is built with (the facade's deps). */
export interface ChannelPlaneDeps {
  organizationId: string;
  /** Normalize the channel's raw inbound event into the plane's flat shape. */
  normalizeInbound: InboundNormalizer;
  /** The process-level kill switch (`CLISBOT_HUB_CHANNELS_ENABLED`); the per-decision
   * config levels compose it via `policy.isEnabled`. */
  envFlag: boolean;
  controlPlane: ChannelControlPlane;
  logger: PlaneLogger;
  post: PostFn;
  /** The wall-clock seam; `realClock()` when absent. */
  clock?: PlaneClock | undefined;
  /** Resolve a route's agent target into a `create_agent_request` config. */
  resolveAgentSpec: AgentSpecResolver;
  /** Back-link renderer for `sync.threadLink`; absent posts no link. */
  sessionLink?: SessionLinkRenderer | undefined;
  /** Progress-snapshot throttle window (ms); default `DEFAULT_PROGRESS_THROTTLE_MS`. */
  progressThrottleMs?: number | undefined;
}

/** The binding's thread location + initiator, enough to post into its thread. */
export interface ThreadRef {
  externalConversationId: string;
  externalThreadId: string | null;
  /** The channel identity that started the thread (approval `initiatorOnly`). */
  initiator: string;
}

/** The per-agent stream context both the relay and the approval engine share. */
export interface StreamContext {
  agentId: string;
  channel: P0ChannelName;
  accountId: string;
  externalConversationId: string;
  externalThreadId: string | null;
  /** The channel identity that started the thread (approval `initiatorOnly`). */
  initiator: string;
  /** The account the thread's binding belongs to (role scopes for approval). */
  account: CompiledChannelAccount;
  /** The effective route (matched route, or the synthesized catch-all fallback). */
  route: CompiledRoute;
}
