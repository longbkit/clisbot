import { randomUUID } from "node:crypto";
import { routeFingerprint, routePosition } from "../bindings/index.js";
import type { CompiledChannelAccount, CompiledRoute } from "../config/compile.js";
import type { PlaneLogger } from "./types.js";

const RATE_WINDOW_MS = 60_000;

export interface RouteExecutionLease {
  id: string;
}

export type RouteExecutionAdmission =
  | { allowed: true; lease?: RouteExecutionLease }
  | { allowed: false; reason: string };

interface RouteExecutionLimiterDeps {
  now: () => number;
  cancelAgent: (agentId: string) => Promise<void>;
  logger: PlaneLogger;
  schedule?: ((callback: () => void, delayMs: number) => () => void) | undefined;
}

interface ActiveLease {
  id: string;
  routeKey: string;
  cancelTimer: () => void;
  agentId?: string;
}

function defaultSchedule(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  timer.unref?.();
  return () => clearTimeout(timer);
}

/**
 * Per-plane enforcement for authored Route limits. Configuration compilation
 * owns ceilings and open-audience defaults; this class owns only live
 * admission, runtime leases, and cancellation.
 */
export class RouteExecutionLimiter {
  private readonly deps: RouteExecutionLimiterDeps;
  private readonly messagesBySender = new Map<string, number[]>();
  private readonly messagesByRoute = new Map<string, number[]>();
  private readonly leases = new Map<string, ActiveLease>();
  private readonly leaseIdsByRoute = new Map<string, Set<string>>();
  private readonly leaseIdsByAgent = new Map<string, Set<string>>();

  constructor(deps: RouteExecutionLimiterDeps) {
    this.deps = deps;
  }

  admit(input: {
    account: CompiledChannelAccount;
    route: CompiledRoute;
    senderIdentity: string;
    text: string;
    leaseId?: string;
  }): RouteExecutionAdmission {
    const limits = input.route.limits;
    if (limits === undefined) return { allowed: true };
    if (limits.maxInputCharacters !== undefined && input.text.length > limits.maxInputCharacters) {
      return {
        allowed: false,
        reason: "Route input exceeds its size limit",
      };
    }

    const routeKey = keyFor(input.account, input.route);
    const now = this.deps.now();
    const routeMessages = recent(this.messagesByRoute.get(routeKey), now - RATE_WINDOW_MS);
    const senderKey = JSON.stringify([routeKey, input.senderIdentity]);
    const senderMessages = recent(this.messagesBySender.get(senderKey), now - RATE_WINDOW_MS);
    if (
      limits.messagesPerMinutePerSender !== undefined &&
      senderMessages.length >= limits.messagesPerMinutePerSender
    ) {
      this.messagesBySender.set(senderKey, senderMessages);
      return {
        allowed: false,
        reason: "Route rate limit exceeded for this sender",
      };
    }
    if (
      limits.messagesPerMinute !== undefined &&
      routeMessages.length >= limits.messagesPerMinute
    ) {
      this.messagesByRoute.set(routeKey, routeMessages);
      return { allowed: false, reason: "Route rate limit exceeded" };
    }
    if (
      limits.maxConcurrentRuns !== undefined &&
      (this.leaseIdsByRoute.get(routeKey)?.size ?? 0) >= limits.maxConcurrentRuns
    ) {
      return { allowed: false, reason: "Route concurrency limit exceeded" };
    }

    senderMessages.push(now);
    routeMessages.push(now);
    this.messagesBySender.set(senderKey, senderMessages);
    this.messagesByRoute.set(routeKey, routeMessages);

    if (limits.maxConcurrentRuns === undefined && limits.maxRuntimeSeconds === undefined) {
      return { allowed: true };
    }
    const id = input.leaseId ?? randomUUID();
    this.addLease(
      id,
      routeKey,
      limits.maxRuntimeSeconds === undefined ? undefined : limits.maxRuntimeSeconds * 1_000,
    );
    return { allowed: true, lease: { id } };
  }

  bind(lease: RouteExecutionLease | undefined, agentId: string): void {
    if (lease === undefined) return;
    const active = this.leases.get(lease.id);
    if (active === undefined || active.agentId === agentId) return;
    if (active.agentId !== undefined) {
      this.leaseIdsByAgent.get(active.agentId)?.delete(active.id);
    }
    active.agentId = agentId;
    const agentLeases = this.leaseIdsByAgent.get(agentId) ?? new Set<string>();
    agentLeases.add(active.id);
    this.leaseIdsByAgent.set(agentId, agentLeases);
  }

