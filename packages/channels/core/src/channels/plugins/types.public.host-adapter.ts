// Fusion-owned host adapter for `src/channels/plugins/types.public.ts` (D-CORE-010).
//
// Upstream re-exports the whole plugin type universe (`types.core.ts`,
// `types.adapters.ts`, `types.plugin.ts`) which carries setup, pairing, approval
// and lifecycle contracts plus the fully typed `OpenClawConfig`. Fusion owns
// configuration in the Hub, so this adapter carries only the message-tool
// subset the ported schema/discovery layer reads.
import type { TSchema } from "typebox";
import type { ChatType } from "../chat-type.js";
import type { ReplyPayload } from "../../auto-reply/reply-payload.js";
import type { OutboundReplyFacts } from "../message/types.js";
import type { InboundEventKind } from "../inbound-event/kind.js";
import type { OutboundMediaAccess } from "../../media/load-options.js";
import type { GatewayClientMode, GatewayClientName } from "../../gateway-protocol/client-info.js";
import type { AgentToolResult } from "../../agents/runtime/index.host-adapter.js";
import type { ChannelOutboundAdapter } from "./outbound.types.js";
import type { ConversationReadInvocationOrigin } from "./conversation-read-origin.js";
import type { ChannelMessageCapability } from "./message-capabilities.js";
import type { ChannelMessageActionName } from "./message-action-names.js";
export type { ChannelMessageActionName };
/**
 * Host configuration surface. Upstream passes the fully typed `OpenClawConfig`;
 * Fusion owns configuration in the Hub, so discovery hooks only see an opaque
 * per-channel record here.
 */
export type ChannelAccountConfigLike = {
  enabled?: boolean;
  [key: string]: unknown;
};
/**
 * Upstream `src/config/types.channels.ts`: channel sections are plugin-owned and
 * keyed by arbitrary channel ids, so the index signature is open-world
 * (`ReturnType<typeof JSON.parse>`). A ported vertical whose config type it owns
 * itself — Feishu infers `FeishuConfig` from its own zod schema — reads
 * `cfg.channels.<id>` through this signature exactly as it does upstream.
 * `config/types.openclaw.channels.ts` narrows the sections Fusion types.
 */
type OpenWorldChannelConfig = ReturnType<typeof JSON.parse>;
export type OpenClawConfig = {
  channels?: Record<string, OpenWorldChannelConfig>;
  /** Only the media ceiling the ported outbound media path reads is typed. */
  agents?: { defaults?: { mediaMaxMb?: number } };
  /** Only the store handle the ported TTS lookup passes through is typed. */
  session?: { store?: unknown };
  [key: string]: unknown;
};
/** Canonical channel id. Upstream narrows this through the plugin registry. */
export type ChannelId = string;
export type ChannelThreadingToolContext = {
  currentChannelId?: string;
  /** Trusted normalized conversation kind for the active inbound turn. */
  currentChatType?: ChatType;
  /** Routable messaging target when it differs from the platform-native channel id. */
  currentMessagingTarget?: string;
  currentGraphChannelId?: string;
  currentChannelProvider?: ChannelId;
  currentThreadTs?: string;
  currentMessageId?: string | number;
  replyToMode?: "off" | "first" | "all" | "batched";
  hasRepliedRef?: {
    value: boolean;
  };
  /** True when posting at the parent conversation root would leak a thread-originated reply. */
  sameChannelThreadRequired?: boolean;
  skipCrossContextDecoration?: boolean;
};
export type ChannelMessageActionDiscoveryContext = {
  cfg: OpenClawConfig;
  chatType?: ChatType | null;
  currentChannelId?: string | null;
  currentChannelProvider?: string | null;
  currentThreadTs?: string | null;
  currentMessageId?: string | number | null;
  accountId?: string | null;
  sessionKey?: string | null;
  sessionId?: string | null;
  agentId?: string | null;
  requesterSenderId?: string | null;
  senderIsOwner?: boolean;
};
export type ChannelMessageToolSchemaContribution = {
  properties: Record<string, TSchema>;
  /**
   * Actions whose validation depends on this schema fragment. Cross-channel
   * discovery can hide only these actions when the fragment is current-channel
   * scoped. Omit to keep the legacy conservative behavior.
   */
  actions?: readonly ChannelMessageActionName[] | null;
  visibility?: "current-channel" | "all-configured";
};
type ChannelMessageToolMediaSourceParams =
  | readonly string[]
  | Partial<Record<ChannelMessageActionName, readonly string[]>>;
