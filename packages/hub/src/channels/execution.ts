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
import type { AgentSnapshot } from "./daemon/types.js";
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
  type ApprovalCommand,
} from "./approvals/index.js";
import { parseCardValue } from "./approvals/card.js";
import {
  parseChannelTextCommand,
  textCommandHelpText,
  type ChannelTextCommand,
} from "./commands.js";
import { BindingEngine, deriveBindingKey, parseStoredRouteSummary } from "./bindings/index.js";
import { DEFAULT_PROGRESS_THROTTLE_MS, RelayEngine } from "./relay/index.js";
import { realClock } from "./plane/clock.js";
import { createProcessingController, type ProcessingController } from "./plane/processing.js";
import {
  asPermissionRequest,
  asPermissionResolved,
  asRelayedEvent,
  asSubagentEvent,
} from "./plane/stream.js";
import type { AgentPermissionRequest } from "./daemon/types.js";
import type {
  ApprovalCallbackParams,
  ChannelPlaneDeps,
  InboundMessage,
  InboundOutcome,
  P0ChannelName,
  PlaneInboundResult,
  PlaneLogger,
  StreamContext,
} from "./plane/types.js";

/**
 * The live location of one inbound marker: the native thread it sat in and
 * its native message id. In-memory only — attached to the stream context for
 * this marker's turn, never persisted; a restart re-attach has no marker, so
 * the reply location falls back to the binding's persisted thread.
 */
