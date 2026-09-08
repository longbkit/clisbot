// The in-repo host contract — the seam surface the channel verticals code
// against (blueprint §6.5 hard rule 2: entry/plugin types are declared in-repo,
// never imported from OpenClaw). These shapes mirror the Hub's loader host
// (`packages/hub/src/channels/loader/host.ts`): the vertical's dist is driven
// in-process by the Hub, which hands it a HostRuntime through the entry's
// `setChannelRuntime` and receives inbound events through `onInboundReply`.
//
// The Hub's concrete runtime object is structurally compatible with this
// interface; the verticals never see OpenClaw types.

/** Minimal structured logger the host's `logging.getChildLogger` returns.
 * `warn` is the only required level; a vertical reads every level through
 * `?.`, so absent levels are a no-op, not a fault. */
export interface HostChildLogger {
  debug?: (message: string, meta?: unknown) => void;
  info?: (message: string, meta?: unknown) => void;
  warn: (message: string, meta?: unknown) => void;
  error?: (message: string, meta?: unknown) => void;
}

/** The normalized inbound event context (`ctxPayload`) — the FLAT shape from
 * `docs/audits/pinned-vertical-contracts/inbound.md`: `Body`, `ChatType`,
 * `ChatId`, `MessageSid`, `Timestamp`, `SenderId`, `WasMentioned`,
 * `MessageThreadId`, … No nested `conversation` object, no `messageId` key.
 * The Hub's plane normalizer reads the flat keys by name. */
export type ChannelInboundContext = Record<string, unknown> & {
  channel?: string;
  accountId?: string;
};

/** Full argument object of an `onInboundReply` handoff. */
export interface InboundReplyParams {
  channel: string;
  accountId: string;
  ctxPayload: ChannelInboundContext;
  [key: string]: unknown;
}

/** Result of an inbound handoff — the plane's accept result. `dispatched` is
 * the discriminant: true once the Hub has accepted the event (agent + relay
 * wired); false when the event was ignored or the runtime is not ready. */
export interface InboundReplyResult {
  dispatched: boolean;
  dispatchResult?: {
    queuedFinal: boolean;
    counts: Record<string, number>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** One durable keyed-store entry as `entries()` reports it. */
export interface KeyedStoreEntry<T> {
  key: string;
  value: T;
  createdAt: number;
  expiresAt?: number;
}

/** Per-write TTL override. */
export interface KeyedStoreTtlOptions {
  ttlMs?: number;
}

/** The async keyed store the vertical's durable per-key state uses (poll
 * offsets, dedupe caches, sent-message caches). The native OpenClaw
 * `PluginStateKeyedStore` surface — the Hub backs it with a per-account
 * JSON-file store (implementation doc §4.2). */
export interface HostKeyedStore<T = unknown> {
  register(key: string, value: T, opts?: KeyedStoreTtlOptions): Promise<void>;
  registerIfAbsent(key: string, value: T, opts?: KeyedStoreTtlOptions): Promise<boolean>;
  update(
    key: string,
    updateValue: (current: T | undefined) => T | undefined,
    opts?: KeyedStoreTtlOptions,
  ): Promise<boolean>;
  lookup(key: string): Promise<T | undefined>;
  consume(key: string): Promise<T | undefined>;
  delete(key: string): Promise<boolean>;
  entries(): Promise<KeyedStoreEntry<T>[]>;
  clear(): Promise<void>;
}

/** Options for opening a keyed-store namespace. */
export interface HostKeyedStoreOptions {
  namespace: string;
  maxEntries: number;
  overflowPolicy?: "evict-oldest" | "reject-new";
  defaultTtlMs?: number;
  env?: NodeJS.ProcessEnv;
}

/** A keyed-store root: one per account. */
export interface HostKeyedStoreRoot {
  openKeyedStore(options: HostKeyedStoreOptions): HostKeyedStore;
}

/** The inbound ledger sink the shared L3 monitor records into (blueprint §2.4:
 * the monitor writes the inbound row BEFORE the `onInboundReply` handoff and
 * marks it consumed when the dispatch settles). The Hub wires one backed by
 * its channel event ledger; a vertical running without a Hub (unit tests)
 * omits it — the monitor then skips the ledger steps. */
export interface InboundLedgerSink {
  /** Record the inbound event (dedupe on the external message id). Returns true
   * when THIS call created the row (first sight of the message); false when a
   * replay hit an existing row — the caller must NOT dispatch in that case. */
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

/** The host runtime the loader hands the channel via its setter. Exposes the
 * seam surface only. */
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
  /** The channel's normalized inbound event reached the Hub. The Hub returns
   * once the agent + relay have accepted the event. Never throws into the
   * channel — a throw here would be a channel fault. */
  onInboundReply(params: InboundReplyParams): Promise<InboundReplyResult>;
  /** `state.openKeyedStore` — the vertical's durable per-key state, persisted
   * under the account's state dir so a Hub restart keeps it. */
  state: HostKeyedStoreRoot;
  /** `logging.getChildLogger` — structured logger rooted at the vertical. */
  logging: {
    getChildLogger(options?: Record<string, unknown>): HostChildLogger;
    shouldLogVerbose?(): boolean;
  };
  /** `channel.<channel>.*` — per-channel host functions the vertical may call.
   * Absent members are no-ops in the vertical (all reads are optional). */
  channel: Record<string, Record<string, unknown>>;
  /** The inbound ledger sink (Hub-owned; absent outside a Hub). */
  inboundLedger?: InboundLedgerSink | undefined;
  /** Durable payload queue; when present it is preferred over ledger-only admission. */
  inboundQueue?: InboundQueueSink | undefined;
}

/** The runtime env a channel account's monitor receives. `exit` is present so
 * a vertical can request a clean stop; the Hub routes it to the supervisor. */
export interface ChannelAccountRuntimeEnv {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  exit: (code: number) => void;
}

/** Per-account context the control plane passes to `plugin.gateway.startAccount`.
 * `accountId` is required; `runtime` is the full env; `setStatus`/`getStatus`
 * are always supplied. The flat `account` carries the channel's native token
 * fields (`{accountId, botToken, appToken}` for Slack; `{accountId, token}`
 * for Telegram); `cfg.channels.<ch>.accounts.<id>` carries the token strings
 * the outbound path reads (docs/audits/pinned-vertical-contracts/start-account.md). */
export interface StartAccountContext {
  accountId: string;
  account: Record<string, unknown>;
  cfg: Record<string, unknown>;
  runtime: ChannelAccountRuntimeEnv;
  channelRuntime?: Record<string, unknown>;
  /** Account-scoped runtime supplied directly by the in-process Hub adapter.
   * The module-global setter remains a compatibility fallback only; it cannot
   * isolate concurrent accounts loaded from one cached ESM module. */
  hostRuntime?: HostRuntime;
  abortSignal: AbortSignal;
  setStatus: (status: unknown) => void;
  getStatus: () => unknown;
  log?: HostChildLogger;
  /** The directory the L2 transport downloads inbound media into
   * (group G: the account's `<dataDir>/channels/<accountId>/downloads`);
   * the Hub supervisor fills it. Absent = media not downloaded (the
   * transport folds the caption-only body). */
  mediaDownloadDir?: string;
  [key: string]: unknown;
}
