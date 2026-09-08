// Feature-detection: the loaded vertical's `plugin.outbound` → one account's
// `ChannelStreamingDriver`. This is the ONLY Hub module that names a channel's
// own primitives; everything downstream drives the channel-agnostic contract.
//
// The Slack names are upstream's, exposed verbatim on `slackPlugin.outbound`
// (`extensions/slack/src/streaming.ts`, `streaming-compat.ts`,
// `progress-blocks.ts`). The edit-in-place path is the drive verb both
// verticals already publish (`outbound.updateText`), so Telegram streams
// through the same producer without a Telegram-specific branch.
import type { HostRuntime } from "@getpaseo/channels-shared";
import type { SyncStreaming } from "../config/schema.js";
import type { SupportedChannelName, PlaneLogger } from "../plane/types.js";
import type {
  ChannelProgressLine,
  ChannelStreamingDriver,
  ChannelStreamingMode,
  NativeDraftTransport,
  StreamingLimits,
} from "./types.js";

/** Per-channel draft caps. The char caps are the platforms' text limits
 * (Slack `SLACK_TEXT_LIMIT`, Telegram's 4096-char message body, Discord's
 * 2000-char message — `chunk.ts` DEFAULT_MAX_CHARS); the interval is upstream's
 * draft-stream default (`draft-stream.ts` DEFAULT_THROTTLE_MS), which is also
 * the rate Telegram's editMessageText tolerates for a single conversation. */
const STREAMING_LIMITS: Record<SupportedChannelName, StreamingLimits> = {
  slack: { maxDraftChars: 8_000, minEditIntervalMs: 1_000 },
  telegram: { maxDraftChars: 4_096, minEditIntervalMs: 1_000 },
  discord: { maxDraftChars: 2_000, minEditIntervalMs: 1_000 },
  // Google Chat's 4096-char message body; Feishu's 10 KB text-message cap
  // (`send.ts` chunking); Zalo's 2000-char `sendMessage` body. None of the three
  // publishes an edit-in-place drive verb yet, so the limits only bound a draft
  // the day their vertical does — the driver returns `undefined` for them today.
  googlechat: { maxDraftChars: 4_096, minEditIntervalMs: 1_000 },
  feishu: { maxDraftChars: 10_000, minEditIntervalMs: 1_000 },
  zalo: { maxDraftChars: 2_000, minEditIntervalMs: 1_000 },
  // Zalo Personal's own chunk limit (`ZALOUSER_TEXT_CHUNK_LIMIT`). It publishes
  // no edit-in-place drive verb either, so the driver returns `undefined`.
  zalouser: { maxDraftChars: 2_000, minEditIntervalMs: 1_000 },
};

type OutboundSurface = Record<string, unknown>;

function fn(outbound: OutboundSurface, name: string): ((args: never) => unknown) | undefined {
  const value = outbound[name];
  return typeof value === "function" ? (value as (args: never) => unknown) : undefined;
}

export interface StreamingDriverDeps {
  channel: SupportedChannelName;
  accountId: string;
  /** The drive-time token context — the same `cfg` the post path passes. */
  cfg: Record<string, unknown>;
  hostRuntime: HostRuntime;
  outbound: OutboundSurface | undefined;
  logger: PlaneLogger;
}

/**
 * Build the account's streaming driver, or `undefined` when the vertical
 * exposes nothing drivable (no native transport and no in-place edit) — the
 * relay then keeps its final-only post path, byte-identical to today.
 */
export function createStreamingDriver(
  deps: StreamingDriverDeps,
): ChannelStreamingDriver | undefined {
  const outbound = deps.outbound;
  if (outbound === undefined) return undefined;
  const native = nativeTransportOf(deps, outbound);
  const edit = editOf(deps, outbound);
  if (native === undefined && edit === undefined) return undefined;
  const progressBlocks = progressBlocksOf(outbound);
  return {
    channel: deps.channel,
    limits: STREAMING_LIMITS[deps.channel],
    resolveMode: modeResolverOf(outbound),
    nativeAllowed: nativeAllowedOf(outbound),
    ...(native === undefined ? {} : { native }),
    ...(edit === undefined ? {} : { edit }),
    ...(progressBlocks === undefined ? {} : { progressBlocks }),
  };
}

