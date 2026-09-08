// Fusion-owned inbound admission step (D-GC-012).
//
// The one place a verified Google Chat webhook envelope becomes a durably
// admitted Hub event. It replaces upstream's `monitor-ingress.ts`, which opens
// OpenClaw's SQLite-backed `openChannelIngressQueue`, serializes the raw
// envelope into it and runs its own drain: in Fusion the Hub owns the durable
// queue (`channel_ingress_queue`) and one drain per account, and the shared
// inbound processor (`@getpaseo/channels-shared`
// `createInboundEventProcessor`) persists the normalized event before it
// returns.
//
// The contract the webhook handler depends on is upstream's `receive` contract,
// unchanged, because it is what makes the HTTP 200 honest:
//
//   `durable`  — the event is persisted; the 200 may carry the accepted marker.
//   `ignored`  — a well-formed non-turn event; ack without the marker.
//   `invalid`  — the payload is not a Google Chat envelope; answer 400.
//   THROW      — admission did NOT happen; answer 5xx so Google redelivers.

import type { ChannelInboundEvent } from "@getpaseo/channels-shared";
import { isRecord } from "@getpaseo/channels-core/plugin-sdk/channel-secret-basic-runtime";
import {
  GoogleChatEventPayloadError,
  parseGoogleChatInboundPayload,
} from "../monitor-event.js";
import {
  buildGoogleChatInboundEvent,
  type GoogleChatInboundParams,
} from "./inbound-adapter.js";

export type GoogleChatAdmissionResult =
  | { kind: "durable" }
  | { kind: "ignored"; reason: string }
  | { kind: "invalid"; reason: string };

export interface GoogleChatWebhookAdmission {
  /** Admits one already-authenticated webhook envelope. */
  receive(raw: unknown): Promise<GoogleChatAdmissionResult>;
}

export interface GoogleChatAdmissionOptions extends GoogleChatInboundParams {
  /** The account's shared inbound processor (`runtime-store.registerAccountInbound`). */
  handleInbound: (event: ChannelInboundEvent) => Promise<{ dispatched: boolean; reason?: string }>;
}

export function createGoogleChatAdmission(
  options: GoogleChatAdmissionOptions,
): GoogleChatWebhookAdmission {
  return {
    async receive(raw: unknown): Promise<GoogleChatAdmissionResult> {
      if (!isRecord(raw)) return { kind: "invalid", reason: "envelope must be an object" };
      let event;
      try {
        event = parseGoogleChatInboundPayload(raw).event;
      } catch (error) {
        // A payload the normalizer refuses is permanently bad; redelivering it
        // would only burn the retry budget, so it is a 400, not a 5xx.
        if (error instanceof GoogleChatEventPayloadError) {
          return { kind: "invalid", reason: error.message };
        }
        throw error;
      }
      const build = buildGoogleChatInboundEvent(event, options);
      if (!build.admit) return { kind: "ignored", reason: build.reason };
      // A throw from here means the queue write failed: the caller answers 5xx
      // and Google redelivers. Nothing has been acknowledged.
      const decision = await options.handleInbound(build.event);
      // The processor's own drops (in-flight duplicate, queue replay, empty
      // body) are not faults: the event IS accounted for, so the 200 stands
      // without the durable marker.
      return decision.dispatched
        ? { kind: "durable" }
        : { kind: "ignored", reason: decision.reason ?? "not dispatched" };
    },
  };
}
