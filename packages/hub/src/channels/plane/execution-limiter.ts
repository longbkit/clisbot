import { randomUUID } from "node:crypto";
import type { CompiledChannelAccount, CompiledRoute } from "../config/compile.js";
import { inWindow, limitScopes, RATE_WINDOW_MS, type LimitScope } from "./limit-scopes.js";
import { isOpenAudienceRoute } from "../policy.js";
import type { PlaneLogger } from "./types.js";

/** Rate windows are swept for idle senders and scopes once per this many admissions. */
const SWEEP_EVERY_ADMISSIONS = 256;
/**
 * How long to hold a message back when a scope is at its concurrency ceiling.
 * Nothing announces when a run ends, so this is a poll interval, not a deadline:
 * short enough that a freed slot is taken promptly, long enough that a busy
 * scope is not re-claimed on every drain tick.
 */
const CONCURRENCY_RETRY_AFTER_MS = 5_000;
/**
 * A lease is released by its run's terminal stream event, and that event can be
 * lost: the Host's socket was down when the turn ended, the daemon crashed, the
 * agent was killed. Without a runtime limit the slot is then held for good and
 * the scope refuses everything. So a full scope asks the Host which agents are
 * still running, at most this often, and lets go of the rest.
 */
const LEASE_RECONCILE_EVERY_MS = 15_000;
/** A run this young may not show as running yet: its prompt was just sent. */
const LEASE_RECONCILE_GRACE_MS = 30_000;

export interface ExecutionLease {
  id: string;
}

export type ExecutionAdmission =
  | { allowed: true; lease?: ExecutionLease }
  /**
   * `retryAfterMs` separates back-pressure from a decision: present, the
   * message is admissible and only has to wait; absent, it will never be
   * accepted (the caller must not hold it in a queue).
   */
  | { allowed: false; reason: string; retryAfterMs?: number };

/** Where one inbound message is counted. */
export interface ExecutionTarget {
  account: CompiledChannelAccount;
  route: CompiledRoute;
  /** The root conversation: every thread of a channel counts toward it. */
  conversationId: string;
}

interface ExecutionLimiterDeps {
  now: () => number;
  cancelAgent: (agentId: string) => Promise<void>;
  logger: PlaneLogger;
  /** The Host's running agents; absent = leaked leases are never reconciled. */
  readRunningAgentIds?: (() => Promise<ReadonlySet<string>>) | undefined;
  schedule?: ((callback: () => void, delayMs: number) => () => void) | undefined;
}

interface ActiveLease {
  id: string;
  scopeKeys: readonly string[];
  /** An open-audience run stops when its policy is replaced; a Member run keeps going. */
  cancelOnReplace: boolean;
  cancelTimer: () => void;
  /** When the run's agent became known; the reconcile grace counts from here. */
  boundAt?: number;
  agentId?: string;
}

function defaultSchedule(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  timer.unref?.();
  return () => clearTimeout(timer);
}

/**
 * Live admission for authored Bot, Conversation and Route limits. The compiler
 * owns defaults; this class owns only rate windows, run leases, and
 * cancellation at the runtime limit.
 */
export class ChannelExecutionLimiter {
  private readonly deps: ExecutionLimiterDeps;
  private readonly messagesBySender = new Map<string, number[]>();
  private readonly messagesByScope = new Map<string, number[]>();
  private readonly leases = new Map<string, ActiveLease>();
  private readonly leaseIdsByScope = new Map<string, Set<string>>();
  private readonly leaseIdsByAgent = new Map<string, Set<string>>();
  private admissions = 0;
  private lastReconcileAt = Number.NEGATIVE_INFINITY;

  constructor(deps: ExecutionLimiterDeps) {
    this.deps = deps;
  }

  admit(
    input: ExecutionTarget & { senderIdentity: string; text: string; leaseId?: string },
  ): ExecutionAdmission {
    const scopes = limitScopes(input);
    if (scopes.length === 0) return { allowed: true };
    const tooLong = scopes.find(
      ({ limits }) =>
        limits.maxInputCharacters !== undefined && input.text.length > limits.maxInputCharacters,
    );
    if (tooLong !== undefined) {
      return { allowed: false, reason: `${tooLong.label} input exceeds its size limit` };
    }
    const now = this.deps.now();
    this.sweepNow(now);
    for (const scope of scopes) {
      const refusal = this.refusal(scope, input.senderIdentity, now);
      if (refusal !== undefined) return refusal;
    }
    for (const scope of scopes) this.record(scope, input.senderIdentity, now);
    return this.openLease(scopes, input.leaseId, isOpenAudienceRoute(input.route));
  }

