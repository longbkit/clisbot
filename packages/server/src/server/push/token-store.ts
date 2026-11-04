import type pino from "pino";
import { existsSync, readFileSync } from "node:fs";

import { ensurePrivateFile, writePrivateFileAtomicSync } from "../private-files.js";
import {
  DEFAULT_NOTIFICATION_SCOPE,
  NotificationScopeSchema,
  type NotificationReader,
  type NotificationScope,
} from "@clisbot/protocol/notification-audience";
import { SessionActorSchema, type SessionActor } from "@clisbot/protocol/session-authorship";
import type { PushPayload } from "./push-service.js";

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

  /** An undefined `reader.scope` keeps the token's saved choice; a new token starts with For me. */
  renewToken(
    token: string,
    authorization?: PushTokenAuthorization,
    reader: PushTokenReaderUpdate = {},
  ): void {
    const normalized = token.trim();
    if (!normalized) return;
    const now = this.now();
    const expiry = Math.min(now + this.leaseMs, authorization?.leaseExpiresAt ?? Infinity);
    if (expiry <= now) return;
    const current = this.subscriptions.get(normalized);
    const candidate: PushTokenSubscription = {
      expiresAt: expiry,
      leaseId: authorization?.leaseId ?? null,
      projectIds:
        authorization === undefined || authorization.projectIds === null
          ? null
          : [...new Set(authorization.projectIds)].sort(),
      actor: reader.actor ?? null,
      scope: reader.scope ?? current?.scope ?? DEFAULT_NOTIFICATION_SCOPE,
    };
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
    return this.getActiveSubscriptions(target).map(({ token }) => token);
  }

  /** Active tokens for `target`, with whether each one depends on a managed lease. */
  getActiveSubscriptions(target?: PushNotificationTarget): { token: string; leased: boolean }[] {
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
      .filter(([, subscription]) => allowsRecipient(subscription, target))
      .map(([token, subscription]) => ({ token, leased: subscription.leaseId !== null }));
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
        const stored = parseStoredSubscription(value);
        if (stored) loaded.set(stored.token, stored.subscription);
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
            migrated.set(normalized, {
              expiresAt,
              leaseId: null,
              projectIds: null,
              actor: null,
              scope: DEFAULT_NOTIFICATION_SCOPE,
            });
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
              ...(subscription.actor === null ? {} : { actor: subscription.actor }),
              scope: subscription.scope,
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

/** Who the token's device belongs to and which sessions they want to hear about. */
export interface PushTokenReaderUpdate {
  /** The connection's Hub account; absent for the Host owner's own devices. */
  actor?: SessionActor;
  /** Absent keeps the saved choice. */
  scope?: NotificationScope;
}

export interface PushNotificationTarget {
  projectId?: string;
  /** Which readers this notification is for; absent sends to every authorized token. */
  recipients?: (reader: NotificationReader) => boolean;
  /**
   * What tokens bound to a managed lease receive instead of the payload, when the sender
   * cannot rely on a revocation of that lease having reached it. Identifies nothing.
   */
  leasePayload?: PushPayload;
}

interface PushTokenSubscription {
  expiresAt: number;
  leaseId: string | null;
  projectIds: readonly string[] | null;
  actor: SessionActor | null;
  scope: NotificationScope;
}

/** One persisted subscription, permissively; absent reader fields read as written before them. */
function parseStoredSubscription(
  value: unknown,
): { token: string; subscription: PushTokenSubscription } | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    token?: unknown;
    expiresAt?: unknown;
    leaseId?: unknown;
    projectIds?: unknown;
    actor?: unknown;
    scope?: unknown;
  };
  if (typeof candidate.token !== "string" || typeof candidate.expiresAt !== "string") return null;
  const token = candidate.token.trim();
  const expiresAt = Date.parse(candidate.expiresAt);
  if (!token || !Number.isFinite(expiresAt)) return null;
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
  const actor = SessionActorSchema.safeParse(candidate.actor);
  const scope = NotificationScopeSchema.safeParse(candidate.scope);
  return {
    token,
    subscription: {
      expiresAt,
      leaseId,
      projectIds: projectIds === null ? null : [...new Set(projectIds)].sort(),
      actor: actor.success ? actor.data : null,
      scope: scope.success ? scope.data : DEFAULT_NOTIFICATION_SCOPE,
    },
  };
}

function sameAuthorization(left: PushTokenSubscription, right: PushTokenSubscription): boolean {
  return (
    left.leaseId === right.leaseId &&
    left.scope === right.scope &&
    JSON.stringify(left.projectIds) === JSON.stringify(right.projectIds) &&
    JSON.stringify(left.actor) === JSON.stringify(right.actor)
  );
}

/**
 * The reader a token belongs to: the Hub account it was registered with. A lease
 * token saved without one (written before readers were recorded) is nobody we
 * can attribute, so it receives nothing until its device renews it.
 */
export function pushTokenReader(subscription: {
  leaseId: string | null;
  projectIds: readonly string[] | null;
  actor: SessionActor | null;
  scope: NotificationScope;
}): NotificationReader | null {
  if (subscription.leaseId !== null && subscription.actor === null) return null;
  return {
    actor: subscription.actor,
    daemonWide: subscription.projectIds === null,
    scope: subscription.scope,
  };
}

function allowsRecipient(
  subscription: PushTokenSubscription,
  target: PushNotificationTarget | undefined,
): boolean {
  if (!target?.recipients) return true;
  const reader = pushTokenReader(subscription);
  return reader !== null && target.recipients(reader);
}

function allowsTarget(
  subscription: PushTokenSubscription,
  target: PushNotificationTarget | undefined,
): boolean {
  if (subscription.projectIds === null) return true;
  return target?.projectId !== undefined && subscription.projectIds.includes(target.projectId);
}
