// upstream: extensions/slack/src/monitor/ingress.ts@5d8067a4483
// Slack plugin module owns durable Events API admission and replay.
//
// D-039: upstream stores the raw Events API envelope in OpenClaw's own
// `ChannelIngressQueue` (single-process SQLite, `createChannelIngressMonitor`,
// its own drain/claim/lane machinery) and replays it into `app.processEvent`
// from that queue. Fusion's Hub already owns the durable queue, the claim
// lease, the lane and the drain (`packages/hub/src/channels/ingress/*`), and
// admission happens inside the listener where the normalized
// `ChannelInboundEvent` is built. So this file keeps upstream's receiver
// wrapper — the seam that decides WHEN Slack is acked — and drops the queue
// half: the wrapper hands the envelope to Bolt with a DEFERRED ack and only
// acks the real Socket Mode envelope once `processEvent` resolves, i.e. once
// the listener's Hub admission returned. A listener fault rejects
// `processEvent`, the envelope is never acked, and Slack redelivers it.
//
// `processEventErrorHandler: async () => false` on the receiver
// (provider-support.ts, upstream) is what keeps Bolt from acking on its own
// error path.
import type { App, Receiver, ReceiverEvent } from "@slack/bolt";
import { asOptionalRecord } from "@getpaseo/channels-core/plugin-sdk/string-coerce-runtime";

function isSlackEventCallback(body: unknown): boolean {
  return asOptionalRecord(body)?.type === "event_callback";
}

export type SlackDurableIngress = {
  wrapReceiver: (receiver: Receiver) => Receiver;
};

export type SlackDurableIngressOptions = {
  /** Observability seam: called with the envelope body type each time an
   * Events API envelope is acked after the listener chain resolved. */
  onAdmitted?: (bodyType: string) => void;
};

/**
 * Ack-after-admission for Slack Events API envelopes.
 *
 * Bolt acks Events API requests inside `App.processEvent` BEFORE the listener
 * middleware chain runs (`App.js`: "Events API requests are acknowledged right
 * away"). That is ack-before-admission, which the Fusion inbound contract
 * forbids. The wrapper therefore replaces the receiver's app with a shim whose
 * `processEvent` swaps in a deferred `ack`, so Bolt's eager ack only records
 * the intent; the real envelope ack fires after the listener returned.
 *
 * Non-`event_callback` payloads (interactive components, slash commands, view
 * submissions) pass straight through: they answer inside Slack's 3s response
 * window and their listener owns the ack.
 */
export function createSlackDurableIngress(
  options: SlackDurableIngressOptions = {},
): SlackDurableIngress {
  let app: App | undefined;

  const acceptReceiverEvent = async (event: ReceiverEvent): Promise<void> => {
    if (!app) {
      throw new Error("Slack ingress receiver is not attached to a Bolt app.");
    }
    if (!isSlackEventCallback(event.body)) {
      await app.processEvent(event);
      return;
    }
    let ackRequested = false;
    let ackResponse: unknown;
    await app.processEvent({
      ...event,
      ack: (async (response?: unknown) => {
        ackRequested = true;
        ackResponse = response;
      }) as ReceiverEvent["ack"],
    });
    if (ackRequested) {
      await event.ack(ackResponse as Parameters<ReceiverEvent["ack"]>[0]);
      options.onAdmitted?.(String(asOptionalRecord(event.body)?.type ?? "event_callback"));
    }
  };

  return {
    wrapReceiver: (receiver) => {
      const client = Reflect.get(receiver as object, "client");
      const wrapped: Receiver & { client?: unknown } = {
        init: (nextApp) => {
          app = nextApp;
          receiver.init({ processEvent: acceptReceiverEvent } as App);
        },
        start: (...args) => receiver.start(...args),
        stop: (...args) => receiver.stop(...args),
        ...(client === undefined ? {} : { client }),
      };
      return wrapped;
    },
  };
}
