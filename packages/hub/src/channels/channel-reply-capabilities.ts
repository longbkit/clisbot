import { createHash, randomBytes } from "node:crypto";
import type { ChannelReplyBindingRef } from "./plane/types.js";
import type { ChannelAccountScope } from "./message-actions.js";
import { isSupportedChannel } from "./catalog.js";

/**
 * A server-owned Channel reply capability. The opaque token is the only value
 * placed in an Agent's MCP URL; every routing and authorization fact stays
 * server-side, in memory for the running process and in
 * `channel_reply_capabilities` for the next one.
 */
export interface ChannelReplyOutputBudget {
  executionId: string;
  type: string;
  max?: number | undefined;
}

export interface ChannelReplyCapability {
  organizationId: string;
  channelRevisionId: string | null;
  routePosition: number | "fallback";
  routeFingerprint: string;
  ref: ChannelReplyBindingRef;
  projectRoot?: string | undefined;
  outputBudget?: ChannelReplyOutputBudget | undefined;
  /** The NATIVE id of the sender whose message opened this thread (Slack
   * `U…`, Telegram user id) — the capability's requester.
   *
   * Two consumers need it and neither may take it from the model: the ported
   * executors that enforce channel-local trust read it as `requesterSenderId`,
   * and a command button posted by this Agent is minted for exactly this actor
   * (`command-buttons.ts`). It is the plane's `senderIdentity` with its
   * `<channel>:` prefix removed, because that is the form the inbound callback
   * reports back as `actorId`.
   *
   * Not persisted: the durable row (`channel_reply_capabilities`) carries no
   * sender column yet, so a capability restored after a Hub restart has none
   * and both consumers fail closed rather than guess. */
  requesterSenderId?: string | undefined;
  /**
   * The channel-native id of the inbound message this turn is answering
   * (Telegram message id, Slack `ts`).
   *
   * The ported message tool treats it as the CURRENT message: `react` with no
   * `messageId` targets it, and a delegated mutation of it needs no stored
   * provider observation because the id is the Hub's, not the model's
   * (`telegram/src/message-topic-binding.ts`). Restamped per turn beside
   * `turnId`; without it the model has to guess an id out of the prompt and
   * `react` answers `missing_message_id`.
   *
   * Not persisted, for the same reason as `turnId`: it belongs to the turn.
   */
  requesterMessageId?: string | undefined;
  /**
   * The plane's id for the turn this capability is answering right now — the
   * binding engine's per-inbound execution/lease id, restamped by `noteTurn`
   * on every follow-up.
   *
   * The token is minted once per session and the Agent keeps the same MCP URL
   * for every later turn, so this is the only per-turn fact a tool call can
   * read. The delivery ledger namespaces the model's `idempotencyKey` by it:
   * without it turn 2's `reply-1` read turn 1's posted row and the reply was
   * never posted (`channel-reply-send.ts`).
   *
   * Not persisted: a turn belongs to the process that is running it, and a
   * capability restored after a restart is re-stamped by the next inbound.
   */
  turnId?: string | undefined;
  /** Null until the create RPC returns; see `resolve`. */
  agentId: string | null;
  expiresAt: number;
}

export interface ChannelReplyCapabilityInput {
  organizationId: string;
  channelRevisionId: string | null;
  routePosition: number | "fallback";
  routeFingerprint: string;
  ref: ChannelReplyBindingRef;
  projectRoot?: string | undefined;
  outputBudget?: ChannelReplyOutputBudget | undefined;
  requesterSenderId?: string | undefined;
  /** The inbound message the turn is answering (see
   * `ChannelReplyCapability.requesterMessageId`). */
  requesterMessageId?: string | undefined;
  /** The turn that minted the capability (see `ChannelReplyCapability.turnId`). */
  turnId?: string | undefined;
  /** Channel-path output ceiling for one turn; absent = the registry default. */
  turnOutputMax?: number | undefined;
}