export type ChannelMessageToolDiscovery = {
  actions?: readonly ChannelMessageActionName[] | null;
  capabilities?: readonly ChannelMessageCapability[] | null;
  schema?: ChannelMessageToolSchemaContribution | ChannelMessageToolSchemaContribution[] | null;
  /**
   * Plugin-owned message-tool params that carry media sources.
   * Core uses this to derive sandbox path normalization and host media-access
   * hints without hardcoding plugin-specific param names. Prefer scoping keys
   * by action so unrelated actions do not inherit another action's media args.
   */
  mediaSourceParams?: ChannelMessageToolMediaSourceParams | null;
};
export type ChannelMessageActionTargetAliasSpec = {
  aliases: string[];
  /** Alias fields that identify the destination conversation, not an existing message. */
  deliveryTargetAliases?: string[];
  /** Convert typed owner fields such as chatId into the canonical shared target shape. */
  resolveDeliveryTarget?: (params: { args: Record<string, unknown> }) => string | undefined;
  /**
   * Prove that provider-native aliases name the trusted current conversation.
   * Core consults this only for host-owned bundled registrations.
   */
  matchesCurrentConversation?: (params: {
    args: Record<string, unknown>;
    accountId: string;
    toolContext: ChannelThreadingToolContext;
  }) => boolean;
};
/**
 * Inbound turn context a channel projects into the message tool. Upstream
 * declares this in `src/channels/plugins/types.core.ts`; slice 9 carries the
 * fields the ported Telegram threading projector reads (D-CORE-236).
 */
export type ChannelThreadingContext = {
    Channel?: string;
    From?: string;
    To?: string;
    ChatType?: string;
    CurrentMessageId?: string | number;
    /** Effective channel reply mode prepared for this turn. */
    ReplyToMode?: "off" | "first" | "all" | "batched";
    ReplyToId?: string;
    ReplyToIdFull?: string;
    ThreadLabel?: string;
    MessageThreadId?: string | number;
    TransportThreadId?: string | number;
    /** Platform-native channel/conversation id (e.g. Slack DM channel "D…" id). */
    NativeChannelId?: string;
};

/** Canonical send fields a channel extracts from message-tool arguments. */
export type ChannelToolSend = {
    to: string;
    accountId?: string;
    threadId?: string;
    threadSuppressed?: boolean;
};

/** Outbound reply payload a channel may rewrite before the shared send runs. */
export type ChannelActionReplyPayload = {
    text?: string;
    presentation?: unknown;
    location?: unknown;
    videoAsNote?: boolean;
    channelData?: Record<string, unknown> & { telegram?: unknown };
    [key: string]: unknown;
};

export type ChannelMessageActionAdapter = {
  /**
   * Unified discovery surface for the shared `message` tool.
   * This returns the scoped actions,
   * capabilities, schema fragments, and any plugin-owned media-source params
   * together so they cannot drift.
   */
  describeMessageTool: (
    params: ChannelMessageActionDiscoveryContext,
  ) => ChannelMessageToolDiscovery | null | undefined;
  /** Delegate conversation-read authorization to this adapter for bundled registrations only. */
  providerOwnedReadGates?: true | readonly ChannelMessageActionName[];
  supportsAction?: (params: { action: ChannelMessageActionName }) => boolean;
  resolveExecutionMode?: (params: { action: ChannelMessageActionName }) => "local" | "gateway";
  resolveCliActionRequest?: (params: {
    action: ChannelMessageActionName;
    args: Record<string, unknown>;
  }) => {
    action: ChannelMessageActionName;
    args: Record<string, unknown>;
  };
  messageActionTargetAliases?: Partial<
    Record<ChannelMessageActionName, ChannelMessageActionTargetAliasSpec>
  >;
  requiresTrustedRequesterSender?: (params: {
    action: ChannelMessageActionName;
    toolContext?: ChannelThreadingToolContext;
  }) => boolean;
  /** Return true when a provider-native tool invocation has a visible or destructive side effect. */
  isToolDeliveryAction?: (params: { args: Record<string, unknown> }) => boolean;
  extractToolSend?: (params: { args: Record<string, unknown> }) => ChannelToolSend | null;
  /** Recover the actual resolved send route from a successful action result. */
  extractToolSendResult?: (params: {
    result: unknown;
    send: ChannelToolSend;
  }) => ChannelToolSend | null;
  /**
   * Translate generic `message(action=send)` arguments into the payload core
   * should persist, retry, recover, and ack. Return null to keep the legacy
   * plugin-owned action path for sends that cannot be represented durably.
   */
  prepareSendPayload?: (
    params: ChannelMessagePreparedSendPayloadContext,
  ) => ReplyPayload | null | undefined | Promise<ReplyPayload | null | undefined>;
  /**
   * Prefer this for channel-specific poll semantics or extra poll parameters.
   * Core only parses the shared poll model when falling back to `outbound.sendPoll`.
   */
  handleAction?: (ctx: ChannelMessageActionContext) => Promise<AgentToolResult<unknown>>;
};
/** Execution context passed to channel-owned actions on the shared `message` tool. */
export type ChannelMessageActionContext = {
  channel: ChannelId;
  action: ChannelMessageActionName;
  cfg: OpenClawConfig;
  params: Record<string, unknown>;
  reply?: OutboundReplyFacts;
  mediaAccess?: OutboundMediaAccess;
  mediaLocalRoots?: readonly string[];
  mediaReadFile?: (filePath: string) => Promise<Buffer>;
  accountId?: string | null;
  /** Trusted originating account id paired with requesterSenderId. */
  requesterAccountId?: string | null;
  /**
   * Trusted sender id from inbound context. This is server-injected and must
   * never be sourced from tool/model-controlled params.
   */
  requesterSenderId?: string | null;
  /** Trusted owner identity bit from command/channel-action auth. */
  senderIsOwner?: boolean;
  /**
   * Server-owned origin for this operation. Missing values are delegated.
   * Plugins must use it only for conversation-read visibility policy.
   */
  conversationReadOrigin?: ConversationReadInvocationOrigin;
  sessionKey?: string | null;
  sessionId?: string | null;
  inboundEventKind?: InboundEventKind;
  agentId?: string | null;
  gateway?: {
    url?: string;
    token?: string;
    timeoutMs?: number;
    clientName: GatewayClientName;
    clientDisplayName?: string;
    mode: GatewayClientMode;
  };
  toolContext?: ChannelThreadingToolContext;
  dryRun?: boolean;
  gatewayClientScopes?: readonly string[];
  /**
   * Server-owned fact: this caller receives proven-not-sent failures and resends
   * them. Plugins forward it into durable sends so recovery does not replay too.
   */
  deliveryRetryOwner?: "caller";
};
type ChannelMessagePreparedSendPayloadContext = {
  ctx: ChannelMessageActionContext;
  to: string;
  payload: ReplyPayload;
  replyToId?: string | null;
  /** Preserve caller intent when plugins translate reply ids into durable payloads. */
  replyToIdSource?: "explicit" | "implicit";
  threadId?: string | number | null;
};
/** Canonical reply routing a provider resolves for a threaded reply. */
export type ChannelReplyTransport = {
  replyToId?: string | null;
  threadId?: string | number | null;
};
/**
 * Threading adapter subset the ported message-action layer reads. Upstream's
 * `ChannelThreadingAdapter` also covers reply-to modes, tool-context building,
 * focused bindings and transcript routing, which the Hub owns.
 */
