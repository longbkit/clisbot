// The processing lease — "an accepted channel turn is in flight". The Hub owns
// its LIFECYCLE (open at accepted inbound, close at the turn's terminal event,
// expire a stalled turn, release on plane stop) and nothing else. The
// provider's expiry behaviour belongs to the VERTICAL: Slack restores its
// status after posts and expiry; Telegram re-sends `sendChatAction` on its timer.
//
// Why the lease opens at the inbound and not at `turn_started`: the plane sends
// the agent its prompt before the daemon can report anything, and a fresh
// session's stream is only subscribed after the create returns. A surface that
// waits for `turn_started` is therefore opened after the turn has already
// started — or, for the first prompt of a new session, never. The accepted
// inbound is the first moment the Hub knows a turn WILL run, and it is the
// moment the pinned reference implementation raises its indicator.
//
// Why leases are refcounted per surface: two inbounds accepted into one thread
// are two turns sharing one indicator. Closing the first must not clear the
// signal the second still needs, so the wire `stop` fires only when the last
// lease on the surface is gone.
import type { EffectiveDefaults } from "../config/compile.js";
import { MESSAGE_REACTION_OFF } from "../config/enums.js";
import type { P0ChannelName, PlaneLogger, TypingFn } from "./types.js";

/** No stream event for this long = the turn is gone; release the surface. */
export const PROCESSING_TTL_MS = 60_000;

/** The surface one turn signals on, resolved from the accepted inbound. */
export interface ProcessingSurface {
  channel: P0ChannelName;
  accountId: string;
  /** The conversation the turn runs in. */
  to: string;
  /** The thread the reply lands in; absent = the conversation root. */
  threadId?: string | undefined;
  /** The inbound marker's native id: the reaction target, and Slack's status
   * anchor when the turn has no thread of its own. */
  messageId?: string | undefined;
  /** `sync.progress.typingIndicator`. */
  indicator: boolean;
  /** `sync.progress.messageReaction`, resolved to a name; absent = `"off"`. */
  reactionEmoji?: string | undefined;
}

export interface ProcessingControllerDeps {
  /** The account's liveness drive; absent = the surface does not exist. */
  drive?: TypingFn | undefined;
  logger: PlaneLogger;
  now: () => number;
  /** Schedule the TTL sweep; returns the cancel. Injectable for tests. */
  schedule?: ((tick: () => void, intervalMs: number) => () => void) | undefined;
  ttlMs?: number | undefined;
  /** Fresh authoritative daemon status for quiet tools; failure still expires the lease. */
  readRunningAgentIds?: (() => Promise<ReadonlySet<string>>) | undefined;
}

export interface ProcessingController {
  /** Raise the surface for one accepted inbound. Idempotent per `id`. */
  open(id: string, surface: ProcessingSurface): void;
  /** Point a provisional lease at the agent its turn runs on. */
  bind(id: string, agentId: string): void;
  /** A stream event proves the agent's turn is alive: push the TTL out. */
  touch(agentId: string): void;
  /** The agent's turn ended (terminal event, or a detach). */
  closeAgent(agentId: string): void;
  /** A provisional lease whose turn never started (create/send failed). */
  close(id: string): void;
  /** Release every surface (plane stop). */
  stopAll(): void;
}

interface Lease {
  id: string;
  agentId?: string | undefined;
  surface: ProcessingSurface;
  surfaceKey: string;
  deadline: number;
}

/** The surface key: one indicator per conversation+thread, per account. */
function surfaceKey(surface: ProcessingSurface): string {
  return [
    surface.channel,
    surface.accountId,
    surface.to,
    surface.threadId ?? surface.messageId ?? "",
  ].join(":");
}

/** Derive the drive params from a lease + the action the surface is taking. */
function paramsFor(lease: Lease, action: "start" | "stop") {
  const { surface } = lease;
  return {
    channel: surface.channel,
    accountId: surface.accountId,
    to: surface.to,
    action,
    indicator: surface.indicator,
    ...(surface.threadId !== undefined ? { threadId: surface.threadId } : {}),
    ...(surface.messageId !== undefined ? { messageId: surface.messageId } : {}),
    ...(surface.reactionEmoji !== undefined ? { reactionEmoji: surface.reactionEmoji } : {}),
  };
}

const defaultSchedule = (tick: () => void, intervalMs: number): (() => void) => {
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
};

/**
 * The surface one accepted inbound signals on, from the route's
 * `sync.progress` group. Both liveness leaves are off and there is no
 * surface — the caller opens nothing and the turn runs silently.
 *
 * `to` / `threadId` are the BINDING key, not the live message location: the
 * lease is opened before the prompt is sent, and the binding key is what
 * the reply will be addressed to (including the thread a root-level Slack
 * marker mints under `reply.anchor: thread`).
 */
export function processingSurfaceFor(params: {
  channel: P0ChannelName;
  accountId: string;
  sync: EffectiveDefaults["sync"];
  to: string;
  threadId?: string | undefined;
  messageId?: string | undefined;
}): ProcessingSurface | undefined {
  const progress = params.sync.progress;
  if (!progress.typingIndicator && progress.messageReaction === MESSAGE_REACTION_OFF) {
    return undefined;
  }
  return {
    channel: params.channel,
    accountId: params.accountId,
    to: params.to,
    ...(params.threadId !== undefined ? { threadId: params.threadId } : {}),
    ...(params.messageId !== undefined ? { messageId: params.messageId } : {}),
    indicator: progress.typingIndicator,
    ...(progress.messageReaction === MESSAGE_REACTION_OFF
      ? {}
      : { reactionEmoji: progress.messageReaction }),
  };
}