  bind(lease: ExecutionLease | undefined, agentId: string): void {
    if (lease === undefined) return;
    const active = this.leases.get(lease.id);
    if (active === undefined || active.agentId === agentId) return;
    if (active.agentId !== undefined) {
      this.leaseIdsByAgent.get(active.agentId)?.delete(active.id);
    }
    active.agentId = agentId;
    active.boundAt = this.deps.now();
    addToSet(this.leaseIdsByAgent, agentId, active.id);
  }

  /** Rebuild a persisted Workflow lease after a Hub restart, then bind it. */
  bindOrRestore(
    input: ExecutionTarget & { leaseId: string | undefined; startedAt: Date; agentId: string },
  ): void {
    if (input.leaseId === undefined) return;
    if (this.leases.has(input.leaseId)) {
      this.bind({ id: input.leaseId }, input.agentId);
      return;
    }
    const scopes = limitScopes(input).filter(leased);
    if (scopes.length === 0) return;
    const full = scopes.find((scope) => this.atConcurrencyLimit(scope));
    if (full !== undefined) {
      void this.cancel(input.agentId, `${full.label} concurrency limit exceeded`);
      return;
    }
    const runtimeMs = shortestRuntimeMs(scopes);
    const remainingMs =
      runtimeMs === undefined ? undefined : input.startedAt.getTime() + runtimeMs - this.deps.now();
    if (remainingMs !== undefined && remainingMs <= 0) {
      void this.cancel(input.agentId, "runtime limit reached");
      return;
    }
    this.addLease(input.leaseId, scopes, remainingMs, isOpenAudienceRoute(input.route));
    this.bind({ id: input.leaseId }, input.agentId);
  }

  complete(lease: ExecutionLease | undefined): void {
    if (lease !== undefined) this.release(lease.id);
  }

  completeById(leaseId: string | undefined): void {
    if (leaseId !== undefined) this.release(leaseId);
  }

  completeAgent(agentId: string): void {
    for (const leaseId of Array.from(this.leaseIdsByAgent.get(agentId) ?? [])) {
      this.release(leaseId);
    }
  }

  /** Cancel every open-audience Agent before a policy/configuration replacement. */
  async cancelActive(): Promise<void> {
    const agentIds = new Set(
      [...this.leases.values()].flatMap(({ agentId, cancelOnReplace }) =>
        agentId === undefined || !cancelOnReplace ? [] : [agentId],
      ),
    );
    this.clear();
    await Promise.all([...agentIds].map((agentId) => this.cancel(agentId, "policy replaced")));
  }

  /** Release timers and counters without changing daemon work (Hub shutdown). */
  clear(): void {
    for (const lease of this.leases.values()) lease.cancelTimer();
    this.leases.clear();
    this.leaseIdsByScope.clear();
    this.leaseIdsByAgent.clear();
    this.messagesBySender.clear();
    this.messagesByScope.clear();
  }

  private refusal(
    scope: LimitScope,
    senderIdentity: string,
    now: number,
  ): Extract<ExecutionAdmission, { allowed: false }> | undefined {
    const { limits, label } = scope;
    const sender = inWindow(this.messagesBySender.get(senderKey(scope, senderIdentity)), now);
    if (
      limits.messagesPerMinutePerSender !== undefined &&
      sender.length >= limits.messagesPerMinutePerSender
    ) {
      return {
        allowed: false,
        reason: `${label} rate limit exceeded for this sender`,
        retryAfterMs: windowRetryAfterMs(sender, now),
      };
    }
    const all = inWindow(this.messagesByScope.get(scope.key), now);
    if (limits.messagesPerMinute !== undefined && all.length >= limits.messagesPerMinute) {
      return {
        allowed: false,
        reason: `${label} rate limit exceeded`,
        retryAfterMs: windowRetryAfterMs(all, now),
      };
    }
    if (this.atConcurrencyLimit(scope)) {
      void this.reconcileLeases(now);
      return {
        allowed: false,
        reason: `${label} concurrency limit exceeded`,
        retryAfterMs: CONCURRENCY_RETRY_AFTER_MS,
      };
    }
    return undefined;
  }

  /** Only the windows a limit reads are kept. */
  private record(scope: LimitScope, senderIdentity: string, now: number): void {
    if (scope.limits.messagesPerMinutePerSender !== undefined) {
      const key = senderKey(scope, senderIdentity);
      this.messagesBySender.set(key, [...inWindow(this.messagesBySender.get(key), now), now]);
    }
    if (scope.limits.messagesPerMinute !== undefined) {
      const all = inWindow(this.messagesByScope.get(scope.key), now);
      this.messagesByScope.set(scope.key, [...all, now]);
    }
  }

