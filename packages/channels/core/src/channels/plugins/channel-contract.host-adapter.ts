// Fusion-owned host adapter for the probe / group / outbound context half of
// `src/channels/plugins/types.core.ts` and `outbound.types.ts` (D-CORE-252).
//
// Upstream declares these inside the plugin type universe the port stops at
// (D-CORE-010); they carry the full `OpenClawConfig`, the outbound delivery
// engine's durable-intent fields and the media load policy. The shapes below
// keep upstream's names, field names and doc comments for the fields the ported
// Slack probe / group-policy / outbound adapter reads, over the opaque host
// config, plus an open index signature for the rest.
import type { OpenClawConfig } from "./types.public.host-adapter.js";
import type { ReplyToMode } from "../../config/types.base.js";
import type { OutboundDeliveryFormattingOptions } from "../../infra/outbound/formatting.js";
import type { OutboundIdentity } from "../../infra/outbound/identity-types.js";
import type { OutboundSendDeps } from "../../infra/outbound/send-deps.js";
import type { OutboundMediaAccess } from "../../media/load-options.js";

/** Minimal base for all channel probe results. Channel-specific probes extend this. */
export type BaseProbeResult<TError = string | null> = {
  ok: boolean;
  error?: TError;
};

export type ChannelGroupContext = {
  cfg: OpenClawConfig;
  groupId?: string | null;
  /** Human label for channel-like group conversations (e.g. #general). */
  groupChannel?: string | null;
  groupSpace?: string | null;
  accountId?: string | null;
  /** Trusted host instruction to ignore toolsBySender for non-ingress work. */
  senderPolicyMode?: "always" | "never";
  senderId?: string | null;
  senderName?: string | null;
  senderUsername?: string | null;
  senderE164?: string | null;
};

export type ChannelOutboundContext = {
  cfg: OpenClawConfig;
  to: string;
  text: string;
  mediaUrl?: string;
  audioAsVoice?: boolean;
  mediaAccess?: OutboundMediaAccess;
  mediaLocalRoots?: readonly string[];
  mediaReadFile?: (filePath: string) => Promise<Buffer>;
  gifPlayback?: boolean;
  /** Send image, GIF, or video as document to avoid channel compression. */
  forceDocument?: boolean;
  replyToId?: string | null;
  replyToIdSource?: "explicit" | "implicit";
  replyToMode?: ReplyToMode;
  formatting?: OutboundDeliveryFormattingOptions;
  threadId?: string | number | null;
  accountId?: string | null;
  identity?: OutboundIdentity;
  deps?: OutboundSendDeps;
  silent?: boolean;
  gatewayClientScopes?: readonly string[];
  /** @internal Opaque durable intent id for exact provider-side send reconciliation. */
  deliveryQueueId?: string;
  /** @internal Stable platform-send index within one durable payload. */
  deliveryPartIndex?: number;
  /** @internal Exact platform-send count within one durable payload. */
  deliveryPartCount?: number;
  /** @internal Channel-valid id reserved before a correlated conversation turn is sent. */
  preparedMessageId?: string;
  /** @internal Refresh durable timing before recipient-visible or finalizing platform I/O. */
  onPlatformSendDispatch?: () => Promise<void>;
  /** @internal Synchronously fence custody after refresh and immediately before provider I/O. */
  assertDirectAdapterHandoff?: () => void;
  /** @internal Report each completed platform sub-send before starting another fallible step. */
  onDeliveryResult?: (result: unknown) => Promise<void> | void;
  [key: string]: unknown;
};