  /** Rebuild a persisted Workflow lease after a Hub restart, then bind it. */
  bindOrRestore(input: {
    leaseId: string | undefined;
    account: CompiledChannelAccount;
    route: CompiledRoute;
    startedAt: Date;
    agentId: string;
  }): void {
    if (input.leaseId === undefined) return;
    if (this.leases.has(input.leaseId)) {
      this.bind({ id: input.leaseId }, input.agentId);
      return;
    }
    const limits = input.route.limits;
    if (
      limits === undefined ||
      (limits.maxConcurrentRuns === undefined && limits.maxRuntimeSeconds === undefined)
    ) {
      return;
    }
    const routeKey = keyFor(input.account, input.route);
    if (
      limits.maxConcurrentRuns !== undefined &&
      (this.leaseIdsByRoute.get(routeKey)?.size ?? 0) >= limits.maxConcurrentRuns
    ) {
      void this.cancel(input.agentId, "Route concurrency limit exceeded");
      return;
    }
    const remainingMs =
      limits.maxRuntimeSeconds === undefined
        ? undefined
        : input.startedAt.getTime() + limits.maxRuntimeSeconds * 1_000 - this.deps.now();
    if (remainingMs !== undefined && remainingMs <= 0) {
      void this.cancel(input.agentId, "Route runtime limit reached");
      return;
    }
    this.addLease(input.leaseId, routeKey, remainingMs);
    this.bind({ id: input.leaseId }, input.agentId);
  }

  complete(lease: RouteExecutionLease | undefined): void {
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

  /** Cancel every Route-owned Agent before a policy/configuration replacement. */
  async cancelActive(): Promise<void> {
    const agentIds = new Set(
      [...this.leases.values()].flatMap(({ agentId }) => (agentId === undefined ? [] : [agentId])),
    );
    this.clear();
    await Promise.all(
      [...agentIds].map(async (agentId) => {
        try {
          await this.deps.cancelAgent(agentId);
        } catch (error) {
          this.deps.logger.warn("Route cancellation failed", {
            agentId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );
  }

  /** Release timers and counters without changing daemon work (Hub shutdown). */
  clear(): void {
    for (const lease of this.leases.values()) lease.cancelTimer();
    this.leases.clear();
    this.leaseIdsByRoute.clear();
    this.leaseIdsByAgent.clear();
    this.messagesBySender.clear();
    this.messagesByRoute.clear();
  }

  private expire(leaseId: string): void {
    const lease = this.leases.get(leaseId);
    if (lease === undefined) return;
    const agentId = lease.agentId;
    this.release(leaseId);
    this.deps.logger.warn("Route runtime limit reached", {
      route: lease.routeKey,
      agentId: agentId ?? null,
    });
    if (agentId !== undefined) {
      void this.cancel(agentId, "Route runtime limit reached");
    }
  }

  private async cancel(agentId: string, reason: string): Promise<void> {
    try {
      await this.deps.cancelAgent(agentId);
    } catch (error) {
      this.deps.logger.warn("Route execution cancellation failed", {
        agentId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private addLease(id: string, routeKey: string, runtimeMs: number | undefined): void {
    const cancelTimer =
      runtimeMs === undefined
        ? () => undefined
        : (this.deps.schedule ?? defaultSchedule)(() => this.expire(id), runtimeMs);
    this.leases.set(id, { id, routeKey, cancelTimer });
    const routeLeases = this.leaseIdsByRoute.get(routeKey) ?? new Set<string>();
    routeLeases.add(id);
    this.leaseIdsByRoute.set(routeKey, routeLeases);
  }

  private release(leaseId: string): void {
    const lease = this.leases.get(leaseId);
    if (lease === undefined) return;
    lease.cancelTimer();
    this.leases.delete(leaseId);
    const routeLeases = this.leaseIdsByRoute.get(lease.routeKey);
    routeLeases?.delete(leaseId);
    if (routeLeases?.size === 0) this.leaseIdsByRoute.delete(lease.routeKey);
    if (lease.agentId !== undefined) {
      const agentLeases = this.leaseIdsByAgent.get(lease.agentId);
      agentLeases?.delete(leaseId);
      if (agentLeases?.size === 0) this.leaseIdsByAgent.delete(lease.agentId);
    }
  }
}

function keyFor(account: CompiledChannelAccount, route: CompiledRoute): string {
  return JSON.stringify([
    account.channel,
    account.accountId,
    routePosition(account, route),
    routeFingerprint(route),
  ]);
}

function recent(values: number[] | undefined, after: number): number[] {
  return (values ?? []).filter((timestamp) => timestamp > after);
}