/** The organization-scoped account a capability speaks for. Two tenants can
 * name the same account id, so the vertical's adapter, its drive-time cfg and
 * the cached tool schema are all looked up under all three facts. */
export function accountScope(capability: ChannelReplyCapability): ChannelAccountScope {
  return {
    organizationId: capability.organizationId,
    channel: capability.ref.channel,
    accountId: capability.ref.accountId,
  };
}

/** The native sender id inside a plane identity (`slack:U123` -> `U123`). The
 * prefix is applied once, where the vertical's payload becomes an
 * `InboundMessage` (`supervisor/index.ts`), so this is its only inverse. */
export function nativeSenderId(channel: string, senderIdentity: string): string {
  const prefix = `${channel}:`;
  return senderIdentity.startsWith(prefix) ? senderIdentity.slice(prefix.length) : senderIdentity;
}

interface PendingChannelReplyCapability extends Omit<ChannelReplyCapability, "agentId"> {
  agentId: string | null;
  /** Channel-path output accounting for `turnId`, reset when the turn changes. */
  turn: { posted: number; inFlight: number; max: number };
  /** The `expiresAt` the durable row holds, so the sliding TTL writes rarely. */
  persistedExpiresAt: number;
}

/** One durable row: the token's verifier plus the capability's flat facts. */
export interface ChannelReplyCapabilityRow {
  tokenHash: string;
  organizationId: string;
  channelRevisionId: string | null;
  routePosition: string;
  routeFingerprint: string;
  channel: string;
  accountId: string;
  externalConversationId: string;
  externalThreadId: string | null;
  projectRoot: string | null;
  requesterSenderId: string | null;
  outputBudget: ChannelReplyOutputBudget | null;
  agentId: string | null;
  expiresAt: Date;
}

/** The persistence seam the registry writes through (`db/channel-reply-capabilities.ts`). */
export interface ChannelReplyCapabilityBackend {
  listActive(now: Date): Promise<ChannelReplyCapabilityRow[]>;
  save(row: ChannelReplyCapabilityRow): Promise<void>;
  bind(tokenHash: string, agentId: string): Promise<void>;
  deleteTokens(tokenHashes: readonly string[]): Promise<void>;
  deleteAccount(organizationId: string, channel: string, accountId: string): Promise<void>;
  deleteExpired(now: Date): Promise<void>;
}

const DEFAULT_CHANNEL_REPLY_CAPABILITY_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
/**
 * How many messages one turn may post through the `message` tool when the
 * capability carries no durable output budget — the channel binding path,
 * whose turns have no `agent_executions` row to spend a ceiling against.
 *
 * High enough that no answer (a reply plus its attachments, a correction, a
 * follow-up card) meets it, low enough that a looping Agent stops filling a
 * conversation. The durable budget still owns the automation path.
 */
export const DEFAULT_CHANNEL_REPLY_TURN_OUTPUT_MAX = 50;

export interface ChannelReplyCapabilityLogger {
  warn(message: string, detail?: Record<string, unknown>): void;
  info?(message: string, detail?: Record<string, unknown>): void;
}

export interface ChannelReplyCapabilityRegistryOptions {
  now?: (() => number) | undefined;
  ttlMs?: number | undefined;
  token?: (() => string) | undefined;
  turnOutputMax?: number | undefined;
  store?: ChannelReplyCapabilityBackend | undefined;
  logger?: ChannelReplyCapabilityLogger | undefined;
}

/** One reserved channel-path output for the capability's current turn. */
export interface ChannelReplyTurnOutput {
  /** The message landed: it spends one of the turn's outputs. */
  complete(): void;
  /** The message did not land: hand the reservation back. */
  fail(): void;
}

