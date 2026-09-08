import type { ChannelPrivilegeDecision } from "../../access/store.js";
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
  EffectiveDefaults,
  RouteTarget,
} from "../config/compile.js";
import type { CreateAgentConfig } from "../daemon/types.js";
import type { InboundReplyParams, InboundReplyResult } from "../loader/host.js";
import type { ChannelReplyCapabilityService } from "../channel-reply-capabilities.js";
import type { RecordChannelInboundActivityInput } from "../../db/channels.js";
import type { ChannelStreamingDriver } from "../streaming/types.js";
import type { SupportedChannelName } from "../catalog.js";
import type { MessagePresentation } from "@getpaseo/channels-core/plugin-sdk/interactive-runtime";

// The channel-name vocabulary is catalog-owned (`catalog.ts`
// SUPPORTED_CHANNEL_NAMES); re-exported here because the plane is where the
// engines read their shared shapes from.
export type { SupportedChannelName };

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
  channel: SupportedChannelName;
  accountId: string;
  /** The channel identity of the sender (`<channel>:<provider-id>`). */
  senderIdentity: string;
  /** The sender's display name when the vertical carries it (Telegram
   * `first_name`, Slack resolved user name) — used for friendly
   * decided-state wording; absent = the engine falls back to the identity. */
  senderName?: string;
  /** The message text (command text for approval replies). */
  text: string;
  /** True when the bot was explicitly mentioned/addressed. */
  mentionedBot: boolean;
  /** The channel-native id of the inbound marker message (Slack `ts`,
   * Telegram message id) — the reply-thread minting anchor for
   * `reply.anchor: thread`; absent when the vertical does not carry it. */
  externalMessageId?: string;
  conversation: InboundConversationDetail;
  /** The conversation's human label (Telegram group/topic title) when the
   * vertical carries it — diagnostics only; the plane decides on the ids. */
  conversationLabel?: string;
}

/** What the plane did with one inbound message. */
export type InboundOutcome =
  | {
      kind: "bound";
      agentId: string;
      newSession: boolean;
      /** The conversation's human label when the vertical carries it. */
      conversationLabel?: string | undefined;
    }
  | {
      kind: "steered";
      agentId: string;
      /** The conversation's human label when the vertical carries it. */
      conversationLabel?: string | undefined;
    }
  | { kind: "workflow"; workflow: string; deliveryId: string }
  | { kind: "command"; handled: boolean; detail?: string | undefined }
  | { kind: "ignored"; reason: string };

/**
 * Back-pressure, not a decision. The plane would accept this message but has no
 * capacity for it right now (a Route rate or concurrency ceiling), so whoever
 * holds the durable copy must bring it back rather than treat it as handled.
 */
export interface PlaneInboundDeferral {
  reason: string;
  retryAfterMs: number;
}

/** The reply result a host returns for an inbound message, plus the plane's
 * structured outcome for tests and diagnostics. */
export type PlaneInboundResult = InboundReplyResult & {
  outcome?: InboundOutcome | undefined;
  /** Set only alongside `dispatched: false`, when the refusal is temporary. */
  deferred?: PlaneInboundDeferral | undefined;
};

/**
 * Read a deferral off a host inbound result. The host contract carries an index
 * signature, so a plane field arrives at the supervisor untyped; this is the
 * one place that narrows it.
 */
export function planeInboundDeferral(result: {
  [key: string]: unknown;
}): PlaneInboundDeferral | undefined {
  const deferred = result["deferred"];
  if (typeof deferred !== "object" || deferred === null) return undefined;
  const { reason, retryAfterMs } = deferred as Record<string, unknown>;
  if (typeof reason !== "string" || typeof retryAfterMs !== "number") return undefined;
  return { reason, retryAfterMs };
}

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
  channel: SupportedChannelName;
  accountId: string;
  /** The conversation to post into. */
  to: string;
  /** The thread to post into; omitted when the reply lands at the conversation root. */
  threadId?: string | undefined;
  text: string;
  /** COMPAT(clisbot-control-plane): the native card payload (Slack Block Kit
   * `blocks`), posted together with `text` (Slack requires `text` as the
   * fallback rendering). Open-typed: the Hub never imports the vertical's
   * card types. */
  blocks?: Record<string, unknown>[] | undefined;
  /** COMPAT(clisbot-control-plane): the native card payload (Telegram
   * `reply_markup` inline keyboard), sent on chunk 0 alongside `text`. */
  replyMarkup?: Record<string, unknown> | undefined;
  /** The portable presentation the message renders (charts, tables, controls).
   * Only a vertical that declares presentation support is given one; it
   * compiles the blocks itself and `text` stays the fallback rendering. */
  presentation?: MessagePresentation | undefined;
}

