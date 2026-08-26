// The channel execution plane facade (plan §4-S2): the thin object the loader
// drives. It composes the three engines — bindings (thread + continuous
// execution), relay (outbound + delivery ledger), approvals (prompt +
// re-authorization) — over one trusted-client daemon connection, and owns the
// per-decision kill switch (`policy.isEnabled`), the account/route match, and
// the approval-command short-circuit. Decision logic lives in the engines, so
// this stays a routing layer. `DaemonConnection` carries no stream callback
// (events arrive on `TrustedDaemonClient.onStream` in `daemon/ws-client.ts`),
// so the orchestration layer delivers each event here via `onStreamEvent` —
// the one shared consumer that fans out to the relay and the approval engine
// (§4-S3 one code path: relay and approvals are two handlers on one stream).
import type { ThreadBindingRecord } from "../db/types.js";
import type { ChannelStore } from "../db/channels.js";
import type { CompiledChannelAccount, CompiledRoute } from "./config/compile.js";
import type { DaemonConnection } from "./daemon/client.js";
import type { InboundReplyParams } from "./loader/host.js";
import { isEnabled, mayTrigger, matchRoute } from "./policy.js";
import {
  ApprovalEngine,
  assertChannelPosture,
  catchAllRoute,
  parseApprovalCommand,
} from "./approvals/index.js";
import { BindingEngine, deriveBindingKey, parseStoredRouteSummary } from "./bindings/index.js";
import { DEFAULT_PROGRESS_THROTTLE_MS, RelayEngine } from "./relay/index.js";
import { realClock } from "./plane/clock.js";
import { asPermissionRequest, asPermissionResolved, asRelayedEvent } from "./plane/stream.js";
import type {
  ChannelPlaneDeps,
  InboundMessage,
  InboundOutcome,
  P0ChannelName,
  PlaneInboundResult,
  PlaneLogger,
  StreamContext,
} from "./plane/types.js";

/** The execution plane the loader drives for a channel's account(s). */
export interface ChannelPlane {
  /** Drive one normalized inbound channel event (the loader seam's callback). */
  onInbound(params: InboundReplyParams): Promise<PlaneInboundResult>;
  /**
   * One agent stream event from the daemon connection (`onStream` delivery):
   * the single shared consumer that routes `permission_requested` /
   * `permission_resolved` to the approval engine and every other event to the
   * relay. `event` is the wire `unknown` (`daemon/ws-client.ts` hands it over
   * untyped) — narrowed here by `plane/stream.ts`. No-op for agents the plane
   * has not attached.
   */
  onStreamEvent(agentId: string, event: unknown): Promise<void>;
  /**
   * Start the plane against a daemon + store: assert the S10 posture for every
   * route, wait for the trusted session, recover orphan pending markers, and
   * re-attach the streams of the markers that re-bound. Returns the recovery
   * counts.
   */
  start(
    daemon: DaemonConnection,
    store: ChannelStore,
  ): Promise<{ rebound: number; leftPending: number }>;
  /**
   * Attach (or re-attach after a restart) an agent's stream to the relay +
   * approval engines and add it to the timeline subscription. The binding row
   * carries the thread location + initiator the stream context needs.
   */
  attachStreamFor(
    binding: ThreadBindingRecord,
    route: CompiledRoute,
    account: CompiledChannelAccount,
  ): void;
  /** Stop the plane: clear the subscription and stop the daemon connection. */
  stop(): void;
}

/** The plane kind a thread/topic's ROOT conversation carries (the two-pass
 * match's second descriptor; inbound.md). A thread sits in a Slack channel; a
 * topic sits in a Telegram group; everything else is its own root. */
function rootKindOf(
  kind: InboundMessage["conversation"]["kind"],
): InboundMessage["conversation"]["kind"] {
  if (kind === "thread") return "channel";
  if (kind === "topic") return "group";
  return kind;
}

