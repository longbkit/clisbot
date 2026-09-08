// Fusion-owned inbound admission step (D-ZU-014).
//
// The one place a `zca-js` message becomes a durably admitted Hub event. It
// replaces upstream's `ingress.ts`, which opens OpenClaw's SQLite-backed
// `openChannelIngressQueue`, appends the serialized envelope and runs its own
// drain (`createChannelIngressMonitor` plus retry policy, dead-letter and claim
// lifecycle). In Fusion the Hub owns that store and that drain —
// `channel_ingress_queue` with lease/fencing, per-lane ordering, retry,
// dead-letter and restart drain (goal slices 1 and 8) — and the shared inbound
// processor (`@getpaseo/channels-shared` `createInboundEventProcessor`)
// persists the normalized event before it returns.
//
// What upstream's ingress DECIDES is kept, verbatim in spirit and in spelling:
//
//   * the envelope inspection (`inspectZalouserIngressMessage`): `data.msgId`
//     is the event id, `group:<idTo>` / `direct:<uidFrom>` is the lane key, and
//     a message that is neither `ThreadType.User` nor `ThreadType.Group` is a
//     payload error, not a retryable fault;
//   * the payload-error taxonomy — a payload the inspection refuses is
//     permanently bad and must not burn retry budget;
//   * the authentication-failure classification
//     (`isZalouserAuthenticationFailure`), which upstream marks non-retryable
//     because a dead session cannot be fixed by replaying the message.
//
// THE CONTRACT the listener session depends on. `zca-js` is a push socket with
// NO ack and NO cursor: a message the server pushed is gone. So the session
// must not treat "received" as "handled" — it awaits this result before it
// moves on, and only a `durable` (or a well-formed `ignored`) is an accounted
// message:
//
//   `durable`  — the event is persisted in the Hub queue; the turn will run.
//   `ignored`  — a well-formed non-turn message (own message, empty body); no
//                turn, but the message IS accounted for.
//   `invalid`  — the envelope is not a Zalo message; never retried.
//   THROW      — admission did NOT happen; the session retries in place
//                (`fusion/listener-session.ts`).

import type { ChannelInboundEvent, HostChildLogger } from "@getpaseo/channels-shared";
import {
  collectErrorGraphCandidates,
  extractErrorCode,
} from "@getpaseo/channels-core/plugin-sdk/error-runtime";
import { isRecord } from "@getpaseo/channels-core/plugin-sdk/channel-secret-basic-runtime";
import { normalizeNullableString as nonEmptyString } from "@getpaseo/channels-core/plugin-sdk/string-coerce-runtime";
import { normalizeZaloInboundMessage } from "../zalo-js.js";
import type { Message } from "../zca-client.js";
import { ThreadType } from "../zca-constants.js";
import { buildZalouserInboundEvent, type ZalouserInboundParams } from "./inbound-adapter.js";

/** Upstream `ingress.ts`: the payload error class. A message that trips it is
 * permanently bad and is never retried. */
export class ZalouserIngressPayloadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ZalouserIngressPayloadError";
  }
}

export type ZalouserAdmissionResult =
  | { kind: "durable" }
  | { kind: "ignored"; reason: string }
  | { kind: "invalid"; reason: string };

export interface ZalouserAdmission {
  /** Admits one raw `zca-js` message (the envelope the listener emits). */
  receive(message: Message): Promise<ZalouserAdmissionResult>;
}

export interface ZalouserAdmissionOptions extends ZalouserInboundParams {
  /** The account's shared inbound processor (`runtime-store.registerAccountInbound`). */
  handleInbound: (event: ChannelInboundEvent) => Promise<{ dispatched: boolean; reason?: string }>;
  logger?: HostChildLogger;
}

/** Upstream `ingress.ts` `inspectZalouserIngressMessage`, unchanged: the
 * admission facts the Hub queue row is keyed by. */
export function inspectZalouserIngressMessage(message: unknown): {
  eventId: string;
  laneKey: string;
} {
  if (!isRecord(message) || !isRecord(message.data)) {
    throw new ZalouserIngressPayloadError("zca-js message envelope must contain data.");
  }
  const eventId = nonEmptyString(message.data.msgId);
  if (!eventId) {
    throw new ZalouserIngressPayloadError("zca-js message envelope is missing data.msgId.");
  }
  if (message.type === ThreadType.Group) {
    const groupId = nonEmptyString(message.data.idTo);
    if (!groupId) {
      throw new ZalouserIngressPayloadError("zca-js group message is missing data.idTo.");
    }
    return { eventId, laneKey: `group:${groupId}` };
  }
  if (message.type !== ThreadType.User) {
    throw new ZalouserIngressPayloadError("zca-js message has an unsupported thread type.");
  }
  const senderId = nonEmptyString(message.data.uidFrom);
  if (!senderId) {
    throw new ZalouserIngressPayloadError("zca-js direct message is missing data.uidFrom.");
  }
  return { eventId, laneKey: `direct:${senderId}` };
}

/** Upstream `ingress.ts`, unchanged: a 401/403 anywhere in the error graph is a
 * dead session, which no replay can fix. */
export function isZalouserAuthenticationFailure(error: unknown): boolean {
  for (const candidate of collectErrorGraphCandidates(error, (current) => [current.cause])) {
    const code = extractErrorCode(candidate);
    const record = candidate as { status?: unknown; statusCode?: unknown };
    if (
      code === "401" ||
      code === "403" ||
      record.status === 401 ||
      record.status === 403 ||
      record.statusCode === 401 ||
      record.statusCode === 403
    ) {
      return true;
    }
  }
  return false;
}

export function createZalouserAdmission(
  options: ZalouserAdmissionOptions,
): ZalouserAdmission {
  return {
    async receive(message: Message): Promise<ZalouserAdmissionResult> {
      try {
        // Upstream's two-step: the admission facts first (the id the queue row
        // is keyed by), then the normalization checked against that envelope.
        inspectZalouserIngressMessage(message);
      } catch (error) {
        if (error instanceof ZalouserIngressPayloadError) {
          return { kind: "invalid", reason: error.message };
        }
        throw error;
      }
      const normalized = normalizeZaloInboundMessage(message, options.ownUserId);
      if (normalized === null) {
        return { kind: "invalid", reason: "Zalouser message could not be normalized." };
      }
      const build = buildZalouserInboundEvent(normalized, options);
      if (!build.admit) return { kind: "ignored", reason: build.reason };
      // A throw from here means the queue write failed: the caller retries in
      // place. Nothing has been accounted for.
      const decision = await options.handleInbound(build.event);
      // The processor's own drops (in-flight duplicate, queue replay, empty
      // body) are not faults: the event IS accounted for.
      return decision.dispatched
        ? { kind: "durable" }
        : { kind: "ignored", reason: decision.reason ?? "not dispatched" };
    },
  };
}