export interface OutboundPostResult {
  ok: boolean;
  /** The native message id the channel assigned (Slack `ts`, Telegram id). */
  externalMessageId?: string | undefined;
  error?: string | undefined;
  /** COMPAT(clisbot-control-plane): true when the post carried native
   * interactive markup (a card the resolution can update in place). */
  cardPosted?: boolean | undefined;
}

/** The channel's send path (its published send adapter, in-process). */
export type PostFn = (params: OutboundPostParams) => Promise<OutboundPostResult>;

/** COMPAT(clisbot-control-plane): one OUTBOUND native-media post (group G,
 * G7–G11) — the account's vertical `outbound.sendMedia` (one file per call),
 * driven by the relay when an agent's final answer references a local media
 * file. `filePath` is the absolute path under the agent's home the vertical
 * reads + uploads. `mediaPosted` is the vertical's G11 contract: true when the
 * file posted natively, false when the vertical refused it and posted the
 * in-channel notice through its text path instead (either way a channel message
 * was posted, so the ledger records + confirms it). A transport fault
 * (missing file / API failure) lands as `{ ok: false, error }` — the relay's
 * failDelivery owns it. */
export interface MediaPostParams {
  channel: SupportedChannelName;
  accountId: string;
  /** The conversation to post into. */
  to: string;
  /** The thread to post into; omitted when the reply lands at the conversation root. */
  threadId?: string | undefined;
  /** The local media file's absolute path (under the agent's home). */
  filePath: string;
}

export interface MediaPostResult {
  ok: boolean;
  /** The native message id the channel assigned (the native post or the
   * G11 notice's id — both are posted messages the ledger confirms with). */
  externalMessageId?: string | undefined;
  /** The vertical's G11 flag: true when the file posted natively, false when
   * the vertical refused it and posted the in-channel notice through its text
   * path (the notice's id is `externalMessageId`). */
  mediaPosted?: boolean | undefined;
  error?: string | undefined;
}

/** The channel's native-media send path (its published `sendMedia` adapter).
 * Absent (a plugin without `outbound.sendMedia`) = the relay's media path is a
 * no-op (byte-identical to a text-only relay). */
export type MediaPostFn = (params: MediaPostParams) => Promise<MediaPostResult>;

/** COMPAT(clisbot-control-plane): one in-place update of a posted message
 * (the approval card's decided state: `chat.updateMessage` /
 * `editMessageText`). The channel-native message id targets it; `clearCard`
 * strips the interactive markup (Slack `blocks: []`, Telegram
 * `reply_markup: {}`). */
export interface OutboundUpdateParams {
  channel: SupportedChannelName;
  accountId: string;
  to: string;
  threadId?: string | undefined;
  /** The native message id of the posted message to update. */
  externalMessageId: string;
  text: string;
  clearCard?: boolean | undefined;
  /** COMPAT(clisbot-control-plane): a channel-native mention of the responder
   * (Slack `<@U123>`), rendered as part of the decided-state text when the
   * channel supports user mentions; absent = plain text only. */
  senderMention?: string | undefined;
}

export interface OutboundUpdateResult {
  ok: boolean;
  error?: string | undefined;
}

/** The channel's in-place update path (its published update adapter). */
export type UpdateFn = (params: OutboundUpdateParams) => Promise<OutboundUpdateResult>;

