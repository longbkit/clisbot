import type pino from "pino";

import { PushService, type PushPayload } from "./push-service.js";
import {
  PushTokenStore,
  type PushNotificationTarget,
  type PushTokenAuthorization,
  type PushTokenReaderUpdate,
} from "./token-store.js";

export type { PushPayload };
export type {
  PushNotificationTarget,
  PushTokenAuthorization,
  PushTokenReaderUpdate,
} from "./token-store.js";

const PUSH_TOKEN_LEASE_MS = 48 * 60 * 60 * 1000;

export interface PushNotifications {
  renew(
    token: string,
    authorization?: PushTokenAuthorization,
    reader?: PushTokenReaderUpdate,
  ): void;
  revoke(token: string): void;
  revokeLease(leaseId: string): void;
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
    async send(payload, target) {
      const tokens = store.getActiveTokens(target);
      options.logger.info({ tokenCount: tokens.length }, "Sending push notification");
      if (tokens.length === 0) return;
      await deliver(tokens, payload);
    },
  };
}
