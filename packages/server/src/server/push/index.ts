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
 * How long one notification waits for the Hub to confirm its leases. A lease not confirmed by
 * then gets the generic notification; one Hub request is cut at 3 seconds, the rest covers a
 * short wait for the daemon's bounded request slots (`LeaseVerifier`).
 */
const LEASE_CONFIRM_DEADLINE_MS = 4_000;

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
  leaseConfirmDeadlineMs?: number;
}): PushNotifications {
  const now = options.now ?? Date.now;
  const deadlineMs = options.leaseConfirmDeadlineMs ?? LEASE_CONFIRM_DEADLINE_MS;
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
      // The Host owner's own devices are never asked, so no lease check can hold them up.
      const owned = store.getActiveSubscriptions(target).filter((entry) => entry.leaseId === null);
      const ownedDelivery = deliverLogged(owned, payload);
      const delivered = new Set<string>();
      const deliveries: Promise<void>[] = [];
      let ready: string[] = [];
      // Content goes out as leases are confirmed, so a slow lease delays only its own devices;
      // leases confirmed in the same moment share one delivery.
      const flush = () => {
        const leaseIds = new Set(ready);
        ready = [];
        // Read again: a token re-registered while the Hub answered is judged by its lease now.
        const verified = store
          .getActiveSubscriptions(target)
          .filter(
            (entry) =>
              entry.leaseId !== null &&
              leaseIds.has(entry.leaseId) &&
              !entry.unconfirmed &&
              !delivered.has(entry.token),
          );
        for (const entry of verified) delivered.add(entry.token);
        // Verified content goes stale with the access it was verified for: drop it if undelivered.
        deliveries.push(
          deliverLogged(verified, { ...payload, ttlSeconds: LEASE_CONTENT_TTL_SECONDS }),
        );
      };
      const verifiedLeaseCount = await confirmLeases({
        subscriptions: store.getActiveSubscriptions(target),
        confirm: target?.confirmLease,
        deadlineMs,
        markUnconfirmed: (leaseId) => store.markLeaseUnconfirmed(leaseId),
        onGranted: (leaseId) => {
          if (ready.length === 0) setTimeout(flush, 0);
          ready.push(leaseId);
        },
      });
      if (ready.length > 0) flush();
      const withheld = store
        .getActiveSubscriptions(target)
        .filter((entry) => entry.leaseId !== null && !delivered.has(entry.token));
      options.logger.info(
        {
          ownedTokenCount: owned.length,
          verifiedLeaseCount,
          verifiedTokenCount: delivered.size,
          unidentifiedTokenCount: withheld.length,
        },
        "Sending push notification",
      );
      deliveries.push(deliverLogged(withheld, UNIDENTIFIED_PUSH_PAYLOAD));
      await Promise.all([ownedDelivery, ...deliveries]);
    },
  };
}

/**
 * Asks the Hub, now, whether each lease still grants what this notification needs, calling
 * `onGranted` as each answer arrives. Each lease is asked once per notification and never cached;
 * a refusal marks it unconfirmed until its device renews. Returns the number granted in time.
 * Fails closed: an error or the deadline leaves the lease unverified, and a grant that arrives
 * after the deadline is ignored.
 */
async function confirmLeases(input: {
  subscriptions: readonly ActivePushSubscription[];
  confirm: ((leaseId: string) => Promise<LeaseConfirmation>) | undefined;
  deadlineMs: number;
  markUnconfirmed: (leaseId: string) => void;
  onGranted: (leaseId: string) => void;
}): Promise<number> {
  const confirm = input.confirm;
  if (!confirm) return 0;
  const leaseIds = new Set(
    input.subscriptions.flatMap((entry) =>
      entry.leaseId !== null && !entry.unconfirmed ? [entry.leaseId] : [],
    ),
  );
  if (leaseIds.size === 0) return 0;
  let closed = false;
  let granted = 0;
  const checks = Promise.all(
    [...leaseIds].map(async (leaseId) => {
      const answer = await confirm(leaseId).catch(
        (): LeaseConfirmation => ({ granted: false, revoked: false }),
      );
      if (answer.granted) {
        if (closed) return;
        granted += 1;
        input.onGranted(leaseId);
      } else if (answer.revoked) {
        try {
          input.markUnconfirmed(leaseId);
        } catch {
          // Still withheld for this send; the next refusal tries to record it again.
        }
      }
    }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, input.deadlineMs);
    timer.unref?.();
  });
  await Promise.race([checks, deadline]);
  clearTimeout(timer);
  closed = true;
  return granted;
}
