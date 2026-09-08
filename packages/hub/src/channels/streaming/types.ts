// The Hub-side streaming producer's contracts (goal ledger slice 22b).
//
// Two objects, both Fusion-owned:
//
//  * `ChannelStreamingDriver` — one account's drivable streaming surface,
//    feature-detected off the loaded vertical's `plugin.outbound` (driver.ts).
//    It is deliberately channel-agnostic: the Hub never names a Slack or a
//    Telegram primitive outside `driver.ts`.
//  * `StreamingFinalizeTransport` — the relay's post transport for a scope
//    that has a live draft. The relay keeps owning the delivery ledger; the
//    transport only decides HOW the final text reaches the channel (finish the
//    native stream / edit the draft in place / post a fresh message).
import type { SyncStreaming } from "../config/schema.js";
import type {
  OutboundPostParams,
  OutboundPostResult,
  SupportedChannelName,
} from "../plane/types.js";

/** Upstream's `StreamingMode` (`extensions/slack/src/streaming-compat.ts`). */
export type ChannelStreamingMode = "off" | "partial" | "block" | "progress";

/** Where one draft lives: the conversation, and the thread when the reply is
 * anchored in one. Same addressing as `PostFn` — the relay resolves it once
 * (`replyLocationFor`) and hands it over. */
export interface StreamingDraftTarget {
  to: string;
  threadId?: string | undefined;
}

/** One line of a running turn's progress, in the ported compositor's shape
 * (`@getpaseo/channels-core` `ChannelProgressDraftLine`). The Hub produces the
 * snapshot itself — upstream's compositor factory reads OpenClaw agent events,
 * which this repo does not have (core D-CORE-403). */
export interface ChannelProgressLine {
  kind: "tool";
  text: string;
  label: string;
  status?: string | undefined;
  toolName?: string | undefined;
}

/** The platform-native append-only draft transport (Slack `chat.startStream` →
 * `chat.appendStream` → `chat.stopStream`). `session` is opaque: it is the
 * vertical's own handle, never inspected here. */
export interface NativeDraftTransport {
  start(params: StreamingDraftTarget & { text: string }): Promise<unknown>;
  append(params: { session: unknown; text: string }): Promise<void>;
  stop(params: { session: unknown; text: string }): Promise<{ messageId?: string | undefined }>;
}

/** The channel's draft caps and pacing. `maxDraftChars` is the platform's text
 * limit — a draft that outgrows it stops updating and finalizes as the
 * answer's FIRST message, with the remainder posted after it (upstream
 * `draft-stream.ts` rolls a draft over the same way). */
export interface StreamingLimits {
  maxDraftChars: number;
  minEditIntervalMs: number;
}

/** One account's drivable streaming surface. Every member past `channel`,
 * `limits` and `resolveMode` is optional: what is present is exactly what the
 * loaded vertical exposes. */
export interface ChannelStreamingDriver {
  readonly channel: SupportedChannelName;
  readonly limits: StreamingLimits;
  /** The route's authored `sync.streaming` → the effective mode. Absent config
   * is the org floor, `off`; anything else is resolved by the vertical's own
   * resolver when it exposes one, so an OpenClaw-authored account keeps
   * upstream's per-leaf defaults. */
  resolveMode(streaming: SyncStreaming | undefined): ChannelStreamingMode;
  /** True when the vertical's native transport may carry a `partial` draft. */
  nativeAllowed(streaming: SyncStreaming | undefined): boolean;
  native?: NativeDraftTransport | undefined;
  /** Edit a posted message in place — the draft's update path. */
  edit?:
    | ((
        params: StreamingDraftTarget & { externalMessageId: string; text: string },
      ) => Promise<void>)
    | undefined;
  /** Render a progress snapshot as the channel's native blocks (Slack Block
   * Kit). Absent = the progress message carries plain text. */
  progressBlocks?:
    | ((params: {
        title: string;
        lines: readonly ChannelProgressLine[];
        done: boolean;
      }) => Record<string, unknown>[] | undefined)
    | undefined;
}

/**
 * The relay's post transport for a scope that has a live draft. It is a
 * `PostFn`, so the relay swaps it in and keeps every other step of the
 * delivery unchanged: one ledger row recorded before the call, one confirm on
 * the returned message id.
 *
 * The transport OWNS its own fallback. When the draft cannot carry the answer
 * (a streaming call failed) it posts the whole answer through the plain post
 * path itself; when the answer merely outgrew the platform's text limit it
 * finalizes the draft as the answer's first message and posts the remainder.
 * Either way the relay never sees a "streaming failed" outcome and the full
 * reply is delivered exactly once, on one row.
 */
export type StreamingFinalizeTransport = (
  params: OutboundPostParams,
) => Promise<OutboundPostResult>;
