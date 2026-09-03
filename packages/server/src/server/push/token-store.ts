import type pino from "pino";
import { existsSync, readFileSync } from "node:fs";

import { ensurePrivateFile, writePrivateFileAtomicSync } from "../private-files.js";

/**
 * Store for Expo push tokens.
 *
 * Tokens are persisted to disk so pushes still work after daemon restarts.
 */
export class PushTokenStore {
  private readonly logger: pino.Logger;
  private subscriptions = new Map<string, PushTokenSubscription>();
  private readonly filePath: string;
  private readonly now: () => number;
  private readonly leaseMs: number;
  private readonly write: typeof writePrivateFileAtomicSync;

  constructor(
    logger: pino.Logger,
    filePath: string,
    now: () => number,
    leaseMs: number,
    write: typeof writePrivateFileAtomicSync = writePrivateFileAtomicSync,
  ) {
    this.logger = logger.child({ component: "token-store" });
    this.filePath = filePath;
    this.now = now;
    this.leaseMs = leaseMs;
    this.write = write;
    this.loadFromDisk();
  }

  renewToken(token: string, authorization?: PushTokenAuthorization): void {
    const normalized = token.trim();
    if (!normalized) return;
    const now = this.now();
    const expiry = Math.min(now + this.leaseMs, authorization?.leaseExpiresAt ?? Infinity);
    if (expiry <= now) return;
    const candidate: PushTokenSubscription = {
      expiresAt: expiry,
      leaseId: authorization?.leaseId ?? null,
      projectIds:
        authorization === undefined || authorization.projectIds === null
          ? null
          : [...new Set(authorization.projectIds)].sort(),
    };
    const current = this.subscriptions.get(normalized);
    if (
      current !== undefined &&
      sameAuthorization(current, candidate) &&
      (authorization !== undefined
        ? current.expiresAt === candidate.expiresAt
        : current.expiresAt - now > this.leaseMs / 2)
    ) {
      return;
    }
    const next = new Map(this.subscriptions);
    next.set(normalized, candidate);
    this.persist(next);
    this.subscriptions = next;
    this.logger.debug({ total: this.subscriptions.size }, "Renewed token");
  }

  revokeToken(token: string): void {
    const normalized = token.trim();
    if (!normalized) return;
    if (!this.subscriptions.has(normalized)) return;
    const next = new Map(this.subscriptions);
    next.delete(normalized);
    this.persist(next);
    this.subscriptions = next;
    this.logger.debug({ total: this.subscriptions.size }, "Revoked token");
  }

  revokeLease(leaseId: string): void {
    const next = new Map(this.subscriptions);
    for (const [token, subscription] of this.subscriptions) {
      if (subscription.leaseId === leaseId) next.delete(token);
    }
    if (next.size === this.subscriptions.size) return;
    this.persist(next);
    this.subscriptions = next;
    this.logger.debug({ total: this.subscriptions.size }, "Revoked managed push lease");
  }

  getActiveTokens(target?: PushNotificationTarget): string[] {
    const now = this.now();
    const active = new Map(this.subscriptions);
    for (const [token, subscription] of this.subscriptions) {
      if (subscription.expiresAt <= now) {
        active.delete(token);
      }
    }
    if (active.size !== this.subscriptions.size) {
      try {
        this.persist(active);
        this.subscriptions = active;
      } catch {
        // Keep the previous state so a later send retries pruning. Expired tokens
        // are still excluded from this delivery.
      }
    }
    return Array.from(active)
      .filter(([, subscription]) => allowsTarget(subscription, target))
      .map(([token]) => token);
  }

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.filePath)) {
        return;
      }
      ensurePrivateFile(this.filePath);
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as { subscriptions?: unknown; tokens?: unknown };
      const loaded = new Map<string, PushTokenSubscription>();
      const subscriptions = Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [];
      for (const value of subscriptions) {
        if (!value || typeof value !== "object") continue;
        const candidate = value as {
          token?: unknown;
          expiresAt?: unknown;
          leaseId?: unknown;
          projectIds?: unknown;
        };
        if (typeof candidate.token !== "string" || typeof candidate.expiresAt !== "string")
          continue;
        const token = candidate.token.trim();
        const expiresAt = Date.parse(candidate.expiresAt);
        const leaseId =
          typeof candidate.leaseId === "string" && candidate.leaseId.trim()
            ? candidate.leaseId.trim()
            : null;
        const projectIds = Array.isArray(candidate.projectIds)
          ? candidate.projectIds.filter(
              (projectId): projectId is string =>
                typeof projectId === "string" && projectId.trim().length > 0,
            )
          : null;
        if (token && Number.isFinite(expiresAt)) {
          loaded.set(token, {
            expiresAt,
            leaseId,
            projectIds: projectIds === null ? null : [...new Set(projectIds)].sort(),
          });
        }
      }
      this.subscriptions = loaded;

      const legacyTokens = Array.isArray(parsed.tokens)
        ? parsed.tokens.filter((token): token is string => typeof token === "string")
        : [];
      if (legacyTokens.length > 0) {
        const migrated = new Map(loaded);
        const expiresAt = this.now() + this.leaseMs;
        for (const token of legacyTokens) {
          const normalized = token.trim();
          if (normalized) {
            migrated.set(normalized, { expiresAt, leaseId: null, projectIds: null });
          }
        }
        this.persist(migrated);
        this.subscriptions = migrated;
      }
      this.logger.info({ total: this.subscriptions.size }, "Loaded push tokens");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn({ err }, "Failed to load push tokens");
    }
  }

  private persist(subscriptions: ReadonlyMap<string, PushTokenSubscription>): void {
    try {
      const payload =
        JSON.stringify(
          {
            subscriptions: Array.from(subscriptions, ([token, subscription]) => ({
              token,
              expiresAt: new Date(subscription.expiresAt).toISOString(),
              ...(subscription.leaseId === null ? {} : { leaseId: subscription.leaseId }),
              ...(subscription.projectIds === null ? {} : { projectIds: subscription.projectIds }),
            })),
          },
          null,
          2,
        ) + "\n";
      this.write(this.filePath, payload);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn({ err }, "Failed to persist push tokens");
      throw err;
    }
  }
}

export interface PushTokenAuthorization {
  leaseId: string;
  leaseExpiresAt: number;
  /** Null means daemon-wide authority; an array is the complete Project audience. */
  projectIds: readonly string[] | null;
}

export interface PushNotificationTarget {
  projectId?: string;
}

interface PushTokenSubscription {
  expiresAt: number;
  leaseId: string | null;
  projectIds: readonly string[] | null;
}

function sameAuthorization(left: PushTokenSubscription, right: PushTokenSubscription): boolean {
  return (
    left.leaseId === right.leaseId &&
    JSON.stringify(left.projectIds) === JSON.stringify(right.projectIds)
  );
}

function allowsTarget(
  subscription: PushTokenSubscription,
  target: PushNotificationTarget | undefined,
): boolean {
  if (subscription.projectIds === null) return true;
  return target?.projectId !== undefined && subscription.projectIds.includes(target.projectId);
}
