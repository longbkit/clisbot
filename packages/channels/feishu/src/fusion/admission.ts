// Fusion-owned inbound admission step (D-FS-015).
//
// The one place a verified Lark event becomes a durably admitted Hub event.
// It replaces upstream's `feishu-ingress.ts`, which opens OpenClaw's
// SQLite-backed `openChannelIngressQueue`, serializes the raw envelope into it
// and runs its own drain: in Fusion the Hub owns the durable queue
// (`channel_ingress_queue`) and one drain per account, and the shared inbound
// processor (`@getpaseo/channels-shared` `createInboundEventProcessor`)
// persists the normalized event before it returns.
//
// Two callers, one rule.
//
//   * The `Lark.EventDispatcher` handlers below serve BOTH transports: the WS
//     long connection invokes them directly, and the webhook transport invokes
//     the same dispatcher through `createFeishuWebhookInvoker`.
//   * `FeishuWebhookInvoker` is upstream's `receive` contract, unchanged,
//     because it is what makes the HTTP 200 honest:
//       `durable`      — the event is persisted; the 200 carries the marker.
//       `non-durable`  — a well-formed non-turn event; ack without the marker.
//       THROW          — admission did NOT happen; the transport answers 5xx
//                        and Feishu redelivers.
import { AsyncLocalStorage } from "node:async_hooks";
import type * as Lark from "@larksuiteoapi/node-sdk";
import type { ChannelInboundEvent, HostChildLogger } from "@getpaseo/channels-shared";
import type { FeishuBotAddedEvent, FeishuMessageEvent } from "../event-types.js";
import {
  buildFeishuBotMemberEvent,
  buildFeishuCardActionEvent,
  buildFeishuInboundEvent,
  type FeishuInboundBuild,
  type FeishuInboundParams,
} from "./inbound-adapter.js";
import type { FeishuWebhookInvoker } from "./webhook-invoker.js";

export type FeishuAdmissionResult =
  | { kind: "durable" }
  | { kind: "ignored"; reason: string };

export interface FeishuAdmissionOptions extends FeishuInboundParams {
  /** The account's shared inbound processor (`runtime-store.registerAccountInbound`). */
  handleInbound: (event: ChannelInboundEvent) => Promise<{ dispatched: boolean; reason?: string }>;
  logger?: HostChildLogger;
}

export interface FeishuAdmission {
  /** The dispatcher both transports drive. */
  eventDispatcher: Lark.EventDispatcher;
  /** The webhook transport's durable invoker. */
  invokeWebhookEvent: FeishuWebhookInvoker;
  /** Admits one already-normalized build; exported for the transports' tests. */
  admit(build: FeishuInboundBuild): Promise<FeishuAdmissionResult>;
}

/**
 * Registers the handlers on an existing dispatcher (built by the ported
 * `createEventDispatcher`, which carries the account's verification token and
 * encrypt key) and returns the durable invoker over it.
 */
export function createFeishuAdmission(
  eventDispatcher: Lark.EventDispatcher,
  options: FeishuAdmissionOptions,
): FeishuAdmission {
  // One flag per invocation, not per module: the webhook transport can have
  // several requests in flight, and a shared boolean would let one request's
  // durable admission mark another request's 200.
  const invocation = new AsyncLocalStorage<{ durable: boolean }>();

  async function admit(build: FeishuInboundBuild): Promise<FeishuAdmissionResult> {
    if (!build.admit) {
      options.logger?.debug?.("feishu inbound skipped", { reason: build.reason });
      return { kind: "ignored", reason: build.reason };
    }
    // A throw from here means the queue write failed: the caller answers 5xx
    // and Feishu redelivers. Nothing has been acknowledged.
    const decision = await options.handleInbound(build.event);
    // The processor's own drops (in-flight duplicate, queue replay, empty body)
    // are not faults: the event IS accounted for, so the 200 stands without the
    // durable marker.
    return decision.dispatched
      ? { kind: "durable" }
      : { kind: "ignored", reason: decision.reason ?? "not dispatched" };
  }

  async function run(build: FeishuInboundBuild): Promise<void> {
    const result = await admit(build);
    if (result.kind === "durable") {
      const scope = invocation.getStore();
      if (scope !== undefined) scope.durable = true;
    }
  }

  type LarkEventHandlers = Parameters<Lark.EventDispatcher["register"]>[0];
  eventDispatcher.register({
    "im.message.receive_v1": async (data: unknown) => {
      await run(buildFeishuInboundEvent(data as unknown as FeishuMessageEvent, options));
    },
    "card.action.trigger": async (data: unknown) => {
      await run(
        buildFeishuCardActionEvent(
          data as unknown as Parameters<typeof buildFeishuCardActionEvent>[0],
          options,
        ),
      );
      // Lark expects a card-action response body; an empty object leaves the
      // card as rendered, which is right when the Hub owns the follow-up edit.
      return {};
    },
    "im.chat.member.bot.added_v1": async (data: unknown) => {
      await run(buildFeishuBotMemberEvent(data as unknown as FeishuBotAddedEvent, true));
    },
    "im.chat.member.bot.deleted_v1": async (data: unknown) => {
      await run(buildFeishuBotMemberEvent(data as unknown as FeishuBotAddedEvent, false));
    },
  } as unknown as LarkEventHandlers);

  const invokeWebhookEvent: FeishuWebhookInvoker = async (data, params) => {
    const scope = { durable: false };
    const value = await invocation.run(scope, () =>
      eventDispatcher.invoke(data as Parameters<Lark.EventDispatcher["invoke"]>[0], params),
    );
    return { kind: scope.durable ? "durable" : "non-durable", value };
  };

  return { eventDispatcher, invokeWebhookEvent, admit };
}