/** COMPAT(clisbot-control-plane): the account's vertical liveness drive
 * (`outbound.typing`) — the `sync.progress` "the bot is working" surface.
 *
 * The contract is a LIFECYCLE, not a heartbeat: the Hub calls `start` once
 * when it accepts an inbound that will run a turn, and `stop` once when that
 * turn ends. What the signal costs to KEEP alive is the provider's business
 * and belongs to the vertical: Slack's status is set-once/clear-once (it
 * holds for two minutes and Slack clears it when the app replies), while
 * Telegram's `sendChatAction` lapses in ~5s, so that vertical re-sends on its
 * own timer until `stop` cancels it. One Hub-side heartbeat is wrong for
 * both: a no-op for Slack, the wrong cadence for Telegram.
 *
 * The vertical maps `indicator` / `reactionEmoji` onto whatever it actually has
 * (Slack: the assistant thread status plus a reaction on the marker;
 * Telegram: `sendChatAction`, no reaction surface) and skips what it lacks. A
 * drive that cannot reach the wire throws; the controller logs and releases
 * the surface, so a typing fault never disturbs the reply path.
 */
export interface TypingParams {
  channel: SupportedChannelName;
  accountId: string;
  /** The conversation the turn is running in. */
  to: string;
  /** The thread the reply will land in; absent = the conversation root. */
  threadId?: string | undefined;
  /** The inbound marker's native message id — the reaction target (Slack). */
  messageId?: string | undefined;
  action: "start" | "stop";
  /** `sync.progress.typingIndicator` — the provider's native typing status. */
  indicator: boolean;
  /** `sync.progress.messageReaction`, resolved to a name: react with this
   * emoji on the sender's own `messageId` for the length of the turn. Absent =
   * `"off"` (the floor) — the Hub folds the reserved word away so the vertical
   * never compares against a magic string. */
  reactionEmoji?: string | undefined;
}

export type TypingFn = (params: TypingParams) => Promise<void>;

/** COMPAT(clisbot-control-plane): one native approval-card button click,
 * normalized by the vertical's transport seam into the plane's shape. The
 * button carries no authority — `command` is data; the resolver re-authorizes
 * `senderIdentity` exactly as a typed command. The conversation the card was
 * posted in (binding key input) rides along so the binding lookup needs no
 * thread-descriptor of its own. */
export interface ApprovalCallbackParams {
  channel: string;
  accountId: string;
  senderIdentity: string;
  /** The button's opaque card value (`decision:cardId[:answer]` — the hub
   * card builder's wire format). The vertical parses only the CHANNEL
   * envelope; the value itself is parsed ONCE, here in the hub (card.ts
   * `parseCardValue`) — one parse, one card-value scheme. */
  cardValue: string;
  /** The conversation the card was posted in (root conversation id). */
  externalConversationId: string;
  /** The thread the card was posted in (null at conversation root). */
  externalThreadId: string | null;
  /** The ROOT conversation's kind (the vertical's normalization: Slack
   * `D` → dm, `C` → channel, `G` → group; Telegram private → dm, group →
   * group) — the route match's root descriptor. */
  rootKind: "dm" | "channel" | "group";
}

// --- Channel-reply MCP tool (E4/E6) --------------------------------------------

/**
 * The mcpServers key + tool name a tool-path agent gets: the preapproved
 * grant and the hub's MCP endpoint both address the tool by these two strings,
 * so one place owns both.
 */
export const CHANNEL_REPLY_MCP_SERVER_NAME = "channel_reply";
export const CHANNEL_REPLY_TOOL_NAME = "message";

/**
 * The thread a tool-path MCP endpoint posts into: the account (channel +
 * account id — account ids can collide across channels, so the ref carries
 * the channel) + the durable thread key the agent's session was created from
 * (the mcpServers URL's opaque binding ref, embedded at create time — the
 * endpoint is create-time-only: no daemon RPC attaches an MCP server to an
 * existing session, so pre-existing agents never get the tool).
 */
export interface ChannelReplyBindingRef {
  channel: SupportedChannelName;
  accountId: string;
  externalConversationId: string;
  externalThreadId: string | null;
}

/** Opaque server-issued capability attached to one Agent at create time. */
export interface ChannelReplyAgentCapability {
  token: string;
  canSendFiles: boolean;
}

/** The tool-path post seam: the account's outbound (the vertical's `sendText`
 * through the supervisor's `postFor`), addressed by the server-owned binding ref. */
export type ChannelReplyPostFn = (
  ref: ChannelReplyBindingRef,
  text: string,
  options?: { presentation?: MessagePresentation | undefined },
) => Promise<OutboundPostResult>;

