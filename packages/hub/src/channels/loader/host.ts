// The host runtime — the bound-subpath provider for a channel vertical. It is the
// single object OpenClaw's channel code reaches into the Hub through:
//
//   1. the runtime store the channel entry fills via its setter
//      (`setSlackRuntime` / `setTelegramRuntime`, a `createPluginRuntimeStore`
//      keyed by plugin id). The vertical reads `state.openKeyedStore`,
//      `logging.getChildLogger`, and `channel.<channel>.<fn>` off it.
//   2. the bound subpath `openclaw/plugin-sdk/channel-inbound`'s
//      `dispatchChannelInboundReply`, which the loader's resolve/load hooks
//      replace with a call back into `onInboundReply` here. That is the seam:
//      the channel's normalized inbound event arrives in-process and the Hub
//      drives the real agent + relay. OpenClaw's agent loop never loads.
//
// Everything else in the channel's import graph is pure SDK logic that stays
// OpenClaw's (passthrough). This module defines the seam surface only — no daemon
// or agent code path is reachable from it, so a channel fault cannot reach the
// daemon (plan §14.5 / P13).

import { createHostKeyedStoreRoot, type HostKeyedStoreRoot } from "../state/keyed-store.js";

/** The normalized inbound event the channel hands the host
 * (`dispatchChannelInboundReply`'s `ctxPayload`). Channel-specific, but always
 * carries `channel`, `accountId`, `messageId`, `timestamp`, `from`, `sender`,
 * `conversation`, `route`, `reply`, `message`, `access`, plus the SDK-flattened
 * `SessionKey` / `To` / `InboundEventKind` / `MessageThreadId` /
 * `TransportThreadId`. */
export type ChannelInboundContext = Record<string, unknown> & {
  channel?: string;
  accountId?: string;
};

/** Full argument object of a bound `dispatchChannelInboundReply` call. */
export interface InboundReplyParams {
  channel: string;
  accountId: string;
  agentId?: string;
  routeSessionKey?: string;
  ctxPayload: ChannelInboundContext;
  /** The channel's own outbound deliver callback (its `delivery.deliver`). The Hub
   * relay uses it to post replies natively; ignored by a host that drives the
   * relay itself. */
  delivery?: unknown;
  [key: string]: unknown;
}

/** Result a host returns for an inbound reply — OpenClaw's `ChannelTurnResult`
 * shape (verified on openclaw@2026.7.1-2): `dispatched` is the discriminant; on a
 * successful dispatch the turn's `dispatchResult` carries `queuedFinal` +
 * `counts` (the `DispatchFromConfigResult`). The vertical reads
 * `result.dispatched` + `result.dispatchResult.{queuedFinal, counts}`. */