  /** Drop senders and scopes whose window has emptied, so idle ones cost nothing. */
  private sweepNow(now: number): void {
    this.admissions += 1;
    if (this.admissions % SWEEP_EVERY_ADMISSIONS !== 0) return;
    for (const windows of [this.messagesBySender, this.messagesByScope]) {
      for (const [key, times] of windows) {
        if (inWindow(times, now).length === 0) windows.delete(key);
      }
    }
  }

  private atConcurrencyLimit(scope: LimitScope): boolean {
    const max = scope.limits.maxConcurrentRuns;
    return max !== undefined && (this.leaseIdsByScope.get(scope.key)?.size ?? 0) >= max;
  }

  private openLease(
    scopes: readonly LimitScope[],
    leaseId: string | undefined,
    cancelOnReplace: boolean,
  ): ExecutionAdmission {
    const counted = scopes.filter(leased);
    if (counted.length === 0) return { allowed: true };
    const id = leaseId ?? randomUUID();
    this.addLease(id, counted, shortestRuntimeMs(counted), cancelOnReplace);
    return { allowed: true, lease: { id } };
  }

  private expire(leaseId: string): void {
    const lease = this.leases.get(leaseId);
    if (lease === undefined) return;
    const agentId = lease.agentId;
    this.release(leaseId);
    this.deps.logger.warn("channel runtime limit reached", {
      scopes: lease.scopeKeys,
      agentId: agentId ?? null,
    });
    if (agentId !== undefined) void this.cancel(agentId, "runtime limit reached");
  }

  private async cancel(agentId: string, reason: string): Promise<void> {
    try {
      await this.deps.cancelAgent(agentId);
    } catch (error) {
      this.deps.logger.warn("channel execution cancellation failed", {
        agentId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private addLease(
    id: string,
    scopes: readonly LimitScope[],
    runtimeMs: number | undefined,
    cancelOnReplace: boolean,
  ): void {
    const cancelTimer =
      runtimeMs === undefined
        ? () => undefined
        : (this.deps.schedule ?? defaultSchedule)(() => this.expire(id), runtimeMs);
    const scopeKeys = scopes.map(({ key }) => key);
    this.leases.set(id, { id, scopeKeys, cancelOnReplace, cancelTimer });
    for (const key of scopeKeys) addToSet(this.leaseIdsByScope, key, id);
  }

  /** Let go of leases whose agent the Host no longer reports as running. */
  private async reconcileLeases(now: number): Promise<void> {
    const read = this.deps.readRunningAgentIds;
    if (read === undefined || now - this.lastReconcileAt < LEASE_RECONCILE_EVERY_MS) return;
    this.lastReconcileAt = now;
    try {
      const running = await read();
      for (const lease of this.leases.values()) {
        if (lease.agentId === undefined || lease.boundAt === undefined) continue;
        const settled = now - lease.boundAt >= LEASE_RECONCILE_GRACE_MS;
        if (!settled || running.has(lease.agentId)) continue;
        this.deps.logger.warn("channel run lease released: its agent is not running", {
          agentId: lease.agentId,
          scopes: lease.scopeKeys,
        });
        this.release(lease.id);
      }
    } catch {
      // The Host is away: nothing is known, so nothing is released.
    }
  }

  private release(leaseId: string): void {
    const lease = this.leases.get(leaseId);
    if (lease === undefined) return;
    lease.cancelTimer();
    this.leases.delete(leaseId);
    for (const key of lease.scopeKeys) removeFromSet(this.leaseIdsByScope, key, leaseId);
    if (lease.agentId !== undefined) removeFromSet(this.leaseIdsByAgent, lease.agentId, leaseId);
  }
}

/** A scope that holds a run slot or a runtime timer for the whole run. */
function leased({ limits }: LimitScope): boolean {
  return limits.maxConcurrentRuns !== undefined || limits.maxRuntimeSeconds !== undefined;
}

function shortestRuntimeMs(scopes: readonly LimitScope[]): number | undefined {
  const seconds = scopes.flatMap(({ limits }) =>
    limits.maxRuntimeSeconds === undefined ? [] : [limits.maxRuntimeSeconds],
  );
  return seconds.length === 0 ? undefined : Math.min(...seconds) * 1_000;
}

function senderKey(scope: LimitScope, senderIdentity: string): string {
  return JSON.stringify([scope.key, senderIdentity]);
}

function addToSet(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key) ?? new Set<string>();
  set.add(value);
  map.set(key, set);
}

function removeFromSet(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key);
  set?.delete(value);
  if (set?.size === 0) map.delete(key);
}

/** When the oldest message in a full rate window falls out of it. */
function windowRetryAfterMs(windowed: number[], now: number): number {
  const oldest = windowed[0];
  if (oldest === undefined) return RATE_WINDOW_MS;
  return Math.max(1, oldest + RATE_WINDOW_MS - now);
}
