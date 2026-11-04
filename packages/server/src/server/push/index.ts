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
    async send(payload, target) {
      const subscriptions = store.getActiveSubscriptions(target);
      const contentAllowed = await confirmContent(subscriptions, target, (leaseId) =>
        store.markLeaseUnconfirmed(leaseId),
      );
      const full = subscriptions.filter(contentAllowed);
      const withheld = subscriptions.filter((entry) => !contentAllowed(entry));
      options.logger.info(
        { tokenCount: full.length, unidentifiedTokenCount: withheld.length },
        "Sending push notification",
      );
      if (full.length > 0)
        await deliver(
          full.map((entry) => entry.token),
          payload,
        );
      if (withheld.length > 0)
        await deliver(
          withheld.map((entry) => entry.token),
          UNIDENTIFIED_PUSH_PAYLOAD,
        );
    },
  };
}

/**
 * Which tokens may receive session content. The Host owner's own devices always may. A device
 * admitted by a lease may only when the Hub, asked now, still grants that lease what the event
 * needs; each lease is asked once per notification and never cached.
 */
async function confirmContent(
  subscriptions: readonly ActivePushSubscription[],
  target: PushNotificationTarget | undefined,
  markUnconfirmed: (leaseId: string) => void,
): Promise<(entry: ActivePushSubscription) => boolean> {
  const confirm = target?.confirmLease;
  const leaseIds = new Set(
    subscriptions.flatMap((entry) =>
      entry.leaseId !== null && !entry.unconfirmed ? [entry.leaseId] : [],
    ),
  );
  const granted = new Set<string>();
  if (confirm)
    await Promise.all(
      [...leaseIds].map(async (leaseId) => {
        const answer = await confirm(leaseId).catch(
          (): LeaseConfirmation => ({ granted: false, revoked: false }),
        );
        if (answer.granted) granted.add(leaseId);
        else if (answer.revoked) markUnconfirmed(leaseId);
      }),
    );
  return (entry) => entry.leaseId === null || (!entry.unconfirmed && granted.has(entry.leaseId));
}