export function createProcessingController(deps: ProcessingControllerDeps): ProcessingController {
  const ttlMs = deps.ttlMs ?? PROCESSING_TTL_MS;
  const schedule = deps.schedule ?? defaultSchedule;
  const leases = new Map<string, Lease>();
  /** agentId -> the lease ids currently running on it. A steered follow-up
   * joins a turn already in flight, so one agent can hold several leases; the
   * terminal event closes them together (the wire stop still fires once, when
   * the surface's last lease is gone). */
  const byAgent = new Map<string, Set<string>>();
  /** surfaceKey -> the lease ids currently holding it open. */
  const surfaces = new Map<string, Set<string>>();
  let sweep: (() => void) | undefined;

  const drive = (lease: Lease, action: "start" | "stop"): void => {
    if (deps.drive === undefined) return;
    void deps
      .drive(paramsFor(lease, action))
      .then(() => {
        // Info, not debug: this pair is the operator's only proof that the
        // indicator was raised and released for a turn ("nothing showed up"
        // is answered by these two lines or their absence).
        deps.logger.info?.(`channel processing ${action === "start" ? "started" : "stopped"}`, {
          channel: lease.surface.channel,
          account: lease.surface.accountId,
          to: lease.surface.to,
          lease: lease.id,
          action,
        });
        return undefined;
      })
      .catch((error: unknown) => {
        // Liveness never disturbs the reply: say it once, drop the lease, and
        // let the next inbound try again rather than retrying a surface the
        // provider is refusing. `silent` because nothing is live to clear — a
        // failed `start` must not spend a `stop` on a surface that never opened
        // (for Slack that would be a status clear the app never set).
        release(lease.id, { silent: true });
        deps.logger.warn("channel processing surface failed", {
          channel: lease.surface.channel,
          account: lease.surface.accountId,
          to: lease.surface.to,
          action,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  };

  /**
   * Remove a lease, driving the wire `stop` only when it was the surface's
   * last holder. `silent` removes the bookkeeping without touching the wire —
   * used when the surface never reached it in the first place.
   */
  const release = (id: string, opts: { silent?: boolean } = {}): void => {
    const lease = leases.get(id);
    if (lease === undefined) return;
    leases.delete(id);
    if (lease.agentId !== undefined) {
      const holdersForAgent = byAgent.get(lease.agentId);
      if (holdersForAgent !== undefined) {
        holdersForAgent.delete(id);
        if (holdersForAgent.size === 0) byAgent.delete(lease.agentId);
      }
    }
    const holders = surfaces.get(lease.surfaceKey);
    if (holders === undefined) return;
    holders.delete(id);
    if (holders.size === 0) {
      surfaces.delete(lease.surfaceKey);
      if (opts.silent !== true) drive(lease, "stop");
    }
    if (leases.size === 0 && sweep !== undefined) {
      sweep();
      sweep = undefined;
    }
  };

  let checking = false;
  const tick = (): void => {
    if (checking) return;
    const expired = [...leases.values()].filter((lease) => deps.now() >= lease.deadline);
    if (expired.length === 0) return;
    const deadlines = new Map(expired.map((lease) => [lease.id, lease.deadline]));
    const finish = (running: ReadonlySet<string>): void => {
      for (const lease of expired) {
        // A terminal event, a new lease or fresh stream activity wins over a late RPC result.
        if (leases.get(lease.id) !== lease || lease.deadline !== deadlines.get(lease.id)) continue;
        if (lease.agentId !== undefined && running.has(lease.agentId)) {
          lease.deadline = deps.now() + ttlMs;
          continue;
        }
        deps.logger.warn("channel processing surface timed out", {
          channel: lease.surface.channel,
          account: lease.surface.accountId,
          to: lease.surface.to,
          lease: lease.id,
          agentId: lease.agentId ?? null,
        });
        release(lease.id);
      }
    };
    if (
      deps.readRunningAgentIds === undefined ||
      expired.every((lease) => lease.agentId === undefined)
    ) {
      finish(new Set());
      return;
    }
    checking = true;
    void deps
      .readRunningAgentIds()
      .then(finish, () => finish(new Set()))
      .finally(() => {
        checking = false;
      });
  };

  return {
    open(id, surface) {
      if (leases.has(id)) return;
      const surfaceKeyOf = surfaceKey(surface);
      const lease: Lease = { id, surface, surfaceKey: surfaceKeyOf, deadline: deps.now() + ttlMs };
      leases.set(id, lease);
      const holders = surfaces.get(surfaceKeyOf) ?? new Set<string>();
      surfaces.set(surfaceKeyOf, holders);
      // Only the FIRST lease on a surface costs a wire `start`.
      if (holders.size === 0) drive(lease, "start");
      holders.add(id);
      if (sweep === undefined) sweep = schedule(tick, Math.max(1_000, Math.floor(ttlMs / 3)));
    },

    bind(id, agentId) {
      const lease = leases.get(id);
      if (lease === undefined || lease.agentId === agentId) return;
      if (lease.agentId !== undefined) {
        const heldByOld = byAgent.get(lease.agentId);
        if (heldByOld !== undefined) {
          heldByOld.delete(id);
          if (heldByOld.size === 0) byAgent.delete(lease.agentId);
        }
      }
      lease.agentId = agentId;
      const held = byAgent.get(agentId) ?? new Set<string>();
      byAgent.set(agentId, held);
      held.add(id);
    },

    touch(agentId) {
      for (const id of byAgent.get(agentId) ?? []) {
        const lease = leases.get(id);
        if (lease !== undefined) lease.deadline = deps.now() + ttlMs;
      }
    },

    closeAgent(agentId) {
      for (const id of Array.from(byAgent.get(agentId) ?? [])) release(id);
    },

    close(id) {
      release(id);
    },

    stopAll() {
      for (const id of Array.from(leases.keys())) release(id);
    },
  };
}
