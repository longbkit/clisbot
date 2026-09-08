import type { ChannelPrivilegeDecision } from "../access/store.js";
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
import { randomUUID } from "node:crypto";
import type { AgentExecutionRecord, ThreadBindingRecord } from "../db/types.js";
import type { ChannelStore } from "../db/channels.js";
import type { CompiledChannelAccount, CompiledRoute } from "./config/compile.js";
import type { DaemonConnection } from "./daemon/client.js";
import type { InboundReplyParams } from "./loader/host.js";
import { isEnabled, mayTrigger, matchRoute, routeConversationMatches } from "./policy.js";
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
import { redeemChannelCommandButton } from "./command-buttons.js";
import {
  admitChannelAccess,
  mayUseChannelRoute,
  type ChannelAccessGateOutcome,
} from "./policy/gate.js";
import { mayRunChannelCommand, resolveChannelActorRole } from "./policy/roles.js";
import { resolveSelection, selectionMenu } from "./policy/selection.js";
import {
  admitFollowUp,
  BindingEngine,
  deriveBindingKey,
  parseStoredRouteSelection,
  parseStoredRouteSummary,
  routeFingerprint,
  routePosition,
} from "./bindings/index.js";
import { DEFAULT_PROGRESS_THROTTLE_MS, RelayEngine } from "./relay/index.js";
import { ChannelStreamingProducer } from "./streaming/index.js";
import { realClock } from "./plane/clock.js";
import { createProcessingController, type ProcessingController } from "./plane/processing.js";
import {
  dispositionFor,
  INBOUND_DEFAULTS_FLOOR,
  readInboundKind,
  recordsActivity,
  roomEventReason,
  type InboundKindReading,
} from "./plane/inbound-kinds.js";
import {
  RouteExecutionLimiter,
  type RouteExecutionLease,
} from "./plane/route-execution-limiter.js";
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
  SupportedChannelName,
  PlaneInboundResult,
  PlaneLogger,
  StreamContext,
} from "./plane/types.js";
import { isSupportedChannel } from "./catalog.js";
import { ChannelWorkflowRequestPayloadSchema } from "../triggers/channel/provider.js";

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

/**
 * Post one session-command answer where the command was asked. Resolves to
 * whether it reached the channel — the callers that have no other effect
 * (`/help`, `/status`) report that as their `handled` flag.
 */
type CommandReply = (text: string) => Promise<boolean>;

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
  onWorkflowStreamEvent(input: {
    execution: AgentExecutionRecord;
    agentId: string;
    event: unknown;
  }): Promise<void>;
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
  /** Stop the plane; configuration replacement may also cancel Route-owned work. */
  stop(options?: { cancelActive?: boolean }): Promise<void>;
}

/** The plane kind a thread/topic's ROOT conversation carries (the two-pass
 * match's second descriptor; inbound.md). A thread sits in a Slack channel; a
 * topic sits in a Telegram group; everything else is its own root. */
function rootKindOf(kind: InboundMessage["conversation"]["kind"]): "dm" | "channel" | "group" {
  if (kind === "thread") return "channel";
  if (kind === "topic") return "group";
  return kind;
}

function identityLinkReplyText(
  status: "linked" | "already_linked" | "identity_conflict" | "invalid",
): string {
  if (status === "linked") {
    return "Identity linked. You can now use the Channel access assigned to your Hub account.";
  }
  if (status === "already_linked") {
    return "This identity is already linked to your Hub account.";
  }
  if (status === "identity_conflict") {
    return "This provider identity is already linked to another Hub account.";
  }
  return "That link code is invalid or expired. Create a new code in Paseo Settings.";
}