/**
 * Build the execution plane. `deps` carries the control-plane snapshot, the
 * clock + post + logger, the agent-spec resolver, and the inbound normalizer.
 * The daemon + store are injected at `start` (they are per-connection).
 */
export function createChannelPlane(deps: ChannelPlaneDeps): ChannelPlane {
  const clock = deps.clock ?? realClock();
  const logger: PlaneLogger = deps.logger;
  let daemon: DaemonConnection | undefined;
  let store: ChannelStore | undefined;
  let bindings: BindingEngine | undefined;
  let relay: RelayEngine | undefined;
  let approvals: ApprovalEngine | undefined;
  const subscribed = new Set<string>();

  const relayEngine = (): RelayEngine => {
    if (relay === undefined) throw new Error("plane not started");
    return relay;
  };

  const approvalsEngine = (): ApprovalEngine => {
    if (approvals === undefined) throw new Error("plane not started");
    return approvals;
  };

  const bindingsEngine = (): BindingEngine => {
    if (bindings === undefined) throw new Error("plane not started");
    return bindings;
  };

  const plane: ChannelPlane = {
    async onInbound(params) {
      const message = deps.normalizeInbound(params);
      if (message === null) {
        return result(false, { kind: "ignored", reason: "event is not a plane-bound message" });
      }
      const account = deps.controlPlane.accounts.find(
        (candidate) =>
          candidate.channel === message.channel && candidate.accountId === message.accountId,
      );
      if (account === undefined) {
        return result(false, { kind: "ignored", reason: "unknown channel account" });
      }
      // Per-decision kill switch: env flag > org > channel > account. Flag off
      // means no ingest, no binding, no relay (the loader's env short-circuit is
      // the first line; this is the per-decision line — both must hold).
      if (!isEnabled(deps.envFlag, deps.controlPlane, account)) {
        return result(false, { kind: "ignored", reason: "channels disabled (kill switch)" });
      }
      const route = resolveRoute(message, account);
      if (route === undefined) {
        return result(false, { kind: "ignored", reason: "no route matches this conversation" });
      }
      const command = parseApprovalCommand(message.text);
      if (command !== null) {
        return await handleApprovalCommand(message, account, route, command);
      }
      return handleAgentMessage(message, account, route);
    },

    async onStreamEvent(agentId, event) {
      // One shared consumer: permission events to the approval engine, everything
      // else to the relay. Unattached agents are a no-op in both (the stream
      // context is only registered via attachStreamFor / start).
      const request = asPermissionRequest(event);
      if (request !== undefined) {
        await approvals?.handlePermissionRequest(agentId, request);
        return;
      }
      const resolvedId = asPermissionResolved(event);
      if (resolvedId !== undefined) {
        approvals?.onPermissionResolved(agentId, resolvedId);
        return;
      }
      const relayed = asRelayedEvent(event);
      if (relayed !== undefined) await relay?.onStream(agentId, relayed);
    },

    async start(daemonConnection, channelStore) {
      daemon = daemonConnection;
      store = channelStore;
      bindings = new BindingEngine({
        organizationId: deps.organizationId,
        controlPlane: deps.controlPlane,
        logger,
        clock,
        store: channelStore,
        daemon: daemonConnection,
        resolveAgentSpec: deps.resolveAgentSpec,
      });
      relay = new RelayEngine({
        organizationId: deps.organizationId,
        logger,
        clock,
        store: channelStore,
        post: deps.post,
        sessionLink: deps.sessionLink,
        progressThrottleMs: deps.progressThrottleMs ?? DEFAULT_PROGRESS_THROTTLE_MS,
      });
      approvals = new ApprovalEngine({
        organizationId: deps.organizationId,
        controlPlane: deps.controlPlane,
        logger,
        clock,
        store: channelStore,
        daemon: daemonConnection,
        post: deps.post,
      });
      // The S10 posture invariant, asserted at load (not mid-conversation):
      // every route — and every catch-all fallback — keeps approval-required.
      assertChannelPosture(deps.controlPlane.accounts);
      await daemonConnection.waitForConnected();
      // Orphan recovery: rebind a surviving agent instead of re-creating it,
      // then re-attach the streams of the markers that re-bound so in-flight
      // turns relay + prompt again.
      const pendingBefore = await channelStore.listPendingThreadBindings(deps.organizationId);
      const recovered = await bindings.recoverOrphans();
      for (const marker of pendingBefore) {
        await reattachBinding(
          channelStore,
          marker.accountId,
          marker.conversationId,
          marker.externalThreadId,
        );
      }
      logger.info?.("channel plane started", {
        rebound: recovered.rebound,
        leftPending: recovered.leftPending,
      });
      return recovered;
    },

    attachStreamFor(binding, route, account) {
      const context = streamContextFor(binding, route, account);
      relayEngine().attach(context);
      approvalsEngine().bindStream(context);
      if (binding.agentId !== null) subscribed.add(binding.agentId);
      // Fire-and-forget: a resubscribe still in flight when `stop()` runs is
      // rejected ("daemon client stopped") — expected teardown, not a live
      // failure, so it must not surface as an unhandled rejection.
      void resubscribe().catch(() => undefined);
    },

    stop() {
      if (daemon !== undefined) {
        void daemon.setTimelineSubscription([]).catch(() => undefined);
        daemon.stop();
      }
      daemon = undefined;
      store = undefined;
      bindings = undefined;
      relay = undefined;
      approvals = undefined;
      subscribed.clear();
    },
  };

  // --- Inbound sub-flows -----------------------------------------------------

  async function handleAgentMessage(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
  ): Promise<PlaneInboundResult> {
    const outcome = await bindingsEngine().bindOrSteer(message, account, route);
    if (outcome.kind === "bound" || outcome.kind === "steered") {
      // Attach (or re-attach, after a restart) the session's stream now that the
      // binding is bound, with the live route this message resolved to.
      const key = deriveBindingKey(message.conversation, route.defaults.bindingKey);
      const binding = await store?.findThreadBinding(
        deps.organizationId,
        account.accountId,
        key.conversationId,
        key.externalThreadId,
      );
      if (
        binding !== undefined &&
        binding.status === "bound" &&
        binding.agentId !== null &&
        binding.agentId === outcome.agentId
      ) {
        plane.attachStreamFor(binding, route, account);
      }
    }
    return result(outcome.kind === "bound" || outcome.kind === "steered", outcome);
  }

  async function handleApprovalCommand(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    command: { decision: "allow" | "deny"; requestId: string },
  ): Promise<PlaneInboundResult> {
    const key = deriveBindingKey(message.conversation, route.defaults.bindingKey);
    const binding = await store?.findThreadBinding(
      deps.organizationId,
      account.accountId,
      key.conversationId,
      key.externalThreadId,
    );
    if (binding === undefined || binding.status !== "bound" || binding.agentId === null) {
      return result(false, {
        kind: "command",
        handled: false,
        detail: "no bound session to answer this approval",
      });
    }
    // First authority check (inbound entry): the responder may take part in this
    // conversation. The second (mayApprove: class privilege + initiatorOnly)
    // runs in the approval engine, at dispatch, against the current rule set.
    if (!mayTrigger(message.senderIdentity, deps.controlPlane, account, route)) {
      return result(false, {
        kind: "command",
        handled: false,
        detail: "sender may not take part in this conversation",
      });
    }
    const check = await approvalsEngine().answerFromChannel(
      binding.agentId,
      message.senderIdentity,
      { decision: command.decision, requestId: command.requestId },
    );
    return result(check.answered, {
      kind: "command",
      handled: check.answered,
      detail: check.answered ? `answered (${command.decision})` : `refused (${check.reason})`,
    });
  }

  // --- Start re-attach -------------------------------------------------------

  /** Re-attach one stored binding's stream when it is bound (start recovery). */
  async function reattachBinding(
    channelStore: ChannelStore,
    accountId: string,
    conversationId: string,
    externalThreadId: string | null,
  ): Promise<void> {
    const binding = await channelStore.findThreadBinding(
      deps.organizationId,
      accountId,
      conversationId,
      externalThreadId,
    );
    if (binding === undefined || binding.status !== "bound" || binding.agentId === null) return;
    const account = findAccountForBinding(binding);
    const route = routeForBinding(binding);
    if (account === undefined || route === undefined) return;
    plane.attachStreamFor(binding, route, account);
  }

  // --- Routing ---------------------------------------------------------------

  /**
   * Two-pass route match (pinned-vertical-contracts/inbound.md): a
   * thread/topic-level message matches the THREAD-LEVEL descriptor first
   * (`{kind: thread|topic, id: threadId}`), then the ROOT descriptor
   * (`{kind: dm|channel|group, id: rootConversationId}`); first hit in
   * declaration order wins. `matchRoute` stays a pure single-level matcher.
   * A root-level message carries no thread id — one pass at the root.
   */
  function resolveRoute(
    message: InboundMessage,
    account: CompiledChannelAccount,
  ): CompiledRoute | undefined {
    const conversation = message.conversation;
    const rootKind = rootKindOf(conversation.kind);
    const descriptors =
      conversation.threadId !== null
        ? [
            { kind: conversation.kind, id: conversation.id },
            { kind: rootKind, id: conversation.rootConversationId },
          ]
        : [{ kind: rootKind, id: conversation.rootConversationId }];
    for (const descriptor of descriptors) {
      const match = matchRoute(descriptor, account);
      if (match.route !== null) return match.route;
    }
    const fallback = account.fallback;
    if (fallback.deny) return undefined;
    return catchAllRoute(fallback);
  }

  function streamContextFor(
    binding: ThreadBindingRecord,
    route: CompiledRoute,
    account: CompiledChannelAccount,
  ): StreamContext {
    return {
      agentId: binding.agentId ?? "",
      channel: channelName(account),
      accountId: account.accountId,
      conversationId: binding.conversationId,
      externalThreadId: binding.externalThreadId,
      initiator: binding.initiator,
      account,
      route,
    };
  }

  async function resubscribe(): Promise<void> {
    if (daemon === undefined) return;
    await daemon.setTimelineSubscription([...subscribed]);
  }

  function channelName(account: CompiledChannelAccount): P0ChannelName {
    // P0 drives exactly the two verticals; the compiled account's channel is
    // one of them (the store's column is `slack | telegram`).
    return account.channel as P0ChannelName;
  }

  function findAccountForBinding(binding: ThreadBindingRecord): CompiledChannelAccount | undefined {
    return deps.controlPlane.accounts.find(
      (candidate) =>
        candidate.channel === binding.channel && candidate.accountId === binding.accountId,
    );
  }

  /**
   * Re-derive the route a stored binding resolved under: re-match the original
   * conversation descriptor (stored on the binding row) against the account,
   * falling back to the catch-all route. Routes are live, so a config edit is
   * picked up from this re-attach — the binding's stored summary is only the
   * match key, not a pinned rule set.
   */
  function routeForBinding(binding: ThreadBindingRecord): CompiledRoute | undefined {
    const account = findAccountForBinding(binding);
    if (account === undefined) return undefined;
    const descriptor = parseStoredRouteSummary(binding.route) ?? {
      kind: "channel" as const,
      id: binding.conversationId,
    };
    const match = matchRoute(descriptor, account);
    if (match.route !== null) return match.route;
    if (match.fallback.deny) return undefined;
    return catchAllRoute(match.fallback);
  }

  function result(dispatched: boolean, outcome: InboundOutcome): PlaneInboundResult {
    const reply: PlaneInboundResult = { dispatched, outcome };
    if (dispatched) reply.dispatchResult = { queuedFinal: false, counts: {} };
    return reply;
  }

  return plane;
}