export interface InboundTriggerRef {
  /** The native thread the marker sat in (null when it was at root level). */
  threadId: string | null;
  /** The marker's native message id (Slack `ts`); absent when uncarried. */
  messageId?: string | undefined;
}

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
   * One subagent wire frame (`agent.provider_subagents.update`, the
   * `provider_subagents`-gated child descriptors + timeline; `daemon/ws-client.ts`
   * delivers it via `onSubagentUpdate`). Unlike `onStreamEvent` the frame carries
   * its own `parentAgentId` — narrowed here by `plane/stream.ts` `asSubagentEvent`
   * and routed to the relay (subagent text has no approval path). No-op for
   * parent agents the plane has not attached.
   */
  onSubagentFrame(frame: unknown): Promise<void>;
  /**
   * COMPAT(clisbot-control-plane): one native approval-card button click
   * (Slack `interactive` over Socket Mode; Telegram `callback_query` — the
   * in-repo poll seam's deferred half). The button carries NO authority — it
   * is data (`command`); the resolver's two authority checks (the binding's
   * `mayTrigger` first, the engine's `mayApprove` second) run exactly as for
   * a typed command, and the exactly-once latch makes a racing second click
   * (or a typed command, or a client answer) an inert no-op.
   */
  onApprovalCallback(params: ApprovalCallbackParams): Promise<PlaneInboundResult>;
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
    trigger?: InboundTriggerRef,
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
  /** The turn-lifecycle surfaces opened by accepted inbounds (plane/processing.ts). */
  let processing: ProcessingController | undefined;
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
      // The channel's other plain-text commands (/status, /stop, /new, /help —
      // shared, channel-agnostic; see commands.ts).
      const textCommand = parseChannelTextCommand(message.text);
      if (textCommand !== null) {
        return await handleTextCommand(message, account, route, textCommand);
      }
      return handleAgentMessage(message, account, route);
    },

    async onApprovalCallback(params) {
      // The native card's button click: the SAME two-authority path as a typed
      // command (E3: card click, typed command, and client answer converge on
      // the one exactly-once resolver — the button is data, not authority).
      // The card value is parsed ONCE here (hub) — the vertical hands over the
      // opaque value, the hub's card scheme owns its format.
      const card = parseCardValue(params.cardValue);
      if (card === null) {
        return result(false, {
          kind: "command",
          handled: false,
          detail: "not an approval card click (unknown card value)",
        });
      }
      const account = deps.controlPlane.accounts.find(
        (candidate) =>
          candidate.channel === params.channel && candidate.accountId === params.accountId,
      );
      if (account === undefined) {
        return result(false, { kind: "ignored", reason: "unknown channel account" });
      }
      if (!isEnabled(deps.envFlag, deps.controlPlane, account)) {
        return result(false, { kind: "ignored", reason: "channels disabled (kill switch)" });
      }
      const route = resolveRouteForCallback(params, account);
      if (route === undefined) {
        return result(false, { kind: "ignored", reason: "no route matches this conversation" });
      }
      const binding = await store?.findThreadBinding(
        deps.organizationId,
        account.accountId,
        params.externalConversationId,
        params.externalThreadId,
      );
      if (binding === undefined || binding.status !== "bound" || binding.agentId === null) {
        return result(false, {
          kind: "command",
          handled: false,
          detail: "no bound session to answer this approval",
        });
      }
      // First authority check (inbound entry): the clicker may take part in
      // this conversation — a stolen-session card click fails closed here.
      if (!mayTrigger(params.senderIdentity, deps.controlPlane, account, route)) {
        return result(false, {
          kind: "command",
          handled: false,
          detail: "sender may not take part in this conversation",
        });
      }
      const check = await approvalsEngine().answerFromChannel(
        binding.agentId,
        params.senderIdentity,
        {
          decision: card.decision,
          requestId: card.cardId,
          ...(card.answer !== undefined ? { answer: card.answer } : {}),
        },
      );
      return result(check.answered, {
        kind: "command",
        handled: check.answered,
        detail: answerOutcomeDetail(
          check,
          `answered by card (${card.decision})`,
          "prompt already resolved (stale card click)",
        ),
      });
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

    async onSubagentFrame(frame) {
      // The subagent's text rides this separate wire frame (never the root
      // `agent_stream`), so it is a second consumer entry point — but it routes
      // to the same relay, under the subagent's own scope + ledger key.
      const subagent = asSubagentEvent(frame);
      if (subagent !== undefined) await relay?.onSubagentStream(subagent);
    },

    async start(daemonConnection, channelStore) {
      daemon = daemonConnection;
      store = channelStore;
      // Built first: both the inbound path (which opens a surface per accepted
      // message) and the relay (which keeps it alive and releases it) take it
      // at construction.
      processing = createProcessingController({
        logger,
        now: () => clock.now(),
        ...(deps.typing !== undefined ? { drive: deps.typing } : {}),
        ...(deps.processingTtlMs !== undefined ? { ttlMs: deps.processingTtlMs } : {}),
      });
      bindings = new BindingEngine({
        organizationId: deps.organizationId,
        controlPlane: deps.controlPlane,
        logger,
        clock,
        store: channelStore,
        daemon: daemonConnection,
        resolveAgentSpec: deps.resolveAgentSpec,
        ...(processing !== undefined ? { processing } : {}),
      });
      relay = new RelayEngine({
        organizationId: deps.organizationId,
        logger,
        clock,
        store: channelStore,
        post: deps.post,
        // COMPAT(clisbot-control-plane): the native-media post + media home
        // resolution (the agent's recorded cwd, else the shared home root).
        sessionLink: deps.sessionLink,
        progressThrottleMs: deps.progressThrottleMs ?? DEFAULT_PROGRESS_THROTTLE_MS,
        // COMPAT(clisbot-control-plane): the surface is OPENED by the inbound
        // path (plane/processing.ts), not here; the relay keeps it alive on
        // stream events and releases it on the terminal one.
        ...(processing !== undefined ? { processing } : {}),
      });
      approvals = new ApprovalEngine({
        organizationId: deps.organizationId,
        controlPlane: deps.controlPlane,
        logger,
        clock,
        store: channelStore,
        daemon: daemonConnection,
        post: deps.post,
        // The card's in-place update (absent = the card goes stale, the
        // resolution is unaffected).
        ...(deps.update !== undefined ? { update: deps.update } : {}),
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
          marker.externalConversationId,
          marker.externalThreadId,
        );
      }
      logger.info?.("channel plane started", {
        rebound: recovered.rebound,
        leftPending: recovered.leftPending,
      });
      return recovered;
    },

    attachStreamFor(binding, route, account, trigger) {
      const context = streamContextFor(binding, route, account, trigger);
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
      processing?.stopAll();
      processing = undefined;
      subscribed.clear();
    },
  };

  // --- Inbound sub-flows -----------------------------------------------------

  async function handleAgentMessage(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
  ): Promise<PlaneInboundResult> {
    // The stream is subscribed from inside the dispatch, after the agent is
    // known and BEFORE its prompt is delivered — attaching afterwards is what
    // made a new session's first turn invisible (its events, including
    // `turn_started`, landed before anyone was listening).
    const subscribe = async (agentId: string): Promise<void> => {
      const key = deriveBindingKey(message, route);
      const binding = await store?.findThreadBinding(
        deps.organizationId,
        account.accountId,
        key.externalConversationId,
        key.externalThreadId,
      );
      if (binding === undefined || binding.status !== "bound" || binding.agentId !== agentId) {
        return;
      }
      plane.attachStreamFor(binding, route, account, {
        threadId: message.conversation.threadId,
        ...(message.externalMessageId !== undefined
          ? { messageId: message.externalMessageId }
          : {}),
      });
    };
    const outcome = await bindingsEngine().bindOrSteer(message, account, route, subscribe);
    return result(outcome.kind === "bound" || outcome.kind === "steered", outcome);
  }

  async function handleApprovalCommand(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    command: ApprovalCommand,
  ): Promise<PlaneInboundResult> {
    const key = deriveBindingKey(message, route);
    const binding = await store?.findThreadBinding(
      deps.organizationId,
      account.accountId,
      key.externalConversationId,
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
    // Resolve the target against the engine's open prompts: an explicit id
    // must name an open (unresolved) prompt of this agent; a bare command
    // (no id) targets the newest open prompt ("latest").
    const engine = approvalsEngine();
    const target = engine.resolveOpenPrompt(binding.agentId, command.requestId);
    if (target === undefined) {
      const detail =
        command.requestId !== undefined
          ? `no open approval with id ${command.requestId}`
          : "no open approval to answer";
      return result(false, {
        kind: "command",
        handled: false,
        detail,
      });
    }
    const check = await engine.answerFromChannel(
      binding.agentId,
      message.senderIdentity,
      {
        decision: command.decision,
        requestId: target.id,
        ...(command.answer !== undefined ? { answer: command.answer } : {}),
      },
      message.senderName,
    );
    return result(check.answered, {
      kind: "command",
      handled: check.answered,
      detail: answerOutcomeDetail(
        check,
        `answered (${command.decision})`,
        "prompt already resolved (stale answer)",
      ),
    });
  }

  /**
   * One shared text command (/status, /stop, /new, /help — commands.ts):
   * channel-agnostic session controls. /help needs no session; the others act
   * on this conversation's bound agent and answer in-thread through the
   * vertical's outbound (the relay's reply location). Unknown agent / no
   * binding stays inert — the message is consumed, not relayed to the agent.
   */
  async function handleTextCommand(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    command: ChannelTextCommand,
  ): Promise<PlaneInboundResult> {
    const key = deriveBindingKey(message, route);
    // Commands answer where they were asked, at the marker's own level (the
    // binding key may be coarser, e.g. `binding.key: channel`); they never
    // mint threads — that is the relay's `reply.anchor: thread` behavior.
    const location = {
      to: message.conversation.rootConversationId,
      ...(message.conversation.threadId !== null
        ? { threadId: message.conversation.threadId }
        : {}),
    };
    const post = (text: string): Promise<void> =>
      deps
        .post({
          channel: account.channel as P0ChannelName,
          accountId: account.accountId,
          to: location.to,
          ...(location.threadId !== undefined ? { threadId: location.threadId } : {}),
          text,
        })
        .then((res) => {
          if (!res.ok) {
            logger.warn("channel text command reply failed", {
              channel: account.channel,
              accountId: account.accountId,
              command: command.name,
              error: res.error,
            });
          }
          return undefined;
        });

    if (command.name === "help") {
      await post(textCommandHelpText());
      return result(true, { kind: "command", handled: true, detail: "help" });
    }

    const binding = await store?.findThreadBinding(
      deps.organizationId,
      account.accountId,
      key.externalConversationId,
      key.externalThreadId,
    );
    if (binding === undefined || binding.status !== "bound" || binding.agentId === null) {
      await post("No agent session is bound to this conversation yet.");
      return result(false, { kind: "command", handled: false, detail: "no bound session" });
    }
    const agentId = binding.agentId;

    switch (command.name) {
      case "status": {
        let agent: AgentSnapshot | undefined;
        try {
          agent = (await daemon?.listAgents().catch(() => [] as AgentSnapshot[]))?.find(
            (candidate) => candidate.id === agentId,
          );
        } catch {
          agent = undefined;
        }
        if (agent === undefined) {
          await post("The bound agent is not available (it may have stopped).");
          return result(false, { kind: "command", handled: false, detail: "agent not found" });
        }
        const lines = [
          `Agent: ${agent.title || agent.id} (${agent.provider})`,
          `Status: ${agent.status}`,
          `Model: ${agent.model ?? "n/a"}`,
          `Working directory: ${agent.cwd}`,
        ];
        const pending = engineOpenPrompts(agentId);
        if (pending.length > 0) {
          lines.push(`Pending approvals: ${pending.length}`);
        }
        await post(lines.join("\n"));
        return result(true, { kind: "command", handled: true, detail: "status" });
      }
      case "stop": {
        // The trusted-client wire has no dedicated stop RPC: a message with
        // `activeTurnBehavior: "interrupt"` interrupts the running turn
        // (daemon-client `sendAgentMessage` semantics). The daemon then ends
        // the turn (turn_completed / agent_interrupted on the stream).
        try {
          await daemon?.sendAgentMessage(agentId, "", { steer: false });
          await post("⏹️ Stop requested — the running turn is being interrupted.");
          return result(true, { kind: "command", handled: true, detail: "stop requested" });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await post(`Stop request failed: ${errorMessage}`);
          return result(false, { kind: "command", handled: false, detail: "stop failed" });
        }
      }
      case "new": {
        // The in-chat /new surface is not wired yet: the binding engine owns
        // session lifecycle and the daemon wire has no session-reset RPC the
        // plane can call safely. Answer honestly instead of faking it.
        await post(
          "/new is not supported in-channel yet — start a fresh session from the app, or keep this thread going.",
        );
        return result(false, { kind: "command", handled: false, detail: "new not wired" });
      }
    }
  }

  /** One engine's open prompts for an agent (the /status "pending" fact). */
  function engineOpenPrompts(agentId: string): AgentPermissionRequest[] {
    return approvals?.openPromptRequests(agentId) ?? [];
  }

  /** The operator-visible detail of a channel answer (card click or typed
   * command): the outcome of the exactly-once race, not just the decision. */
  function answerOutcomeDetail(
    check: { answered: boolean; stale?: boolean; reason: string },
    answeredDetail: string,
    staleDetail: string,
  ): string {
    if (check.answered) return answeredDetail;
    if (check.stale === true) return staleDetail;
    return `refused (${check.reason})`;
  }

  /**
   * The route a card click's conversation resolves under: the card was posted
   * into a bound thread/topic, so match the THREAD descriptor first (the
   * click's thread id, when the card sat in one), then the ROOT descriptor —
   * the same two-pass order as `resolveRoute` for an inbound message.
   */
  function resolveRouteForCallback(
    params: ApprovalCallbackParams,
    account: CompiledChannelAccount,
  ): CompiledRoute | undefined {
    const threadKind = params.externalThreadId !== null ? threadKindFor(params.channel) : null;
    const descriptors = [
      ...(threadKind !== null && params.externalThreadId !== null
        ? [{ kind: threadKind, id: params.externalThreadId }]
        : []),
      { kind: params.rootKind, id: params.externalConversationId },
    ];
    for (const descriptor of descriptors) {
      const match = matchRoute(descriptor, account);
      if (match.route !== null) return match.route;
    }
    const fallback = account.fallback;
    if (fallback.deny) return undefined;
    return catchAllRoute(fallback);
  }

  /** The thread-level route-match kind of a channel's native threads. */
  function threadKindFor(channel: string): "thread" | "topic" {
    return channel === "telegram" ? "topic" : "thread";
  }

  // --- Start re-attach -------------------------------------------------------

  /** Re-attach one stored binding's stream when it is bound (start recovery). */
  async function reattachBinding(
    channelStore: ChannelStore,
    accountId: string,
    externalConversationId: string,
    externalThreadId: string | null,
  ): Promise<void> {
    const binding = await channelStore.findThreadBinding(
      deps.organizationId,
      accountId,
      externalConversationId,
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
    trigger?: InboundTriggerRef,
  ): StreamContext {
    return {
      agentId: binding.agentId ?? "",
      channel: channelName(account),
      accountId: account.accountId,
      externalConversationId: binding.externalConversationId,
      externalThreadId: binding.externalThreadId,
      // Live marker context: lets `replyLocationFor` follow the marker's own
      // thread when the binding is collapsed (`binding.key: channel`), and
      // mint a reply thread on the marker message itself when it sat at root.
      ...(trigger !== undefined
        ? {
            triggerThreadId: trigger.threadId,
            ...(trigger.messageId !== undefined ? { triggerMessageId: trigger.messageId } : {}),
          }
        : {}),
      initiator: binding.initiator,
      account,
      route,
      // The approval card's `inlineButtons` dm/group gate decides on the
      // binding's stored route summary's kind (thread → channel, topic →
      // group; already mapped at store time — the root-level kind).
      rootKind: rootKindOfBinding(binding),
    };
  }

  /** The binding's ROOT conversation kind from its stored route summary. */
  function rootKindOfBinding(binding: ThreadBindingRecord): StreamContext["rootKind"] {
    const kind = parseStoredRouteSummary(binding.route)?.kind;
    if (kind === "thread") return "channel";
    if (kind === "topic") return "group";
    return kind ?? "channel";
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
      id: binding.externalConversationId,
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