function workflowDeliveryId(message: InboundMessage, route: CompiledRoute): string | undefined {
  if (route.target.kind !== "workflow") return undefined;
  return `${message.channel}:${message.accountId}:${message.externalMessageId ?? randomUUID()}`;
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
  let routeExecutionLimiter: RouteExecutionLimiter | undefined;
  const subscribed = new Set<string>();
  const workflowExecutionAgents = new Map<
    string,
    { agentId: string; agentKey: string; context: StreamContext }
  >();
  const workflowAgentsByBinding = new Map<string, Set<string>>();
  const workflowBindingActivity = new Map<string, number>();

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
        return result(false, {
          kind: "ignored",
          reason: "event is not a plane-bound message",
        });
      }
      const admission = admitAccount(message);
      if (admission.account === undefined) {
        return result(false, { kind: "ignored", reason: admission.reason });
      }
      const account = admission.account;
      // The inbound FAMILY decides what may happen next: only `message` and
      // `command` reach the text parsers below, so a reaction body or a
      // "[Joined] …" notice can never be read as a command or as user text.
      const inbound = readInboundKind(params.ctxPayload);
      if (inbound.kind === "callback" || inbound.kind === "interactive") {
        return await handleInboundCallback(message, account, inbound);
      }
      if (inbound.kind !== "message" && inbound.kind !== "command") {
        const roomEvent = await admitRoomEvent(message, account, inbound);
        // `undefined` = the route promoted this event to a message
        // (`inbound.editNotifications: all`); everything else is settled.
        if (roomEvent !== undefined) return roomEvent;
      }
      const identityCode = parseChannelIdentityLinkCommand(message.text);
      if (identityCode !== null && deps.consumeChannelIdentityChallenge !== undefined) {
        return await handleIdentityLinkCommand(message, account, identityCode);
      }
      const command = parseApprovalCommand(message.text);
      if (command !== null) {
        return await handleApprovalCommand(message, account, command);
      }
      const textCommand = resolveTextCommand(message.text, inbound);
      const workflowCommandRoute =
        textCommand === null ? undefined : activeWorkflowRouteFor(message);
      if (textCommand !== null && workflowCommandRoute !== undefined) {
        return await handleWorkflowTextCommand(message, account, workflowCommandRoute, textCommand);
      }
      const resolved = await resolveInboundRoute(message, account);
      if (resolved.kind !== "selected") {
        return result(false, {
          kind: "ignored",
          reason:
            resolved.kind === "invalid-binding"
              ? "the bound session is not valid under the active Channel configuration"
              : "no route matches this conversation",
        });
      }
      const route = resolved.route;
      // The upstream sender-admission gate (`access:`), in front of everything
      // that could start or steer a turn. A route with no `access:` block
      // allows here and only the RBAC gate decides, exactly as before.
      const gated = await admitAccess(message, account, route);
      if (gated !== undefined) return gated;
      // The channel's other plain-text commands (/status, /stop, /new, /help —
      // shared, channel-agnostic; see commands.ts). Commands are deliberately
      // NOT mention-gated: `requireMention` is about waking the agent, and an
      // admitted sender controlling their own session already addressed the bot
      // by naming a command. The same holds for `kind: command` (a native slash
      // command) and for a button callback, which carry no mention at all.
      if (textCommand !== null) {
        return await handleTextCommand(message, account, route, textCommand);
      }
      // A native command this Hub does not own (`/deploy`, `/model`): it is
      // forwarded to the agent as text only when it addressed the bot.
      if (inbound.kind === "command" && !message.mentionedBot) {
        return recordChannelActivity(message, account, route, {
          result: result(false, { kind: "ignored", reason: "unknown command, bot not addressed" }),
          limitDecision: "not_evaluated",
        });
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
        return result(false, {
          kind: "ignored",
          reason: "unknown channel account",
        });
      }
      if (!isEnabled(deps.envFlag, deps.controlPlane, account)) {
        return result(false, {
          kind: "ignored",
          reason: "channels disabled (kill switch)",
        });
      }
      const target = approvalPromptAt(
        params.channel,
        params.accountId,
        params.externalConversationId,
        params.externalThreadId,
        card.cardId,
      );
      if (target === undefined) {
        return result(false, {
          kind: "command",
          handled: false,
          detail: "no bound session to answer this approval",
        });
      }
      const { context, request } = target;
      // First authority check (inbound entry): the clicker may take part in
      // this conversation — a stolen-session card click fails closed here.
      if (
        !(await mayVerifiedMemberUseChannel(
          callbackMessage(params, account),
          account,
          context.route,
        ))
      ) {
        return result(false, {
          kind: "command",
          handled: false,
          detail: "sender may not take part in this conversation",
        });
      }
      const check = await approvalsEngine().answerFromChannel(
        context.agentId,
        params.senderIdentity,
        {
          decision: card.decision,
          requestId: request.id,
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
      await consumeAgentStream(agentId, event);
      if (isTerminalStreamEvent(event)) {
        routeExecutionLimiter?.completeAgent(agentId);
      }
    },

    async onWorkflowStreamEvent({ execution, agentId, event }) {
      if (workflowExecutionAgents.get(execution.id)?.agentId !== agentId) {
        const channel = channelWorkflowOutput(execution.outputContext);
        if (channel === undefined) return;
        const account = deps.controlPlane.accounts.find(
          (candidate) =>
            candidate.channel === channel.name && candidate.accountId === channel.account_id,
        );
        if (account === undefined) return;
        const route = workflowRouteForCurrentConfiguration(
          account,
          channel,
          execution.launchIntent?.triggerName ?? "workflow",
        );
        if (route === undefined) {
          await daemon?.cancelAgent(agentId).catch(() => undefined);
          logger.warn("Workflow output rejected after its Route changed", {
            account: account.accountId,
            agentId,
            executionId: execution.id,
          });
          return;
        }
        routeExecutionLimiter?.bindOrRestore({
          leaseId: channelWorkflowDeliveryId(execution.triggerContext),
          account,
          route,
          startedAt: execution.startedAt,
          agentId,
        });
        const context: StreamContext = {
          agentId,
          deliveryScopeId: execution.id,
          channel: channel.name,
          accountId: channel.account_id,
          externalConversationId: channel.external_conversation_id,
          externalThreadId: channel.external_thread_id,
          triggerThreadId: channel.trigger_thread_id,
          ...(channel.trigger_message_id === undefined
            ? {}
            : { triggerMessageId: channel.trigger_message_id }),
          initiator: channel.sender_identity,
          rootKind: channel.root_kind,
          route,
          account,
          ...(execution.launchIntent?.environment === undefined
            ? {}
            : {
                accessTarget: {
                  daemonReference: execution.launchIntent.environment.daemonId,
                  ...(execution.launchIntent.environment.projectId === undefined
                    ? {}
                    : {
                        projectId: execution.launchIntent.environment.projectId,
                      }),
                },
              }),
          outputDelivery: workflowOutputDelivery(deps, execution),
        };
        relayEngine().attach(context);
        approvalsEngine().bindStream(context);
        const agentKey = workflowActivityKey(
          channel.binding_key,
          execution.launchIntent?.triggerName ?? "workflow",
        );
        workflowExecutionAgents.set(execution.id, {
          agentId,
          agentKey,
          context,
        });
        const agents = workflowAgentsByBinding.get(agentKey) ?? new Set<string>();
        agents.add(agentId);
        workflowAgentsByBinding.set(agentKey, agents);
      }
      await consumeAgentStream(agentId, event);
      if (isTerminalStreamEvent(event)) {
        routeExecutionLimiter?.completeById(channelWorkflowDeliveryId(execution.triggerContext));
        cleanupWorkflowStream(execution.id, agentId);
      }
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
        readRunningAgentIds: async () =>
          new Set(
            (await daemonConnection.listAgents())
              .filter((agent) => agent.status === "running")
              .map((agent) => agent.id),
          ),
        ...(deps.typing !== undefined ? { drive: deps.typing } : {}),
        ...(deps.processingTtlMs !== undefined ? { ttlMs: deps.processingTtlMs } : {}),
      });
      routeExecutionLimiter = new RouteExecutionLimiter({
        logger,
        now: () => clock.now(),
        cancelAgent: (agentId) => daemonConnection.cancelAgent(agentId),
      });
      bindings = new BindingEngine({
        organizationId: deps.organizationId,
        channelRevisionId: deps.channelRevisionId ?? null,
        controlPlane: deps.controlPlane,
        logger,
        clock,
        store: channelStore,
        daemon: daemonConnection,
        ...(deps.authorizeChannelUse === undefined
          ? {}
          : { authorizeChannelUse: deps.authorizeChannelUse }),
        resolveAgentSpec: deps.resolveAgentSpec,
        ...(deps.replyCapabilities === undefined
          ? {}
          : { replyCapabilities: deps.replyCapabilities }),
        resolveAgentAccessTarget: deps.resolveAgentAccessTarget,
        ...(processing !== undefined ? { processing } : {}),
      });
      // The live-draft producer (slice 22b): mounted only when the loaded
      // vertical exposes a drivable streaming primitive. Absent = the relay's
      // final-only post path, unchanged.
      const streaming =
        deps.streaming === undefined
          ? undefined
          : new ChannelStreamingProducer({
              logger,
              clock,
              driver: deps.streaming,
              post: deps.post,
            });
      relay = new RelayEngine({
        organizationId: deps.organizationId,
        logger,
        clock,
        store: channelStore,
        post: deps.post,
        ...(streaming === undefined ? {} : { streaming }),
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
        ...(deps.authorizeChannelApproval === undefined
          ? {}
          : { authorizeChannelApproval: deps.authorizeChannelApproval }),
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
      const recovered = await bindings.recoverOrphans(deps.accountScope);
      const bound = await channelStore.listBoundThreadBindings(
        deps.organizationId,
        deps.accountScope.channel,
        deps.accountScope.accountId,
      );
      for (const marker of bound) {
        await reattachBinding(
          channelStore,
          marker.accountId,
          marker.externalConversationId,
          marker.externalThreadId,
        );
      }
      if (bound.length > 0) await resubscribe();
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

    async stop(options) {
      if (daemon !== undefined) {
        await daemon.setTimelineSubscription([]).catch(() => undefined);
        if (options?.cancelActive === true) {
          await routeExecutionLimiter?.cancelActive();
        } else {
          routeExecutionLimiter?.clear();
        }
        daemon.stop();
      }
      daemon = undefined;
      store = undefined;
      bindings = undefined;
      relay = undefined;
      approvals = undefined;
      processing?.stopAll();
      processing = undefined;
      routeExecutionLimiter = undefined;
      subscribed.clear();
      workflowExecutionAgents.clear();
      workflowAgentsByBinding.clear();
    },
  };

  // --- Inbound sub-flows -----------------------------------------------------

  /**
   * The account this transport owns, when the kill switch lets it act. The
   * switch is per decision — env flag > org > channel > account — and the
   * loader's env short-circuit is only the first line: both must hold.
   */
  function admitAccount(
    message: InboundMessage,
  ):
    | { account: CompiledChannelAccount; reason?: undefined }
    | { account?: undefined; reason: string } {
    const account = deps.controlPlane.accounts.find(
      (candidate) =>
        message.channel === deps.accountScope.channel &&
        message.accountId === deps.accountScope.accountId &&
        candidate.channel === message.channel &&
        candidate.accountId === message.accountId,
    );
    if (account === undefined) return { reason: "unknown channel account" };
    if (!isEnabled(deps.envFlag, deps.controlPlane, account)) {
      return { reason: "channels disabled (kill switch)" };
    }
    return { account };
  }

  /**
   * The session command this inbound carries. A `command`-family event names
   * its verb in structured facts (a Slack native slash command has no `/` in
   * its text at all); everything else is matched from the text. Both spellings
   * land on the one alias table in `commands.ts`.
   */
  function resolveTextCommand(
    text: string,
    inbound: InboundKindReading,
  ): ChannelTextCommand | null {
    const fromText = parseChannelTextCommand(text);
    if (fromText !== null || inbound.kind !== "command") return fromText;
    const command = inbound.facts.command;
    if (command === undefined) return null;
    // `args` carries what a native slash command puts after the verb, which is
    // where `/model gpt-5.6-luna` keeps its argument.
    return parseChannelTextCommand(`/${command.name} ${command.args ?? ""}`.trimEnd());
  }

  /**
   * `/new` — a fresh session for this conversation. Stop what the bound agent is
   * doing, then let go of the binding: the daemon has no session-reset RPC and
   * does not need one, because the plane owns the conversation→agent map, so
   * releasing the row makes the NEXT message mint a new agent through the
   * ordinary first-mention path. The old agent is left in the app, not deleted.
   */
  async function startNewSession(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    agentId: string,
    post: CommandReply,
  ): Promise<PlaneInboundResult> {
    const { released } = await endBoundSession(account, deriveBindingKey(message, route), agentId);
    if (!released) {
      await post("No agent session is bound to this conversation yet.");
      return result(false, { kind: "command", handled: false, detail: "no bound session" });
    }
    await post("🆕 Started fresh — the next message opens a new session.");
    return result(true, { kind: "command", handled: true, detail: "new session" });
  }

  /** The `link <code>` reply: consume the challenge, then say what happened.
   * A link is not a session command — it answers before any route is resolved,
   * because linking is how an unknown sender BECOMES known. */
  async function handleIdentityLinkCommand(
    message: InboundMessage,
    account: CompiledChannelAccount,
    code: string,
  ): Promise<PlaneInboundResult> {
    const status = await deps.consumeChannelIdentityChallenge!({
      organizationId: deps.organizationId,
      account,
      senderIdentity: message.senderIdentity,
      ...(message.senderName === undefined ? {} : { senderName: message.senderName }),
      code,
    });
    const response = await deps.post({
      channel: channelName(account),
      accountId: account.accountId,
      to: message.conversation.rootConversationId,
      ...(message.conversation.threadId === null
        ? {}
        : { threadId: message.conversation.threadId }),
      text: identityLinkReplyText(status),
    });
    if (!response.ok) {
      logger.warn("channel identity link reply failed", {
        channel: account.channel,
        accountId: account.accountId,
        status,
        error: response.error,
      });
    }
    return result(status === "linked" || status === "already_linked", {
      kind: "command",
      handled: true,
      detail: `identity link ${status}`,
    });
  }

  /**
   * Room activity — a reaction, a join, a pin, a topic or poll event, an edit,
   * a delete. None of these is a request, so none starts a turn; they are
   * recorded against the route that owns the conversation so an operator can
   * see them in channel activity. Returns `undefined` only when the route
   * promoted the event to a message (`inbound.editNotifications: all`).
   */
  async function admitRoomEvent(
    message: InboundMessage,
    account: CompiledChannelAccount,
    inbound: InboundKindReading,
  ): Promise<PlaneInboundResult | undefined> {
    const resolved = await resolveInboundRoute(message, account);
    const route = resolved.kind === "selected" ? resolved.route : undefined;
    const defaults = route?.defaults.inbound ?? INBOUND_DEFAULTS_FLOOR;
    if (dispositionFor(inbound.kind, defaults) === "message") return undefined;
    const ignored = result(false, { kind: "ignored", reason: roomEventReason(inbound.kind) });
    if (route === undefined || !recordsActivity(inbound.kind, defaults)) return ignored;
    return await recordChannelActivity(message, account, route, {
      result: ignored,
      limitDecision: "not_evaluated",
    });
  }

  /**
   * A button, select or modal submit. Three outcomes, in order: the value is an
   * approval card and goes to the one exactly-once approval resolver (the same
   * entry a native card click takes, so authority is checked identically); the
   * action id redeems a command button this Hub minted, and the recorded
   * command runs; neither, and it is ignored with a log — an unknown action id
   * is a card this Hub did not post.
   *
   * The action id is never parsed as a command directly. A `message` tool call
   * can put any text in a button, so a raw `/new` reaching `handleTextCommand`
   * would be the model handing every member of the conversation a session
   * control (`command-buttons.ts`).
   */
  async function handleInboundCallback(
    message: InboundMessage,
    account: CompiledChannelAccount,
    inbound: InboundKindReading,
  ): Promise<PlaneInboundResult> {
    const callback = inbound.facts.callback;
    if (callback === undefined) {
      return result(false, {
        kind: "command",
        handled: false,
        detail: "callback carries no action facts",
      });
    }
    if (callback.value !== undefined && parseCardValue(callback.value) !== null) {
      return await plane.onApprovalCallback({
        channel: message.channel,
        accountId: message.accountId,
        senderIdentity: message.senderIdentity,
        cardValue: callback.value,
        externalConversationId: message.conversation.rootConversationId,
        externalThreadId: message.conversation.threadId,
        rootKind: rootKindOf(message.conversation.kind),
      });
    }
    const redeemed = redeemChannelCommandButton(callback.actionId, {
      organizationId: deps.organizationId,
      channel: message.channel,
      accountId: message.accountId,
      conversationId: message.conversation.rootConversationId,
      ...(message.conversation.threadId === null
        ? {}
        : { threadId: message.conversation.threadId }),
      actorId: callback.actorId,
    });
    const command = redeemed.ok ? parseChannelTextCommand(redeemed.command) : null;
    if (command === null) {
      const reason = redeemed.ok ? "unrecognized-command" : redeemed.reason;
      logger.info?.("channel command button refused", {
        channel: message.channel,
        accountId: message.accountId,
        actionId: callback.actionId,
        actorId: callback.actorId,
        reason,
      });
      return result(false, {
        kind: "command",
        handled: false,
        detail: `unknown callback action (${callback.actionId}): ${reason}`,
      });
    }
    const resolved = await resolveInboundRoute(message, account);
    if (resolved.kind !== "selected") {
      return result(false, {
        kind: "command",
        handled: false,
        detail: "no route owns this conversation",
      });
    }
    // The same sender gate a typed command passes: a token this Hub minted is
    // still not authority for a sender the route's `access:` block refuses.
    const gated = await admitAccess(message, account, resolved.route);
    if (gated !== undefined) return gated;
    return await handleTextCommand(message, account, resolved.route, command);
  }

  async function handleAgentMessage(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
  ): Promise<PlaneInboundResult> {
    const admission =
      route.target.kind === "workflow"
        ? await admitWorkflowMessage(message, account, route)
        : await bindingsEngine().admit(message, account, route);
    if (!admission.allowed) {
      return recordChannelActivity(message, account, route, {
        result: result(false, {
          kind: "ignored",
          reason: admission.reason ?? "message not admitted",
        }),
        limitDecision: "not_evaluated",
      });
    }
    const deliveryId = workflowDeliveryId(message, route);
    const routeLimit = routeExecutionLimiter?.admit({
      account,
      route,
      senderIdentity: message.senderIdentity,
      text: message.text,
      ...(deliveryId === undefined ? {} : { leaseId: deliveryId }),
    }) ?? { allowed: true as const };
    if (!routeLimit.allowed) {
      // A ceiling that clears with time is back-pressure: say so, so a durable
      // ingress returns the message instead of completing it as handled.
      const declined = result(false, { kind: "ignored", reason: routeLimit.reason });
      if (routeLimit.retryAfterMs !== undefined) {
        declined.deferred = { reason: routeLimit.reason, retryAfterMs: routeLimit.retryAfterMs };
      }
      return recordChannelActivity(message, account, route, {
        result: declined,
        limitDecision: "denied",
        limitReason: routeLimit.reason,
      });
    }
    const executionLease = routeLimit.lease;
    if (route.target.kind === "workflow") {
      return dispatchWorkflowMessage(
        message,
        account,
        route,
        route.target.workflow,
        deliveryId!,
        executionLease,
      );
    }
    return dispatchDirectAgentMessage(message, account, route, executionLease);
  }

  async function dispatchWorkflowMessage(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    workflow: string,
    deliveryId: string,
    executionLease: RouteExecutionLease | undefined,
  ): Promise<PlaneInboundResult> {
    const key = deriveBindingKey(message, route);
    const conversationLabel = message.conversationLabel?.trim().slice(0, 200);
    const bindingKey = JSON.stringify([
      message.channel,
      message.accountId,
      key.externalConversationId,
      key.externalThreadId,
    ]);
    try {
      await deps.dispatchWorkflow({
        organizationId: deps.organizationId,
        deliveryId,
        receivedAt: new Date(clock.now()),
        payload: {
          workflow,
          text: message.text,
          channel: {
            name: message.channel,
            account_id: message.accountId,
            binding_key: bindingKey,
            external_conversation_id: key.externalConversationId,
            external_thread_id: key.externalThreadId,
            ...(conversationLabel ? { conversation_label: conversationLabel } : {}),
            sender_identity: message.senderIdentity,
            ...(message.senderName === undefined ? {} : { sender_name: message.senderName }),
            root_kind: rootKindOf(message.conversation.kind),
            trigger_thread_id: message.conversation.threadId,
            ...(message.externalMessageId === undefined
              ? {}
              : { trigger_message_id: message.externalMessageId }),
            revision_id: deps.channelRevisionId ?? null,
            route_position: routePosition(account, route),
            route_fingerprint: routeFingerprint(route),
            route: {
              ...(route.audience === undefined ? {} : { audience: route.audience }),
              defaultRoles: [...route.defaultRoles],
              assignments: [...route.assignments],
              defaults: route.defaults,
              approval: [...route.approval],
              ...(route.limits === undefined ? {} : { limits: route.limits }),
            },
          },
        },
      });
    } catch (error) {
      routeExecutionLimiter?.complete(executionLease);
      await recordChannelActivity(message, account, route, {
        result: result(false, {
          kind: "ignored",
          reason: "workflow dispatch failed",
        }),
        outcome: "error",
        outcomeDetail: "workflow dispatch failed",
        limitDecision: "allowed",
      });
      throw error;
    }
    workflowBindingActivity.set(workflowActivityKey(bindingKey, workflow), clock.now());
    return recordChannelActivity(message, account, route, {
      result: result(true, { kind: "workflow", workflow, deliveryId }),
      limitDecision: "allowed",
    });
  }

  async function dispatchDirectAgentMessage(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    executionLease: RouteExecutionLease | undefined,
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
    let outcome: InboundOutcome;
    try {
      outcome = await bindingsEngine().bindOrSteer(message, account, route, subscribe);
    } catch (error) {
      routeExecutionLimiter?.complete(executionLease);
      await recordChannelActivity(message, account, route, {
        result: result(false, {
          kind: "ignored",
          reason: "agent dispatch failed",
        }),
        outcome: "error",
        outcomeDetail: "agent dispatch failed",
        limitDecision: "allowed",
      });
      throw error;
    }
    if (outcome.kind === "bound" || outcome.kind === "steered") {
      routeExecutionLimiter?.bind(executionLease, outcome.agentId);
    } else {
      routeExecutionLimiter?.complete(executionLease);
    }
    return recordChannelActivity(message, account, route, {
      result: result(outcome.kind === "bound" || outcome.kind === "steered", outcome),
      limitDecision: "allowed",
    });
  }

  async function recordChannelActivity(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    decision: {
      result: PlaneInboundResult;
      outcome?: "bound" | "steered" | "workflow" | "ignored" | "denied" | "error";
      outcomeDetail?: string | undefined;
      limitDecision: "not_evaluated" | "allowed" | "denied";
      limitReason?: string | undefined;
    },
  ): Promise<PlaneInboundResult> {
    if (deps.recordChannelInboundActivity === undefined) {
      return decision.result;
    }
    try {
      const outcome = decision.result.outcome;
      const recordedOutcome = decision.outcome ?? activityOutcome(outcome);
      const outcomeDetail =
        decision.outcomeDetail ?? (outcome?.kind === "ignored" ? outcome.reason : undefined);
      await deps.recordChannelInboundActivity({
        organizationId: deps.organizationId,
        channel: message.channel,
        accountId: account.accountId,
        routePosition: routePosition(account, route),
        routeFingerprint: routeFingerprint(route),
        externalConversationId: message.conversation.rootConversationId,
        externalThreadId: message.conversation.threadId,
        senderIdentity: message.senderIdentity,
        outcome: recordedOutcome,
        ...(outcomeDetail === undefined ? {} : { outcomeDetail }),
        limitDecision: decision.limitDecision,
        ...(decision.limitReason === undefined ? {} : { limitReason: decision.limitReason }),
      });
    } catch (error) {
      logger.warn("channel activity record failed", {
        channel: message.channel,
        accountId: account.accountId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return decision.result;
  }

  function activityOutcome(
    outcome: InboundOutcome | undefined,
  ): "bound" | "steered" | "workflow" | "ignored" {
    if (outcome?.kind === "bound") return "bound";
    if (outcome?.kind === "steered") return "steered";
    if (outcome?.kind === "workflow") return "workflow";
    return "ignored";
  }

  async function admitWorkflowMessage(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
  ): Promise<ReturnType<typeof admitFollowUp>> {
    if (route.target.kind !== "workflow") throw new Error("workflow route is required");
    const authorization = await mayUseChannel(message, account, route);
    if (!authorization.allowed) return authorization;
    const key = deriveBindingKey(message, route);
    const bindingKey = JSON.stringify([
      message.channel,
      message.accountId,
      key.externalConversationId,
      key.externalThreadId,
    ]);
    const persisted = await store?.findWorkflowBindingActivity(
      deps.organizationId,
      bindingKey,
      route.target.workflow,
    );
    const lastActivity =
      workflowBindingActivity.get(workflowActivityKey(bindingKey, route.target.workflow)) ??
      persisted?.getTime();
    if (lastActivity === undefined) {
      return route.defaults.requireMention && !message.mentionedBot
        ? { allowed: false, reason: "not mentioned; requireMention is on" }
        : { allowed: true };
    }
    return admitFollowUp(
      message,
      route.defaults,
      clock.now() - lastActivity > route.defaults.followUp.ttlMinutes * 60_000,
    );
  }

  async function handleApprovalCommand(
    message: InboundMessage,
    account: CompiledChannelAccount,
    command: ApprovalCommand,
  ): Promise<PlaneInboundResult> {
    const target = approvalPromptAt(
      message.channel,
      message.accountId,
      message.conversation.rootConversationId,
      message.conversation.threadId,
      command.requestId,
    );
    if (target === undefined) {
      return result(false, {
        kind: "command",
        handled: false,
        detail:
          command.requestId === undefined
            ? "no open approval to answer"
            : `no open approval with id ${command.requestId}`,
      });
    }
    const { context, request } = target;
    // First authority check (inbound entry): the responder may take part in this
    // conversation. The second (mayApprove: class privilege + initiatorOnly)
    // runs in the approval engine, at dispatch, against the current rule set.
    if (!(await mayVerifiedMemberUseChannel(message, account, context.route))) {
      return result(false, {
        kind: "command",
        handled: false,
        detail: "sender may not take part in this conversation",
      });
    }
    const engine = approvalsEngine();
    const check = await engine.answerFromChannel(
      context.agentId,
      message.senderIdentity,
      {
        decision: command.decision,
        requestId: request.id,
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
    const post = commandReplyFor(message, account, command.name);
    if (command.name === "help") {
      return replyOnlyOutcome(await post(textCommandHelpText()), "help");
    }
    if (!(await mayUseChannel(message, account, route)).allowed) {
      return result(false, {
        kind: "command",
        handled: false,
        detail: "sender may not control this conversation",
      });
    }
    const role = await actorRole(message, account, route);
    if (!mayRunChannelCommand(command.name, role)) {
      await post(`\`/${command.name}\` needs owner or admin rights in this conversation.`);
      return result(false, {
        kind: "command",
        handled: false,
        detail: `role ${role} may not run /${command.name}`,
      });
    }
    // `/agent` and `/model` are conversation-scoped and need no session: the
    // choice applies to the session the NEXT message opens.
    if (command.name === "agent" || command.name === "model") {
      return await switchConversationTarget(message, account, route, command, post);
    }
    const agentId = await conversationAgentFor(message, account, route);
    if (agentId === undefined) {
      await post("No agent session is bound to this conversation yet.");
      return result(false, { kind: "command", handled: false, detail: "no bound session" });
    }
    switch (command.name) {
      case "status":
        return await reportSessionStatus(message, account, route, agentId, post);
      case "stop":
        return await stopBoundTurn(agentId, post);
      case "new":
        return await startNewSession(message, account, route, agentId, post);
      default:
        return result(false, { kind: "command", handled: false, detail: "unsupported command" });
    }
  }

  /**
   * The sender's role in this conversation: `owner` for whoever started the
   * bound session, then the privilege projection in `policy/roles.ts`.
   */
  async function actorRole(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
  ) {
    const key = deriveBindingKey(message, route);
    const binding = await store?.findThreadBinding(
      deps.organizationId,
      account.accountId,
      key.externalConversationId,
      key.externalThreadId,
    );
    return resolveChannelActorRole({
      senderIdentity: message.senderIdentity,
      controlPlane: deps.controlPlane,
      route,
      ...(binding?.initiator === undefined ? {} : { initiator: binding.initiator }),
    });
  }

  /**
   * `/agent <name>` and `/model <name>`. The choice is persisted against the
   * CONVERSATION, then the running session is ended the way `/new` ends it, so
   * the next message opens a session on the new target. Ending it is the whole
   * mechanism: a running agent's provider and model are fixed at create time.
   *
   * A bare `/agent` or `/model` prints the route's menu and changes nothing.
   */
  async function switchConversationTarget(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    command: Extract<ChannelTextCommand, { name: "agent" | "model" }>,
    post: CommandReply,
  ): Promise<PlaneInboundResult> {
    const menu = selectionMenu(route);
    const options = command.name === "agent" ? menu.agents : menu.models;
    if (command.value === undefined) {
      const listed = options.length === 0 ? "none configured" : options.join(", ");
      return replyOnlyOutcome(
        await post(`Available ${command.name}s: ${listed}.`),
        `${command.name} menu`,
      );
    }
    const selection = resolveSelection(command.name, command.value, route);
    if (!selection.ok) {
      await post(selection.message);
      return result(false, { kind: "command", handled: false, detail: selection.message });
    }
    const key = deriveBindingKey(message, route);
    await store?.access.setConversationSelection(
      {
        organizationId: deps.organizationId,
        channel: message.channel,
        accountId: account.accountId,
        externalConversationId: key.externalConversationId,
        externalThreadId: key.externalThreadId,
      },
      {
        ...(selection.kind === "agent"
          ? { selectedAgent: selection.value }
          : { selectedModel: selection.value }),
        selectedBy: message.senderIdentity,
      },
    );
    await endBoundSession(account, key, await conversationAgentFor(message, account, route));
    await post(`✅ ${selection.kind === "agent" ? "Agent" : "Model"} set to ${selection.value}.`);
    return result(true, {
      kind: "command",
      handled: true,
      detail: `${selection.kind} set to ${selection.value}`,
    });
  }

  /**
   * Cancel and release whatever session owns this conversation. The shared half
   * of `/new` and of an `/agent` / `/model` switch: the daemon has no
   * session-reset RPC and does not need one, because the plane owns the
   * conversation→agent map, so releasing the row makes the NEXT message mint a
   * session through the ordinary first-mention path. The old agent is left in
   * the app, not deleted.
   */
  async function endBoundSession(
    account: CompiledChannelAccount,
    key: ReturnType<typeof deriveBindingKey>,
    agentId?: string,
  ): Promise<{ released: boolean }> {
    if (agentId !== undefined) await daemon?.cancelAgent(agentId).catch(() => undefined);
    const released = await store?.releaseThreadBinding({
      organizationId: deps.organizationId,
      accountId: account.accountId,
      externalConversationId: key.externalConversationId,
      externalThreadId: key.externalThreadId,
    });
    const detached = released?.agentId ?? agentId;
    if (detached !== undefined) await detachChannelAgent(detached);
    return { released: released !== undefined };
  }

  /**
   * The ONE reply path every session command answers on — `/help` and
   * `/status` take it exactly as `/stop` and `/new` do. Commands answer where
   * they were asked, at the marker's own level (the binding key may be
   * coarser, e.g. `binding.key: channel`); they never mint threads — that is
   * the relay's `reply.anchor: thread` behavior.
   *
   * It reports whether the post reached the channel, because a command whose
   * only effect is its reply is not "handled" when the post failed: reporting
   * it as handled makes a lost answer indistinguishable from a delivered one
   * in the operator's log.
   */
  function commandReplyFor(
    message: InboundMessage,
    account: CompiledChannelAccount,
    command: ChannelTextCommand["name"],
  ): CommandReply {
    const threadId = message.conversation.threadId;
    return async (text) => {
      const response = await deps.post({
        channel: channelName(account),
        accountId: account.accountId,
        to: message.conversation.rootConversationId,
        ...(threadId === null ? {} : { threadId }),
        text,
      });
      if (!response.ok) {
        logger.warn("channel text command reply failed", {
          channel: account.channel,
          accountId: account.accountId,
          command,
          error: response.error,
        });
      }
      return response.ok;
    };
  }

  /** `/status` — the bound agent's snapshot plus its open approval count. */
  async function reportSessionStatus(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    agentId: string,
    post: CommandReply,
  ): Promise<PlaneInboundResult> {
    const agents = await daemon?.listAgents().catch(() => [] as AgentSnapshot[]);
    const agent = agents?.find((candidate) => candidate.id === agentId);
    if (agent === undefined) {
      await post("The bound agent is not available (it may have stopped).");
      return result(false, { kind: "command", handled: false, detail: "agent not found" });
    }
    const key = deriveBindingKey(message, route);
    const chosen = await store?.access.findConversationSelection({
      organizationId: deps.organizationId,
      channel: message.channel,
      accountId: account.accountId,
      externalConversationId: key.externalConversationId,
      externalThreadId: key.externalThreadId,
    });
    // The route's own target, unless `/agent` moved the conversation off it.
    const targetAgent =
      chosen?.selectedAgent ?? (route.target.kind === "agent" ? route.target.agent : undefined);
    const lines = [
      `Agent: ${agent.title || agent.id} (${agent.provider})`,
      ...(targetAgent === undefined ? [] : [`Route agent: ${targetAgent}`]),
      `Status: ${agent.status}`,
      `Model: ${agent.model ?? "n/a"}`,
      `Working directory: ${agent.cwd}`,
    ];
    const pending = engineOpenPrompts(agentId);
    if (pending.length > 0) lines.push(`Pending approvals: ${pending.length}`);
    return replyOnlyOutcome(await post(lines.join("\n")), "status");
  }

  /**
   * `/stop` — cancellation is a lifecycle RPC. Sending an empty message with
   * activeTurnBehavior=interrupt would replace the turn with a new empty turn,
   * which is observably different and can accidentally continue work.
   */
  async function stopBoundTurn(agentId: string, post: CommandReply): Promise<PlaneInboundResult> {
    try {
      await daemon?.cancelAgent(agentId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await post(`Stop request failed: ${errorMessage}`);
      return result(false, { kind: "command", handled: false, detail: "stop failed" });
    }
    await post("⏹️ Stop requested — the running turn is being interrupted.");
    return result(true, { kind: "command", handled: true, detail: "stop requested" });
  }

  /** The outcome of a command whose ONLY effect is its reply (`/help`,
   * `/status`): undelivered is not handled, and the detail says so. */
  function replyOnlyOutcome(delivered: boolean, detail: string): PlaneInboundResult {
    return result(delivered, {
      kind: "command",
      handled: delivered,
      detail: delivered ? detail : `${detail} reply not delivered`,
    });
  }

  /**
   * A session command against the captured Workflow route (`/stop`, `/help`).
   *
   * This branch never reaches the route selection below, so it runs the route's
   * own `access:` gate itself: without it the branch handed session control to a
   * sender the route refuses.
   */
  async function handleWorkflowTextCommand(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    command: ChannelTextCommand,
  ): Promise<PlaneInboundResult> {
    const gated = await admitAccess(message, account, route);
    return gated ?? (await handleTextCommand(message, account, route, command));
  }

  /**
   * Run the route's `access:` gate. Returns the settled result when the sender
   * is refused (or handed a pairing code), `undefined` when the message may
   * continue. A refusal is recorded in channel activity with the family and the
   * upstream reason code, and — only when the route authored `deniedReply` —
   * answered; upstream refuses silently and so does this by default.
   */
  async function admitAccess(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
  ): Promise<PlaneInboundResult | undefined> {
    if (route.defaults.access === undefined || store === undefined) return undefined;
    const gated = await admitChannelAccess({
      store: store.access,
      organizationId: deps.organizationId,
      account,
      route,
      message,
    });
    if (gated.kind === "allow") return undefined;
    await postAccessRefusal(message, account, gated);
    return recordChannelActivity(message, account, route, {
      result: result(false, { kind: "ignored", reason: gated.reason }),
      outcome: "denied",
      outcomeDetail: `${gated.kind === "pairing" ? "pairing" : "denied"}:${gated.reasonCode}`,
      limitDecision: "not_evaluated",
    });
  }

  /** The one reply a refused sender may see. Absent = silence, as upstream. */
  async function postAccessRefusal(
    message: InboundMessage,
    account: CompiledChannelAccount,
    gated: ChannelAccessGateOutcome,
  ): Promise<void> {
    const text = gated.kind === "allow" ? undefined : gated.reply;
    if (text === undefined) return;
    const response = await deps.post({
      channel: channelName(account),
      accountId: account.accountId,
      to: message.conversation.rootConversationId,
      ...(message.conversation.threadId === null
        ? {}
        : { threadId: message.conversation.threadId }),
      text,
    });
    if (!response.ok) {
      logger.warn("channel access refusal reply failed", {
        channel: account.channel,
        accountId: account.accountId,
        error: response.error,
      });
    }
  }

  async function mayUseChannel(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
  ): Promise<ChannelPrivilegeDecision> {
    return await mayUseChannelRoute({
      ...(store === undefined ? {} : { store: store.access }),
      organizationId: deps.organizationId,
      controlPlane: deps.controlPlane,
      account,
      route,
      message,
      ...(deps.authorizeChannelUse === undefined
        ? {}
        : { authorizeChannelUse: deps.authorizeChannelUse }),
    });
  }

  async function mayVerifiedMemberUseChannel(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
  ): Promise<boolean> {
    if (mayTrigger(message.senderIdentity, deps.controlPlane, account, route)) {
      return Promise.resolve(true);
    }
    return (
      (
        await deps.authorizeChannelUse?.({
          organizationId: deps.organizationId,
          account,
          message,
        })
      )?.allowed ?? false
    );
  }

  function callbackMessage(
    params: ApprovalCallbackParams,
    account: CompiledChannelAccount,
  ): InboundMessage {
    return {
      channel: channelName(account),
      accountId: account.accountId,
      senderIdentity: params.senderIdentity,
      text: "",
      mentionedBot: true,
      conversation: {
        kind: params.externalThreadId === null ? params.rootKind : "thread",
        id: params.externalThreadId ?? params.externalConversationId,
        rootConversationId: params.externalConversationId,
        threadId: params.externalThreadId,
      },
    };
  }

  /** One engine's open prompts for an agent (the /status "pending" fact). */
  function engineOpenPrompts(agentId: string): AgentPermissionRequest[] {
    return approvals?.openPromptRequests(agentId) ?? [];
  }

  function workflowBindingKey(message: InboundMessage, route: CompiledRoute): string {
    const key = deriveBindingKey(message, route);
    return JSON.stringify([
      message.channel,
      message.accountId,
      key.externalConversationId,
      key.externalThreadId,
    ]);
  }

  function workflowActivityKey(bindingKey: string, workflow: string): string {
    return JSON.stringify([bindingKey, workflow]);
  }

  function workflowAgentMapKey(message: InboundMessage, route: CompiledRoute): string {
    if (route.target.kind !== "workflow") throw new Error("workflow route is required");
    return workflowActivityKey(workflowBindingKey(message, route), route.target.workflow);
  }

  /** The captured Workflow route used only for session-control commands. A
   * normal message still performs a fresh Route selection and creates a new
   * Automation run, independently of Agent reuse. */
  function activeWorkflowRouteFor(message: InboundMessage): CompiledRoute | undefined {
    let exact: CompiledRoute | undefined;
    let collapsed: CompiledRoute | undefined;
    for (const { context } of workflowExecutionAgents.values()) {
      if (
        context.channel !== message.channel ||
        context.accountId !== message.accountId ||
        context.externalConversationId !== message.conversation.rootConversationId
      ) {
        continue;
      }
      if (context.externalThreadId === message.conversation.threadId) exact = context.route;
      else if (context.externalThreadId === null) collapsed = context.route;
    }
    return exact ?? collapsed;
  }

  /** Resolve a prompt from its captured Channel location. Prefer the native
   * thread/topic, then a deliberately conversation-collapsed binding. */
  function approvalPromptAt(
    channel: string,
    accountId: string,
    externalConversationId: string,
    externalThreadId: string | null,
    requestId?: string,
  ) {
    const matchesLocation = (context: StreamContext, threadId: string | null) =>
      context.channel === channel &&
      context.accountId === accountId &&
      context.externalConversationId === externalConversationId &&
      context.externalThreadId === threadId;
    const exact = approvalsEngine().resolveOpenPromptWhere(
      (context) => matchesLocation(context, externalThreadId),
      requestId,
    );
    if (exact !== undefined || externalThreadId === null) return exact;
    return approvalsEngine().resolveOpenPromptWhere(
      (context) => matchesLocation(context, null),
      requestId,
    );
  }

  async function directAgentFor(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
  ): Promise<string | undefined> {
    const key = deriveBindingKey(message, route);
    const binding = await store?.findThreadBinding(
      deps.organizationId,
      account.accountId,
      key.externalConversationId,
      key.externalThreadId,
    );
    return binding?.status === "bound" && binding.agentId !== null ? binding.agentId : undefined;
  }

  async function conversationAgentFor(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
  ): Promise<string | undefined> {
    if (route.target.kind === "agent") return directAgentFor(message, account, route);
    const bindingKey = workflowBindingKey(message, route);
    const inMemory = [
      ...(workflowAgentsByBinding.get(workflowAgentMapKey(message, route)) ?? []),
    ].at(-1);
    if (inMemory !== undefined) return inMemory;
    const execution = await deps.workflowOutputStore.findLatestChannelWorkflowExecution({
      organizationId: deps.organizationId,
      bindingKey,
      workflowName: route.target.workflow,
    });
    return execution?.daemonAgentId ?? undefined;
  }

  function cleanupWorkflowStream(executionId: string, agentId: string): void {
    const attached = workflowExecutionAgents.get(executionId);
    if (attached?.agentId !== agentId) return;
    workflowExecutionAgents.delete(executionId);
    const stillReferenced = [...workflowExecutionAgents.values()].some(
      (candidate) => candidate.agentKey === attached.agentKey && candidate.agentId === agentId,
    );
    if (!stillReferenced) {
      const agents = workflowAgentsByBinding.get(attached.agentKey);
      agents?.delete(agentId);
      if (agents?.size === 0) workflowAgentsByBinding.delete(attached.agentKey);
      relay?.detach(agentId);
      approvals?.detach(agentId);
    }
  }

  /** Let go of an agent the plane no longer speaks for: its stream stops
   * reaching the relay and the approval engine, its liveness surface is
   * released, and the daemon stops sending us its timeline. */
  async function detachChannelAgent(agentId: string): Promise<void> {
    relay?.detach(agentId);
    approvals?.detach(agentId);
    processing?.closeAgent(agentId);
    routeExecutionLimiter?.completeAgent(agentId);
    if (subscribed.delete(agentId)) await resubscribe();
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
    if (account === undefined || route === undefined || route.target.kind !== "agent") return;
    const context = streamContextFor(binding, route, account);
    relayEngine().attach(context);
    approvalsEngine().bindStream(context);
    subscribed.add(binding.agentId);
  }

  // --- Routing ---------------------------------------------------------------

  type InboundRouteResolution =
    | { kind: "selected"; route: CompiledRoute }
    | { kind: "invalid-binding" }
    | { kind: "unmatched" };

  /**
   * A durable direct-Agent binding owns the inbound before text routing. This
   * is what keeps a later `contains` marker from moving an active conversation
   * into a Workflow. Without a binding, select a new target from message text.
   */
  async function resolveInboundRoute(
    message: InboundMessage,
    account: CompiledChannelAccount,
  ): Promise<InboundRouteResolution> {
    const binding = await bindingForInbound(message, account);
    if (binding !== undefined) {
      const route = routeForBinding(binding);
      return route?.target.kind === "agent"
        ? { kind: "selected", route }
        : { kind: "invalid-binding" };
    }
    const route = resolveNewRoute(message, account);
    return route === undefined ? { kind: "unmatched" } : { kind: "selected", route };
  }

  /** Find the most-specific binding key that can own this inbound. */
  async function bindingForInbound(
    message: InboundMessage,
    account: CompiledChannelAccount,
  ): Promise<ThreadBindingRecord | undefined> {
    if (store === undefined) return undefined;
    const conversation = message.conversation;
    const candidates: (string | null)[] = [];
    if (conversation.threadId !== null) candidates.push(conversation.threadId);
    // A redelivery of the root marker that minted a Slack reply thread must
    // find the same pending/bound row before attempting route selection again.
    if (
      conversation.threadId === null &&
      message.channel === "slack" &&
      message.externalMessageId !== undefined
    ) {
      candidates.push(message.externalMessageId);
    }
    candidates.push(null);
    for (const externalThreadId of new Set(candidates)) {
      const binding = await store.findThreadBinding(
        deps.organizationId,
        account.accountId,
        conversation.rootConversationId,
        externalThreadId,
      );
      if (binding !== undefined) return binding;
    }
    return undefined;
  }

  /**
   * Two-pass route match (pinned-vertical-contracts/inbound.md): a
   * thread/topic-level message matches the THREAD-LEVEL descriptor first
   * (`{kind: thread|topic, id: threadId}`), then the ROOT descriptor
   * (`{kind: dm|channel|group, id: rootConversationId}`); first hit in
   * declaration order wins. `matchRoute` stays a pure single-level matcher.
   * A root-level message carries no thread id — one pass at the root.
   */
  function resolveNewRoute(
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
      const match = matchRoute(descriptor, account, message.text);
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
      ...(route.target.kind === "agent"
        ? { accessTarget: deps.resolveAgentAccessTarget(route.target) }
        : {}),
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

  function channelName(account: CompiledChannelAccount): SupportedChannelName {
    if (isSupportedChannel(account.channel)) return account.channel;
    throw new Error(`unsupported Channel vertical: ${account.channel}`);
  }

  function findAccountForBinding(binding: ThreadBindingRecord): CompiledChannelAccount | undefined {
    return deps.controlPlane.accounts.find(
      (candidate) =>
        candidate.channel === binding.channel && candidate.accountId === binding.accountId,
    );
  }

  /** Resolve a stored direct binding without re-running its original text match. */
  function routeForBinding(binding: ThreadBindingRecord): CompiledRoute | undefined {
    const account = findAccountForBinding(binding);
    if (account === undefined) return undefined;
    const descriptor = parseStoredRouteSummary(binding.route) ?? {
      kind: "channel" as const,
      id: binding.externalConversationId,
    };
    const selection = parseStoredRouteSelection(binding.route);
    if (selection === undefined) {
      // Compatibility for bindings written before captured route selection.
      // A content-specific route cannot match without its original text.
      const legacy = matchRoute(descriptor, account);
      if (legacy.route !== null) return legacy.route;
      return legacy.fallback.deny ? undefined : catchAllRoute(legacy.fallback);
    }
    const fallback = account.fallback.deny ? undefined : catchAllRoute(account.fallback);
    const atCapturedPosition =
      selection.position === "fallback" ? fallback : account.routes[selection.position];
    if (
      selection.revisionId === (deps.channelRevisionId ?? null) &&
      continuationMatches(atCapturedPosition, descriptor, selection.fingerprint)
    ) {
      return atCapturedPosition;
    }
    // A revision may reorder an otherwise identical route. Continue only when
    // target and every effective policy leaf are byte-equivalent after compile.
    return [...account.routes, ...(fallback === undefined ? [] : [fallback])].find((candidate) =>
      continuationMatches(candidate, descriptor, selection.fingerprint),
    );
  }

  function continuationMatches(
    route: CompiledRoute | undefined,
    descriptor: {
      kind: "dm" | "channel" | "thread" | "group" | "topic";
      id: string;
    },
    fingerprint: string,
  ): route is CompiledRoute {
    if (route === undefined || routeFingerprint(route) !== fingerprint) return false;
    // The synthesized fallback has no authored scope; its fingerprint is the
    // authority. Authored routes must still own the stored Conversation.
    if (route.match.kind === "channel" && route.match.ids.length === 0 && !accountHasRoute(route)) {
      return true;
    }
    return routeConversationMatches(route.match, descriptor);
  }

  function accountHasRoute(route: CompiledRoute): boolean {
    return deps.controlPlane.accounts.some((account) => account.routes.includes(route));
  }

  /** The one shared stream consumer; callers own their execution lease shape. */
  async function consumeAgentStream(agentId: string, event: unknown): Promise<void> {
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
  }

  /**
   * A Workflow stream may outlive the Channel revision that started it. New
   * events attach only when the captured Route still exists with the same
   * fingerprint; old Member-only rows retain their pre-fingerprint behavior.
   */
  function workflowRouteForCurrentConfiguration(
    account: CompiledChannelAccount,
    channel: NonNullable<ReturnType<typeof channelWorkflowOutput>>,
    workflow: string,
  ): CompiledRoute | undefined {
    if (channel.route_fingerprint !== undefined) {
      const fallback =
        account.fallback.deny || account.fallback.target === undefined
          ? undefined
          : catchAllRoute(account.fallback);
      let atCapturedPosition: CompiledRoute | undefined;
      if (channel.route_position === "fallback") {
        atCapturedPosition = fallback;
      } else if (typeof channel.route_position === "number") {
        atCapturedPosition = account.routes[channel.route_position];
      }
      const candidates = [atCapturedPosition, ...account.routes, fallback];
      return candidates.find(
        (candidate) =>
          candidate?.target.kind === "workflow" &&
          candidate.target.workflow === workflow &&
          routeFingerprint(candidate) === channel.route_fingerprint,
      );
    }
    if (channel.route.audience?.kind === "conversationParticipants") {
      return undefined;
    }
    return {
      match: { kind: channel.root_kind, ids: [] },
      ...(channel.route.audience === undefined ? {} : { audience: channel.route.audience }),
      target: { kind: "workflow", workflow },
      defaultRoles: channel.route.defaultRoles,
      assignments: channel.route.assignments,
      defaults: channel.route.defaults,
      approval: channel.route.approval,
      ...(channel.route.limits === undefined ? {} : { limits: channel.route.limits }),
    };
  }

  function result(dispatched: boolean, outcome: InboundOutcome): PlaneInboundResult {
    const reply: PlaneInboundResult = { dispatched, outcome };
    if (dispatched) reply.dispatchResult = { queuedFinal: false, counts: {} };
    return reply;
  }

  return plane;
}

function parseChannelIdentityLinkCommand(text: string): string | null {
  const match = /^(?:<@[^>]+>\s*)?\/link(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]+)\s*$/u.exec(
    text.trim(),
  );
  return match?.[1] ?? null;
}

function workflowOutputDelivery(
  deps: ChannelPlaneDeps,
  execution: AgentExecutionRecord,
): NonNullable<StreamContext["outputDelivery"]> {
  const channel = channelWorkflowOutput(execution.outputContext)!;
  const declaration = execution.launchIntent?.allowOutputs.find(
    (output) => output.type === `${channel.name}.reply`,
  );
  const outputType = `${channel.name}.reply`;
  const previouslyEmitted = (execution.outputEmissions[outputType] ?? 0) > 0;
  let streamAttemptId: string | undefined = previouslyEmitted
    ? `completed:${execution.id}:${outputType}`
    : undefined;
  let streamAttemptCompleted = previouslyEmitted;
  return {
    async begin() {
      // outputContext says where a reply would go; it is not authority to
      // emit one. Only the step's compiled allow_outputs declaration grants
      // that capability.
      if (declaration === undefined) return undefined;
      if (streamAttemptId !== undefined) return streamAttemptId;
      const attempt = await deps.workflowOutputStore.beginAgentExecutionOutput(
        execution.id,
        outputType,
        declaration?.max,
        new Date(),
      );
      streamAttemptId = attempt?.id;
      return streamAttemptId;
    },
    async complete(attemptId) {
      if (streamAttemptCompleted) return;
      await deps.workflowOutputStore.completeAgentExecutionOutput(
        execution.id,
        attemptId,
        new Date(),
      );
      streamAttemptCompleted = true;
    },
    async fail(attemptId) {
      // One Workflow stream is one declared output surface even when it emits
      // progress and final posts. Once any post completed the output attempt,
      // a later channel-post failure must not revoke that admission: its
      // failed ledger row retries independently, including after Hub restart.
      if (streamAttemptCompleted) return;
      await deps.workflowOutputStore.failAgentExecutionOutput(execution.id, attemptId, new Date());
      streamAttemptId = undefined;
      streamAttemptCompleted = false;
    },
  };
}

function channelWorkflowOutput(value: unknown):
  | {
      name: SupportedChannelName;
      account_id: string;
      binding_key: string;
      external_conversation_id: string;
      external_thread_id: string | null;
      sender_identity: string;
      root_kind: "dm" | "channel" | "group";
      trigger_thread_id: string | null;
      trigger_message_id?: string;
      revision_id?: string | null;
      route_position?: number | "fallback";
      route_fingerprint?: string;
      route: Pick<
        CompiledRoute,
        "audience" | "defaultRoles" | "assignments" | "defaults" | "approval" | "limits"
      >;
    }
  | undefined {
  if (!isRecord(value) || value["provider"] !== "channel") return undefined;
  const parsed = ChannelWorkflowRequestPayloadSchema.shape.channel.safeParse(value["channel"]);
  if (!parsed.success) return undefined;
  const channel = parsed.data;
  return {
    name: channel.name,
    account_id: channel.account_id,
    binding_key: channel.binding_key,
    external_conversation_id: channel.external_conversation_id,
    external_thread_id: channel.external_thread_id,
    sender_identity: channel.sender_identity,
    root_kind: channel.root_kind,
    trigger_thread_id: channel.trigger_thread_id,
    ...(channel.trigger_message_id === undefined
      ? {}
      : { trigger_message_id: channel.trigger_message_id }),
    ...(channel.revision_id === undefined ? {} : { revision_id: channel.revision_id }),
    ...(channel.route_position === undefined ? {} : { route_position: channel.route_position }),
    ...(channel.route_fingerprint === undefined
      ? {}
      : { route_fingerprint: channel.route_fingerprint }),
    route: channel.route,
  };
}

function channelWorkflowDeliveryId(value: unknown): string | undefined {
  if (!isRecord(value) || value["provider"] !== "channel") return undefined;
  const deliveryId = value["deliveryId"];
  return typeof deliveryId === "string" && deliveryId.length > 0 ? deliveryId : undefined;
}

function isTerminalStreamEvent(event: unknown): boolean {
  const terminal = asRelayedEvent(event);
  return terminal?.kind === "turn_completed" || terminal?.kind === "turn_closed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