export type ChannelThreadingAdapter = {
  matchesToolContextTarget?: (params: {
    target: string;
    toolContext: ChannelThreadingToolContext;
  }) => boolean;
  resolveAutoThreadId?: (params: {
    cfg: OpenClawConfig;
    accountId?: string | null;
    to: string;
    toolContext?: ChannelThreadingToolContext;
    replyToId?: string | null;
  }) => string | undefined;
  resolveReplyTransport?: (params: {
    cfg: OpenClawConfig;
    accountId?: string | null;
    threadId?: string | number | null;
    replyToId?: string | null;
    /** True when replyToId came from an explicit payload target or reply tag. */
    replyToIsExplicit?: boolean;
    replyToCurrent?: boolean;
  }) => ChannelReplyTransport | null;
};
export type { ChannelOutboundAdapter };
/**
 * Channel plugin subset the message-tool schema/discovery layer reads. The full
 * upstream `ChannelPlugin` covers setup, pairing, approvals, and lifecycle and
 * stays out of this port.
 */
export type ChannelPlugin = {
  id: string;
  /** Upstream carries a much larger `meta`; only the alias list is read here. */
  meta?: {
    aliases?: readonly string[];
  };
  actions?: ChannelMessageActionAdapter;
  messaging?: {
    directTargetStyle?: "plain" | "user-prefixed";
    /** Provider-owned canonicalization of a raw target spelling. */
    normalizeTarget?: (raw: string) => string | undefined;
    /** Provider prefixes stripped before host conversation-target comparison. */
    targetPrefixes?: readonly string[];
    inferTargetChatType?: (params: { to: string }) => ChatType | string | undefined;
  };
  threading?: ChannelThreadingAdapter;
  /**
   * Upstream's full `ChannelOutboundAdapter` owns send/edit/media/poll transports.
   * Fusion's Hub owns delivery, so only the two slots the ported action layer
   * reads are declared: presentation capabilities and the delivery mode.
   */
  outbound?: ChannelOutboundAdapter;
  message?: {
    durableFinal?: {
      capabilities?: {
        reconcileUnknownSend?: boolean;
      };
      reconcileUnknownSend?: unknown;
    };
  };
};

// Slice 13 additions (Discord vertical port). Upstream declares these in
// `src/channels/plugins/types.core.ts`; the shapes are carried unchanged.

/** Base shape a channel's token resolution extends. */
export type BaseTokenResolution = {
  token: string;
  source: string;
};

export type ChannelDirectoryEntryKind = "user" | "group" | "channel";

export type ChannelDirectoryEntry = {
  kind: ChannelDirectoryEntryKind;
  id: string;
  name?: string;
  handle?: string;
  avatarUrl?: string;
  rank?: number;
  raw?: unknown;
};