/** Resolve a route's agent target (names into `hub.yml`) into a daemon create config.
 * The route's effective defaults select the outbound path (E4/E6); on a `tool`
 * path the `bindingRef` names the thread the attached MCP tool posts into. */
export type AgentSpecResolver = (
  target: Extract<RouteTarget, { kind: "agent" }>,
  defaults: EffectiveDefaults,
  bindingRef: ChannelReplyBindingRef,
  capability?: ChannelReplyAgentCapability | undefined,
  /** The conversation's `/model` choice, when one was made. `/agent` needs no
   * override — it names a different agent, and that IS the target. */
  overrides?: { model?: string | undefined } | undefined,
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

/** Optional Hub Member/Team authority layered beside the existing Channel policy. */
export type ChannelUseAuthorizer = (input: {
  organizationId: string;
  account: CompiledChannelAccount;
  message: InboundMessage;
}) => Promise<ChannelPrivilegeDecision>;

export interface ChannelAgentAccessTarget {
  daemonReference: string;
  projectId?: string;
  /** Absolute root which bounds files an Agent may send back to its Channel. */
  projectRoot?: string;
}

/** Verifies that a mapped Member may answer one Project-scoped approval. */
export type ChannelApprovalAuthorizer = (input: {
  organizationId: string;
  account: CompiledChannelAccount;
  responderIdentity: string;
  target: ChannelAgentAccessTarget;
  privilege:
    | "approval.file"
    | "approval.config"
    | "approval.command"
    | "approval.command.destructive"
    | "approval.channel";
}) => Promise<boolean>;

/** Consumes a signed-in Member's one-use code from the provider identity that sent it. */
export type ChannelIdentityChallengeConsumer = (input: {
  organizationId: string;
  account: CompiledChannelAccount;
  senderIdentity: string;
  senderName?: string | undefined;
  code: string;
}) => Promise<"linked" | "already_linked" | "identity_conflict" | "invalid">;

/** Everything the execution plane is built with (the facade's deps). */
export interface ChannelPlaneDeps {
  organizationId: string;
  /** Immutable Channel configuration revision backing this plane. */
  channelRevisionId?: string | null | undefined;
  /** This plane's transport owner; recovery and inbound never cross it. */
  accountScope: { channel: SupportedChannelName; accountId: string };
  /** Normalize the channel's raw inbound event into the plane's flat shape. */
  normalizeInbound: InboundNormalizer;
  /** The process-level kill switch (`CLISBOT_HUB_CHANNELS_ENABLED`); the per-decision
   * config levels compose it via `policy.isEnabled`. */
  envFlag: boolean;
  controlPlane: ChannelControlPlane;
  authorizeChannelUse?: ChannelUseAuthorizer | undefined;
  authorizeChannelApproval?: ChannelApprovalAuthorizer | undefined;
  consumeChannelIdentityChallenge?: ChannelIdentityChallengeConsumer | undefined;
  /** Durable, bounded audit sink for open-audience inbound decisions. */
  recordChannelInboundActivity?:
    | ((input: RecordChannelInboundActivityInput) => Promise<void>)
    | undefined;
  logger: PlaneLogger;
  post: PostFn;
  /** COMPAT(clisbot-control-plane): the account's native-media post (the
   * vertical's `outbound.sendMedia`, one local media file per call; G7–G11),
   * driven by the relay's final-answer path. Absent = the relay's media path
   * is a no-op (byte-identical text relay). */
  mediaPost?: MediaPostFn | undefined;
  /** COMPAT(clisbot-control-plane): the media home-root fallback (the shared
   * daemon/Hub home the agent files live under) for agents whose own home
   * (the create-time cwd) the plane has not recorded. Absent + no recorded
   * cwd = the relay's media path is a no-op. */
  homeRoot?: string | undefined;
  /** COMPAT(clisbot-control-plane): the channel's in-place update adapter
   * (the approval card's decided state); absent = no in-place update (the
   * outcome still resolves on the daemon, the card just goes stale). */
  update?: UpdateFn | undefined;
  /** COMPAT(clisbot-control-plane): the liveness drive (the vertical's
   * `outbound.typing`); absent = no processing surface at all. Gated per turn by
   * the route's `sync.progress.typingIndicator` / `.messageReaction`. */
  typing?: TypingFn | undefined;
  /** COMPAT(clisbot-control-plane): the account's streaming surface, detected
   * off the loaded vertical's `plugin.outbound` (slice 22b). Absent = the relay
   * posts final answers only, exactly as before. Gated per route by
   * `sync.streaming`. */
  streaming?: ChannelStreamingDriver | undefined;
  /** The wall-clock seam; `realClock()` when absent. */
  clock?: PlaneClock | undefined;
  /** Resolve a route's agent target into a `create_agent_request` config. */
  resolveAgentSpec: AgentSpecResolver;
  /** Process-lifetime bearer capability owner for tool-path Channel replies. */
  replyCapabilities?: ChannelReplyCapabilityService | undefined;
  resolveAgentAccessTarget: (
    target: Extract<RouteTarget, { kind: "agent" }>,
  ) => ChannelAgentAccessTarget;
  dispatchWorkflow: (input: {
    organizationId: string;
    deliveryId: string;
    payload: import("../../triggers/channel/provider.js").ChannelWorkflowRequestPayload;
    receivedAt: Date;
  }) => Promise<void>;
  workflowOutputStore: Pick<
    import("../../db/types.js").Database,
    | "beginAgentExecutionOutput"
    | "completeAgentExecutionOutput"
    | "failAgentExecutionOutput"
    | "findLatestChannelWorkflowExecution"
  >;
  /** Back-link renderer for `sync.threadLink`; absent posts no link. */
  sessionLink?: SessionLinkRenderer | undefined;
  /** Progress-snapshot throttle window (ms); default `DEFAULT_PROGRESS_THROTTLE_MS`. */
  progressThrottleMs?: number | undefined;
  /** Processing-surface TTL (ms): how long a turn may go without a single
   * stream event before the Hub releases its surface; default
   * `PROCESSING_TTL_MS`. The provider's own expiry is the vertical's. */
  processingTtlMs?: number | undefined;
}

/** The Slack native thread-id shape (`epoch.seconds` `ts`): the only strings
 * usable as a `thread_ts` minting anchor (mirrors OpenClaw's
 * `normalizeSlackThreadTsCandidate`). Shared by the binding-key marker rule
 * (`bindings`) and the relay's reply location (`relay`). */
export const SLACK_THREAD_TS_PATTERN = /^\d+\.\d+$/;

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
  /** Durable scope for outbound dedupe when one daemon Agent serves multiple
   * Workflow executions. Provider-local turn ids may restart at zero after
   * restore/reload, so they are not globally unique for a reused Agent. */
  deliveryScopeId?: string;
  channel: SupportedChannelName;
  accountId: string;
  externalConversationId: string;
  externalThreadId: string | null;
  /** COMPAT(clisbot-control-plane): the native thread the live inbound marker
   * sat in, when the binding itself carries no thread (`binding.key: channel`
   * collapses threads into one binding). `replyLocationFor` follows it for
   * the marker's turn; absent on restart re-attach, where the binding's
   * persisted thread (or the root) applies. */
  triggerThreadId?: string | null;
  /** COMPAT(clisbot-control-plane): the live marker's native message id
   * (Slack `ts`), used as the `thread_ts` when `reply.anchor: thread` mints
   * a thread on a root-level marker. Absent when the vertical did not carry
   * it or on restart re-attach. */
  triggerMessageId?: string;
  /** The channel identity that started the thread (approval `initiatorOnly`). */
  initiator: string;
  /** The account the thread's binding belongs to (role scopes for approval). */
  account: CompiledChannelAccount;
  /** The effective route (matched route, or the synthesized catch-all fallback). */
  route: CompiledRoute;
  /** Fixed daemon/Project ceiling used to authorize Channel approval responders. */
  accessTarget?: ChannelAgentAccessTarget;
  /** COMPAT(clisbot-control-plane): the conversation kind the binding's route
   * matched (the stored route summary's `kind`; "channel" when unparseable) —
   * the approval card's `inlineButtons` dm/group gate decides on it. */
  rootKind: "dm" | "channel" | "thread" | "group" | "topic";
  outputDelivery?: {
    begin(): Promise<string | undefined>;
    complete(attemptId: string): Promise<void>;
    fail(attemptId: string): Promise<void>;
  };
}