export interface InboundReplyResult {
  dispatched: boolean;
  /** Present when `dispatched` is true. Mirrors OpenClaw's `DispatchFromConfigResult`. */
  dispatchResult?: {
    queuedFinal: boolean;
    counts: Record<string, number>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** The inbound ledger sink the in-repo verticals' shared L3 monitor records
 * into (packages/channels/shared host contract, blueprint §2.4): the monitor
 * writes the inbound row BEFORE the `onInboundReply` handoff and marks it
 * consumed when the dispatch settles. Hub-owned — the supervisor wires one
 * backed by the channel event ledger; absent, the monitor skips the ledger
 * steps. Structurally the same shape as the shared contract's
 * `InboundLedgerSink` (the Hub's concrete runtime is structurally compatible
 * with the shared host interface; the verticals never see Hub types). */
export interface InboundLedgerSink {
  /** Record the inbound event (dedupe on the external message id). `created`
   * is true when THIS call created the row; false on a replay hit — the
   * monitor must NOT dispatch in that case. */
  record(params: {
    channel: string;
    accountId: string;
    externalConversationId: string;
    externalMessageId: string;
    senderIdentity?: string;
  }): Promise<{ created: boolean }>;
  /** Mark the recorded event consumed, referencing the plane's turn. */
  consume(params: {
    channel: string;
    accountId: string;
    externalConversationId: string;
    externalMessageId: string;
    turnId: string;
  }): Promise<void>;
}

/** Minimal structured logger OpenClaw's `logging.getChildLogger` returns. */
export interface HostChildLogger {
  debug?: (message: string, meta?: unknown) => void;
  info?: (message: string, meta?: unknown) => void;
  warn: (message: string, meta?: unknown) => void;
  error?: (message: string, meta?: unknown) => void;
}

/** The bound outbound seam for a channel. P0 conformance is transport-level
 * (the vertical's own send adapter posts to the provider API), so this is the
 * relay's hook-in point and may be absent until the control plane wires it. */
export interface ChannelHostOutbound {
  sendMessage?: (params: {
    to: string;
    text: string;
    threadId?: string;
    [key: string]: unknown;
  }) => Promise<{ ok: boolean; [key: string]: unknown }>;
}

/** The host runtime object the loader hands the channel via its setter and the
 * bound subpaths call back into. Exposes ONLY the seam surface. */
/** Hub-owned durable inbound queue. Admission retains the normalized payload;
 * claims provide per-lane serialization and crash fencing. */
/** One durably admitted event, leased to a single drain worker. */
export interface InboundQueueClaim {
  id: string;
  claimToken: string;
  payload: unknown;
  /** Per-conversation serialization key the claim holds while the lease lives. */
  laneKey: string;
  /** Attempts consumed, including this claim. */
  attempts: number;
  /** Durable admission time — the retry policy's dead-letter age clock. */
  receivedAt: Date;
}

export interface InboundQueueSink {
  enqueue(params: {
    channel: string;
    accountId: string;
    externalEventId: string;
    externalMessageId: string;
    externalConversationId: string;
    externalThreadId?: string | null;
    laneKey: string;
    payload: unknown;
  }): Promise<{ created: boolean; id: string }>;
  claim(params: {
    organizationId: string;
    workerId: string;
    leaseMs: number;
    channel: string;
    accountId: string;
  }): Promise<InboundQueueClaim | undefined>;
  complete(params: { id: string; workerId: string; claimToken: string }): Promise<void>;
  refresh?(params: {
    id: string;
    workerId: string;
    claimToken: string;
    leaseMs: number;
  }): Promise<boolean>;
  /** Settle a claim that did not deliver. The drain owns the decision (the
   * ported upstream ingress retry policy for `retry`/`dead-letter`, the plane's
   * back-pressure for `release`); the sink only writes it. `release` returns
   * the row unattempted, so back-pressure never spends retry budget. */
  fail(params: {
    id: string;
    workerId: string;
    claimToken: string;
    error: string;
    disposition: "retry" | "dead-letter" | "release";
    reason?: string;
    retryAt?: Date;
  }): Promise<void>;
  recover?(params: {
    organizationId: string;
    channel?: string;
    accountId?: string;
  }): Promise<number>;
}

export interface HostRuntime {
  /** Bound seam: the channel's normalized inbound event reached the Hub. The Hub
   * returns once the agent + relay have accepted the event (P0: record + accept).
   * Never throws into the channel — a throw here would be a channel fault. */
  onInboundReply(params: InboundReplyParams): Promise<InboundReplyResult>;
  /** `state.openKeyedStore` / `state.openSyncKeyedStore` — the vertical's
   * durable per-key state (poll offsets, dedupe caches), persisted under the
   * account's channel dir so a Hub restart keeps it (state/keyed-store.ts). */
  state: HostKeyedStoreRoot;
  /** `logging.getChildLogger` — structured logger rooted at the vertical. */
  logging: {
    getChildLogger(options?: Record<string, unknown>): HostChildLogger;
    shouldLogVerbose?(): boolean;
  };
  /** `channel.<channel>.*` — per-channel host functions the vertical may call
   * (action handling, outbound). Absent members are no-ops in the vertical
   * (all reads are optional). */
  channel: Record<string, Record<string, unknown>>;
  /** Outbound relay hook (P0: transport-level send is the vertical's own; this is
   * where the Hub relay posts final answers). May be undefined pre-wiring. */
  outbound?: ChannelHostOutbound;
  /** The inbound ledger sink (Hub-owned; the in-repo verticals' shared L3
   * monitor records/consumes inbound rows through it). Absent = the monitor
   * skips the ledger steps. */
  inboundLedger?: InboundLedgerSink | undefined;
  /** Durable payload queue; when present it is preferred over ledger-only admission. */
  inboundQueue?: InboundQueueSink | undefined;
}

/** The OpenClaw `RuntimeEnv` a channel account's monitor receives (verified on
 * openclaw@2026.7.1-2): variadic `log`/`error` + a process `exit`. The Hub's
 * monitor supplies all three; `exit` is present so a vertical can request a
 * clean stop, and the control plane routes it to the supervisor. */
export interface ChannelAccountRuntimeEnv {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  exit: (code: number) => void;
}

/** Per-account context the control plane passes to `plugin.gateway.startAccount`
 * (verified shape on the pinned verticals). `accountId` is required; `runtime` is
 * the full OpenClaw `RuntimeEnv`; `setStatus`/`getStatus` are always supplied.
 * `channelRuntime` is deliberately open (one index-signature level) so a new
 * vertical's channel-specific surface — e.g. Telegram's
 * `channel.<id>.messageActions.resolveExecutionMode` — fits without a second
 * narrowing pass. Constructed per account by the bindings/relay writers, not the
 * loader. */
export interface StartAccountContext {
  accountId: string;
  account: Record<string, unknown>;
  cfg: Record<string, unknown>;
  runtime: ChannelAccountRuntimeEnv;
  /** Open channel-specific runtime surface; P0 carries
   * `session.resolveEntryResetFreshness`, wider verticals add their own keys. */
  channelRuntime?: Record<string, unknown>;
  hostRuntime?: HostRuntime;
  abortSignal: AbortSignal;
  setStatus: (status: unknown) => void;
  getStatus: () => unknown;
  log?: HostChildLogger;
  /** Mirror of the shared host contract's `mediaDownloadDir` (group G): the
   * account's inbound-media download dir
   * (`<dataDir>/channels/<accountId>/downloads`); the supervisor fills it. */
  mediaDownloadDir?: string;
  [key: string]: unknown;
}

/** Build a host runtime. `onInboundReply` is the required seam; the rest are
 * safe defaults so a vertical reads them without the control plane having wired
 * real state yet. `state` is the account's keyed-store root — the coordinate
 * module passes a file-backed root (the account's state dir); omit it for an
 * in-memory root (load-time fixtures). */
export function createHostRuntime(options: {
  onInboundReply: (params: InboundReplyParams) => Promise<InboundReplyResult>;
  channel?: Record<string, Record<string, unknown>>;
  outbound?: ChannelHostOutbound;
  state?: HostKeyedStoreRoot;
  /** The vertical's child logger; the control plane routes it to the Hub's
   * structured logger. The default is silent on EVERY level — a vertical reads
   * `ctx.log?.info(...)` et al., so a level that is absent (not just quiet)
   * crashes the monitor. */
  childLogger?: (options?: Record<string, unknown>) => HostChildLogger;
  /** The inbound ledger sink (Hub-owned). Omitted until the supervisor wires
   * one over the channel event ledger. */
  inboundLedger?: InboundLedgerSink;
  inboundQueue?: InboundQueueSink;
}): HostRuntime {
  const silentLogger: HostChildLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return {
    onInboundReply: options.onInboundReply,
    state: options.state ?? createHostKeyedStoreRoot(),
    logging: {
      getChildLogger: options.childLogger ?? (() => silentLogger),
      shouldLogVerbose: () => false,
    },
    channel: options.channel ?? {},
    ...(options.outbound !== undefined ? { outbound: options.outbound } : {}),
    ...(options.inboundLedger !== undefined ? { inboundLedger: options.inboundLedger } : {}),
    ...(options.inboundQueue !== undefined ? { inboundQueue: options.inboundQueue } : {}),
  };
}

/** The default P0 inbound handler: record + accept, drive nothing (the relay is
 * not wired yet). Used until the control plane supplies the real one. */
export function recordingInboundHandler(
  sink: (params: InboundReplyParams) => void,
): (params: InboundReplyParams) => Promise<InboundReplyResult> {
  return async (params) => {
    sink(params);
    return {
      dispatched: true,
      dispatchResult: { queuedFinal: false, counts: {} },
    };
  };
}