export interface ChannelReplyCapabilityService {
  issue(input: ChannelReplyCapabilityInput): string;
  bind(token: string, agentId: string): boolean;
  resolve(token: string, organizationId: string): ChannelReplyCapability | undefined;
  /**
   * Point the Agent's capabilities at the turn now running. Every inbound that
   * steers a bound session calls this before the prompt goes out; the tool's
   * delivery keys and its output ceiling are scoped by it.
   */
  noteTurn(agentId: string, turnId: string, requesterMessageId?: string): void;
  /**
   * Reserve one output against the current turn's ceiling. `undefined` means
   * the capability is gone or the turn has spent its ceiling — either way the
   * call must not post.
   */
  reserveTurnOutput(token: string): ChannelReplyTurnOutput | undefined;
  revoke(token: string): void;
  revokeAccount(organizationId: string, channel: string, accountId: string): void;
  /** Load the durable capabilities this process must keep answering. */
  hydrate?(): Promise<void>;
  /** Await every queued durable write; rethrows the first failure. */
  flush?(): Promise<void>;
}

/** The token's server-side verifier — the value that rests in the database. */
export function channelReplyCapabilityHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/**
 * Owner of the Channel reply capabilities, keyed by the token's verifier.
 *
 * Reads are synchronous because the MCP endpoint answers on the request path,
 * so the map is the process's copy of the table: `hydrate()` fills it at boot
 * and every mutation is mirrored write-behind. Without the durable half a Hub
 * restart left every Agent holding a dead capability — the daemon keeps the MCP
 * URL it was created with, and `tools/call` answered "unknown, expired, or
 * revoked" for the rest of that Agent's life (D-W4-01).
 */
export class ChannelReplyCapabilityRegistry implements ChannelReplyCapabilityService {
  private readonly capabilities = new Map<string, PendingChannelReplyCapability>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly token: () => string;
  private readonly turnOutputMax: number;
  private readonly store: ChannelReplyCapabilityBackend | undefined;
  private readonly logger: ChannelReplyCapabilityLogger | undefined;
  private pending: Promise<void> = Promise.resolve();
  private failure: unknown;

  constructor(options: ChannelReplyCapabilityRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_CHANNEL_REPLY_CAPABILITY_TTL_MS;
    this.token = options.token ?? (() => randomBytes(32).toString("base64url"));
    this.turnOutputMax = options.turnOutputMax ?? DEFAULT_CHANNEL_REPLY_TURN_OUTPUT_MAX;
    this.store = options.store;
    this.logger = options.logger;
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) {
      throw new Error("Channel reply capability ttlMs must be positive");
    }
  }

  /** Boot rehydration: adopt the stored capabilities, drop the expired rows. */
  async hydrate(): Promise<void> {
    if (this.store === undefined) return;
    const now = new Date(this.now());
    const rows = await this.store.listActive(now);
    let restored = 0;
    for (const row of rows) {
      const capability = fromRow(row, this.turnOutputMax);
      if (capability === undefined) continue;
      this.capabilities.set(row.tokenHash, capability);
      restored += 1;
    }
    await this.store.deleteExpired(now);
    this.logger?.info?.("channel reply capabilities restored", { restored, rows: rows.length });
  }

  issue(input: ChannelReplyCapabilityInput): string {
    this.pruneExpired();
    let token = this.token();
    let hash = channelReplyCapabilityHash(token);
    while (token === "" || this.capabilities.has(hash)) {
      token = this.token();
      hash = channelReplyCapabilityHash(token);
    }
    const expiresAt = this.now() + this.ttlMs;
    const capability: PendingChannelReplyCapability = {
      ...input,
      ref: { ...input.ref },
      ...(input.outputBudget === undefined ? {} : { outputBudget: { ...input.outputBudget } }),
      agentId: null,
      turn: { posted: 0, inFlight: 0, max: input.turnOutputMax ?? this.turnOutputMax },
      expiresAt,
      persistedExpiresAt: expiresAt,
    };
    this.capabilities.set(hash, capability);
    this.persist("issue", (store) => store.save(toRow(hash, capability)));
    return token;
  }

  /** Bind once to the Agent created with this token. Rebinding to another Agent fails closed. */
  bind(token: string, agentId: string): boolean {
    const hash = channelReplyCapabilityHash(token);
    const capability = this.active(hash);
    if (capability === undefined || agentId === "") return false;
    if (capability.agentId !== null && capability.agentId !== agentId) return false;
    capability.agentId = agentId;
    this.persist("bind", (store) => store.bind(hash, agentId));
    return true;
  }

  /**
   * Resolve a capability for one MCP request.
   *
   * An unbound capability resolves too. The Agent dials the MCP URL as soon as
   * the daemon starts it, which is BEFORE `createAgent` returns and the Hub can
   * bind — refusing the pending window meant `tools/list` answered an empty
   * list at session start and the Agent went the whole session with no way to
   * reply (live 2026-09-07: agent b33fd0d6 reported "the required
   * `channel_reply` message tool isn't available"). The token is the bearer
   * credential and a failed create revokes it, so the binding is a record of
   * WHICH Agent holds the capability, not the thing that authorizes the call.
   */
  resolve(token: string, organizationId: string): ChannelReplyCapability | undefined {
    const hash = channelReplyCapabilityHash(token);
    const capability = this.active(hash);
    if (capability === undefined || capability.organizationId !== organizationId) {
      return undefined;
    }
    this.slide(hash, capability);
    const { turn: _turn, persistedExpiresAt: _persisted, ...snapshot } = capability;
    return {
      ...snapshot,
      ref: { ...capability.ref },
      ...(capability.outputBudget === undefined
        ? {}
        : { outputBudget: { ...capability.outputBudget } }),
      agentId: capability.agentId,
    };
  }

  /**
   * Restamp the Agent's capabilities with the turn now running and give that
   * turn a fresh output ceiling. Silent for an Agent this process holds no
   * capability for: not every session is a channel session.
   */
  noteTurn(agentId: string, turnId: string, requesterMessageId?: string): void {
    if (agentId === "" || turnId === "") return;
    for (const capability of this.capabilities.values()) {
      if (capability.agentId !== agentId || capability.turnId === turnId) continue;
      capability.turnId = turnId;
      // The current message moves with the turn: the tool's `react` default and
      // the current-message mutation shortcut both read it.
      capability.requesterMessageId = requesterMessageId;
      capability.turn = { posted: 0, inFlight: 0, max: capability.turn.max };
    }
  }

  reserveTurnOutput(token: string): ChannelReplyTurnOutput | undefined {
    const capability = this.active(channelReplyCapabilityHash(token));
    if (capability === undefined) return undefined;
    const turn = capability.turn;
    if (turn.posted + turn.inFlight >= turn.max) return undefined;
    turn.inFlight += 1;
    let settled = false;
    const settle = (posted: boolean): void => {
      if (settled) return;
      settled = true;
      turn.inFlight -= 1;
      if (posted) turn.posted += 1;
    };
    return { complete: () => settle(true), fail: () => settle(false) };
  }

  revoke(token: string): void {
    const hash = channelReplyCapabilityHash(token);
    this.capabilities.delete(hash);
    this.persist("revoke", (store) => store.deleteTokens([hash]));
  }

  /**
   * Drop an account's capabilities for good. The supervisor calls this only
   * when the account's policy is replaced: a plain stop (Hub shutdown, monitor
   * fault) must leave the rows in place, or the restart is back to D-W4-01.
   */
  revokeAccount(organizationId: string, channel: string, accountId: string): void {
    for (const [hash, capability] of this.capabilities) {
      if (
        capability.organizationId === organizationId &&
        capability.ref.channel === channel &&
        capability.ref.accountId === accountId
      ) {
        this.capabilities.delete(hash);
      }
    }
    this.persist("revoke_account", (store) =>
      store.deleteAccount(organizationId, channel, accountId),
    );
  }

  async flush(): Promise<void> {
    await this.pending;
    if (this.failure === undefined) return;
    const failure = this.failure;
    this.failure = undefined;
    throw failure;
  }

  /** Queue one durable write; a failure is logged and kept for `flush`. */
  private persist(
    operation: string,
    write: (store: ChannelReplyCapabilityBackend) => Promise<void>,
  ): void {
    const store = this.store;
    if (store === undefined) return;
    this.pending = this.pending.then(() => this.runWrite(operation, write, store));
  }

  private async runWrite(
    operation: string,
    write: (store: ChannelReplyCapabilityBackend) => Promise<void>,
    store: ChannelReplyCapabilityBackend,
  ): Promise<void> {
    try {
      await write(store);
    } catch (error) {
      this.failure ??= error;
      this.logger?.warn("channel reply capability write failed", {
        operation,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * A used capability is a live one: every resolve pushes its expiry out by the
   * full TTL, so a conversation that stays active never loses its reply tool
   * mid-session. The durable row is rewritten only once the in-memory expiry
   * has moved a tenth of the TTL past what the row holds — an MCP request must
   * not cost a database write.
   */
  private slide(hash: string, capability: PendingChannelReplyCapability): void {
    capability.expiresAt = this.now() + this.ttlMs;
    if (capability.expiresAt - capability.persistedExpiresAt < this.ttlMs / 10) return;
    capability.persistedExpiresAt = capability.expiresAt;
    this.persist("slide", (store) => store.save(toRow(hash, capability)));
  }

  private active(hash: string): PendingChannelReplyCapability | undefined {
    const capability = this.capabilities.get(hash);
    if (capability === undefined) return undefined;
    if (capability.expiresAt <= this.now()) {
      this.capabilities.delete(hash);
      this.persist("expire", (store) => store.deleteTokens([hash]));
      return undefined;
    }
    return capability;
  }

  private pruneExpired(): void {
    const now = this.now();
    const expired: string[] = [];
    for (const [hash, capability] of this.capabilities) {
      if (capability.expiresAt <= now) {
        this.capabilities.delete(hash);
        expired.push(hash);
      }
    }
    if (expired.length > 0) this.persist("prune", (store) => store.deleteTokens(expired));
  }
}

function toRow(hash: string, capability: PendingChannelReplyCapability): ChannelReplyCapabilityRow {
  return {
    tokenHash: hash,
    organizationId: capability.organizationId,
    channelRevisionId: capability.channelRevisionId,
    routePosition: String(capability.routePosition),
    routeFingerprint: capability.routeFingerprint,
    channel: capability.ref.channel,
    accountId: capability.ref.accountId,
    externalConversationId: capability.ref.externalConversationId,
    externalThreadId: capability.ref.externalThreadId,
    projectRoot: capability.projectRoot ?? null,
    requesterSenderId: capability.requesterSenderId ?? null,
    outputBudget: capability.outputBudget ?? null,
    agentId: capability.agentId,
    expiresAt: new Date(capability.expiresAt),
  };
}

/** A stored row as a live capability; `undefined` for a channel this build
 * no longer supports, so one stale row cannot fail the whole rehydration. */
function fromRow(
  row: ChannelReplyCapabilityRow,
  turnOutputMax: number,
): PendingChannelReplyCapability | undefined {
  if (!isSupportedChannel(row.channel)) return undefined;
  return {
    organizationId: row.organizationId,
    channelRevisionId: row.channelRevisionId,
    routePosition: row.routePosition === "fallback" ? "fallback" : Number(row.routePosition),
    routeFingerprint: row.routeFingerprint,
    ref: {
      channel: row.channel,
      accountId: row.accountId,
      externalConversationId: row.externalConversationId,
      externalThreadId: row.externalThreadId,
    },
    ...(row.projectRoot === null ? {} : { projectRoot: row.projectRoot }),
    ...(row.requesterSenderId === null ? {} : { requesterSenderId: row.requesterSenderId }),
    ...(row.outputBudget === null ? {} : { outputBudget: row.outputBudget }),
    agentId: row.agentId,
    // The turn is process state: a restored capability answers with no turn
    // scope until the next inbound stamps one.
    turn: { posted: 0, inFlight: 0, max: turnOutputMax },
    expiresAt: row.expiresAt.getTime(),
    persistedExpiresAt: row.expiresAt.getTime(),
  };
}
