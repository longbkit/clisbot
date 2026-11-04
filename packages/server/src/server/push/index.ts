import type pino from "pino";

import { PushService, type PushPayload } from "./push-service.js";
import {
  PushTokenStore,
  type ActivePushSubscription,
  type LeaseConfirmation,
  type PushNotificationTarget,
  type PushTokenAuthorization,
  type PushTokenReaderUpdate,
} from "./token-store.js";

export type { PushPayload };
export type {
  LeaseConfirmation,
  PushNotificationTarget,
  PushTokenAuthorization,
  PushTokenReaderUpdate,
} from "./token-store.js";

const PUSH_TOKEN_LEASE_MS = 48 * 60 * 60 * 1000;
/** How long a verified notification may wait for an offline Member's device. */
const LEASE_CONTENT_TTL_SECONDS = 300;

/**
 * What a device whose access the daemon cannot currently confirm receives instead: no session,
 * terminal, Project, path or Host identifier, so tapping it opens nothing in particular.
 */
export const UNIDENTIFIED_PUSH_PAYLOAD: PushPayload = {
  title: "Clisbot",
  body: "Open Clisbot to see what changed.",
};

export interface PushNotifications {
  renew(
    token: string,
    authorization?: PushTokenAuthorization,
    reader?: PushTokenReaderUpdate,
  ): void;
  revoke(token: string): void;
  revokeLease(leaseId: string): void;
  markLeaseUnconfirmed(leaseId: string): void;
  revokeDevice(deviceId: string): void;
  send(payload: PushPayload, target?: PushNotificationTarget): Promise<void>;
}

export type PushNotificationSender = Pick<PushNotifications, "send">;

export function createPushNotifications(options: {
  logger: pino.Logger;
  filePath: string;
  now?: () => number;
  deliver?: (tokens: string[], payload: PushPayload) => Promise<void>;
}): PushNotifications {
  const now = options.now ?? Date.now;
  const store = new PushTokenStore(options.logger, options.filePath, now, PUSH_TOKEN_LEASE_MS);
  const service = new PushService(options.logger, (token) => store.revokeToken(token));
  const deliver =
    options.deliver ??
    ((tokens: string[], payload: PushPayload) => service.sendPush(tokens, payload));
  const deliverLogged = async (
    entries: readonly ActivePushSubscription[],
    payload: PushPayload,
  ): Promise<void> => {
    if (entries.length === 0) return;
    try {
      await deliver(
        entries.map((entry) => entry.token),
        payload,
      );
    } catch (err) {
      options.logger.warn({ err, tokenCount: entries.length }, "Failed to deliver push");
    }
  };

  return {
    renew(token, authorization, reader) {
      store.renewToken(token, authorization, reader);
    },
    revoke(token) {
      store.revokeToken(token);
    },
    revokeLease(leaseId) {
      store.revokeLease(leaseId);
    },
    markLeaseUnconfirmed(leaseId) {
      store.markLeaseUnconfirmed(leaseId);
    },
    revokeDevice(deviceId) {
      store.revokeDevice(deviceId);
    },
    async send(payload, target) {
      // The Host owner's own devices are never asked: deliver to them first, whatever follows.
      const owned = store.getActiveSubscriptions(target).filter((entry) => entry.leaseId === null);
      await deliverLogged(owned, payload);
      const granted = await confirmLeases(store.getActiveSubscriptions(target), target, (leaseId) =>
        store.markLeaseUnconfirmed(leaseId),
      );
      // Read again: a token re-registered while the Hub answered is judged by its lease now.
      const leased = store.getActiveSubscriptions(target).filter((entry) => entry.leaseId !== null);
      const verified = leased.filter(
        (entry) => !entry.unconfirmed && entry.leaseId !== null && granted.has(entry.leaseId),
      );
      const withheld = leased.filter((entry) => !verified.includes(entry));
      options.logger.info(
        {
          ownedTokenCount: owned.length,
          verifiedTokenCount: verified.length,
          unidentifiedTokenCount: withheld.length,
        },
        "Sending push notification",
      );
      // Verified content goes stale with the access it was verified for: drop it if undelivered.
      await deliverLogged(verified, { ...payload, ttlSeconds: LEASE_CONTENT_TTL_SECONDS });
      await deliverLogged(withheld, UNIDENTIFIED_PUSH_PAYLOAD);
    },
  };
}

/**
 * Leases the Hub, asked now, still grants what this notification needs. Each lease is asked once
 * per notification and never cached; a refusal marks it unconfirmed until its device renews.
 */
async function confirmLeases(
  subscriptions: readonly ActivePushSubscription[],
  target: PushNotificationTarget | undefined,
  markUnconfirmed: (leaseId: string) => void,
): Promise<ReadonlySet<string>> {
  const granted = new Set<string>();
  const confirm = target?.confirmLease;
  if (!confirm) return granted;
  const leaseIds = new Set(
    subscriptions.flatMap((entry) =>
      entry.leaseId !== null && !entry.unconfirmed ? [entry.leaseId] : [],
    ),
  );
  await Promise.all(
    [...leaseIds].map(async (leaseId) => {
      const answer = await confirm(leaseId).catch(
        (): LeaseConfirmation => ({ granted: false, revoked: false }),
      );
      if (answer.granted) granted.add(leaseId);
      else if (answer.revoked) {
        try {
          markUnconfirmed(leaseId);
        } catch {
          // Still withheld for this send; the next refusal tries to record it again.
        }
      }
    }),
  );
  return granted;
}