/** `sync.streaming` → the effective mode. Absent config is the org floor
 * (`off`) and never reaches the vertical; anything authored is resolved by the
 * vertical's own resolver when it publishes one, so upstream owns the per-leaf
 * defaults (an authored block with no `mode` is upstream's `progress`). */
function modeResolverOf(
  outbound: OutboundSurface,
): (streaming: SyncStreaming | undefined) => ChannelStreamingMode {
  const resolve = fn(outbound, "resolveSlackStreamingMode");
  return (streaming) => {
    if (streaming === undefined) return "off";
    if (resolve === undefined) return streaming.mode ?? "progress";
    return (resolve as (args: { streaming: SyncStreaming }) => ChannelStreamingMode)({ streaming });
  };
}

/** Whether a `partial` draft may use the platform-native transport. */
function nativeAllowedOf(
  outbound: OutboundSurface,
): (streaming: SyncStreaming | undefined) => boolean {
  const resolve = fn(outbound, "resolveSlackNativeStreaming");
  return (streaming) => {
    if (streaming === undefined) return false;
    if (resolve === undefined) return streaming.nativeTransport === true;
    return (resolve as (args: { streaming: SyncStreaming }) => boolean)({ streaming });
  };
}

/**
 * The native append-only transport, from upstream's three stream primitives.
 * `stop` appends the tail first: `chat.stopStream` finalizes what the stream
 * already carries, it does not take the answer text.
 */
function nativeTransportOf(
  deps: StreamingDriverDeps,
  outbound: OutboundSurface,
): NativeDraftTransport | undefined {
  const start = fn(outbound, "startSlackStream");
  const append = fn(outbound, "appendSlackStream");
  const stop = fn(outbound, "stopSlackStream");
  if (start === undefined || append === undefined || stop === undefined) return undefined;
  const base = { cfg: deps.cfg, hostRuntime: deps.hostRuntime, accountId: deps.accountId };
  const call = <T>(target: (args: never) => unknown, args: object): Promise<T> =>
    Promise.resolve(target({ ...base, ...args } as never) as T);
  return {
    start: async (params) =>
      await call<unknown>(start, {
        channel: params.to,
        threadTs: params.threadId,
        text: params.text,
      }),
    append: async (params) => {
      await call<void>(append, { session: params.session, text: params.text });
    },
    stop: async (params) => {
      if (params.text !== "")
        await call<void>(append, { session: params.session, text: params.text });
      const result = await call<{ messageId?: unknown } | undefined>(stop, {
        session: params.session,
      });
      const messageId = result?.messageId;
      return typeof messageId === "string" ? { messageId } : {};
    },
  };
}

/** The draft's edit path: the drive verb both verticals publish. */
function editOf(
  deps: StreamingDriverDeps,
  outbound: OutboundSurface,
): ChannelStreamingDriver["edit"] {
  const update = fn(outbound, "updateText");
  if (update === undefined) return undefined;
  return async (params) => {
    await Promise.resolve(
      update({
        cfg: deps.cfg,
        hostRuntime: deps.hostRuntime,
        accountId: deps.accountId,
        to: params.to,
        ...(params.threadId === undefined ? {} : { threadId: params.threadId }),
        externalMessageId: params.externalMessageId,
        text: params.text,
        // The draft carries no interactive markup, so nothing must be stripped
        // — `clearCard: true` (the approval card's default) would blank the
        // blocks of every draft edit.
        clearCard: false,
      } as never),
    );
  };
}

/** The progress card renderer, when the vertical ships upstream's Block Kit
 * builder. Absent (Telegram) = the progress message stays plain text. */
function progressBlocksOf(outbound: OutboundSurface): ChannelStreamingDriver["progressBlocks"] {
  const build = fn(outbound, "buildSlackProgressCardBlocks");
  if (build === undefined) return undefined;
  return (params) => {
    const blocks = (
      build as (args: {
        state: "working" | "success";
        title: string;
        lines: readonly ChannelProgressLine[];
      }) => unknown
    )({
      state: params.done ? "success" : "working",
      title: params.title,
      lines: params.lines,
    });
    return Array.isArray(blocks) ? (blocks as Record<string, unknown>[]) : undefined;
  };
}
