import type { ChannelPrivilegeDecision } from "../access/store.js";
import {
  CHANNEL_IDENTITY_REALM_SCOPE,
  type IdentityChannel,
} from "../access/channel-identity-realm.js";
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
import { randomUUID, createHash } from "node:crypto";
import type { AgentExecutionRecord, ThreadBindingRecord } from "../db/types.js";
import type { ChannelStore } from "../db/channels.js";
import type { CompiledChannelAccount, CompiledRoute } from "./config/compile.js";
import type { DaemonConnection } from "./daemon/client.js";
import { isHostNotConnected } from "./daemon/enrolled-client.js";
import { AgentEventOrder } from "./plane/agent-event-order.js";
import type { InboundReplyParams } from "./loader/host.js";
import { isOpenAudience } from "./config/audience.js";
import {
  audienceRulesAdmit,
  isEnabled,
  isOpenAudienceRoute,
  mayTrigger,
  selectRouteForSender,
  type InboundConversation,
} from "./policy.js";
import { ApprovalEngine, parseApprovalCommand, type ApprovalCommand } from "./approvals/index.js";
import { parseCardValue } from "./approvals/card.js";
import {
  parseChannelIdentityLinkCode,
  parseChannelTextCommand,
  textCommandHelpText,
  normalizeChannelCommandText,
  type ChannelTextCommand,
  commandAddressesThisBot,
} from "./commands.js";
import { redeemChannelCommandButton } from "./command-buttons.js";
import {
  admitChannelAccess,
  audienceSenderFor,
  mayUseChannelRoute,
  type ChannelAccessGateOutcome,
} from "./policy/gate.js";
import { ChannelLifecycleCommands } from "./commands-lifecycle.js";
import { ChannelCommandDispatcher } from "./commands-dispatch.js";
import { commandReplyAddress, channelIdentityText } from "./commands-context.js";
import { expandDynamicCommand } from "./commands-extension.js";
import {
  admitFollowUp,
  BindingEngine,
  deriveBindingKey,
  parseStoredRouteSummary,
  recordedRoute,
  storedRouteOwner,
  type FollowUpAdmission,
  routeFingerprint,
  routePosition,
} from "./bindings/index.js";
import { conversationFollowUpMode, endFollowUpPause } from "./bindings/follow-up.js";
import { ConversationFlow, type DeadLetteredRow } from "./bindings/conversation-flow.js";
import { isHeldFlushPayload, type HeldFlushPayload } from "./bindings/held-flush.js";
import type { Delivery } from "./bindings/inbox.js";
import { RelayEngine } from "./relay/index.js";
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
import { ChannelExecutionLimiter, type ExecutionLease } from "./plane/execution-limiter.js";
import { OnceMemory } from "./plane/once-memory.js";
import { sessionLaneKey } from "./ingress/session-lane.js";
import { WAIT_NOTICE_TEXT } from "./plane/wait-notices.js";
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
  PlaneInboundDeferral,
  PlaneInboundResult,
  PlaneLogger,
  StreamContext,
} from "./plane/types.js";
import { CHANNEL_CATALOG, isSupportedChannel } from "./catalog.js";
import { ChannelWorkflowRequestPayloadSchema } from "../triggers/channel/provider.js";

/**
 * How long a deferred orphan recovery waits for the daemon's first session after
 * the account started without one. The socket reconnects on its own; this only
 * bounds the one-time recovery wait (docs/audits/2026-09-10, external boot race).
 */
const DEFERRED_RECOVERY_WAIT_MS = 10 * 60_000;

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
   * The durable ingress lane for an inbound about to be admitted: the session
   * it will reach (`ingress/session-lane.ts`). Undefined = keep the lane the
   * transport chose.
   */
  ingressLaneKey(params: InboundReplyParams): string | undefined;
  /** The durable ingress gave up on this row (`ConversationFlow.onDeadLettered`). */
  onDeadLettered(record: DeadLetteredRow): Promise<void>;
  /** The Host is gone: tell every conversation whose turn it took with it
   * (`ConversationFlow.hostLost`). */
  onHostLost(): Promise<void>;
  /** A flush row came due (`ConversationFlow.deliverHeld`). */
  deliverHeld(payload: HeldFlushPayload, id: string): Promise<PlaneInboundDeferral | undefined>;
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
   * Start the plane against a daemon + store: wait for the trusted session,
   * recover orphan pending markers, and re-attach the streams of the markers
   * that re-bound. Returns the recovery counts.
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
  /**
   * Adopt a newer revision without restarting: the supervisor calls this only
   * when the revision differs from the running one in Route default Agent
   * controls alone, so nothing the transport, bindings or running sessions
   * depend on has changed. The next session a Route starts uses the new value.
   */
  refresh(snapshot: ChannelPlaneSnapshot): void;
}

/** The revision-derived part of the plane's dependencies. */
export type ChannelPlaneSnapshot = Pick<
  ChannelPlaneDeps,
  "channelRevisionId" | "controlPlane" | "resolveAgentSpec" | "resolveAgentAccessTarget"
>;

const NOT_ADMITTED_TEXT =
  "You can't use this bot here yet. Link your account with /link, or ask an admin for access. /me shows what you have.";

/** The refusal inside a thread another Route owns; Routes are named by position, as in the app. */
function boundThreadRefusalText(account: CompiledChannelAccount, route: CompiledRoute): string {
  const position = account.routes.indexOf(route) + 1;
  return `This conversation belongs to Route ${String(position)}, and you are not allowed to use it. Send a new message outside this thread to start your own conversation.`;
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
  channel: string,
): string {
  if (status === "linked") return `Identity linked. ${identityLinkReach(channel)}`;
  if (status === "already_linked") {
    return "This identity is already linked to your Hub account.";
  }
  if (status === "identity_conflict") {
    return "This provider identity is already linked to another Hub account.";
  }
  return "That link code is invalid or expired, or was created for another workspace or bot. Create a new code in Paseo Settings.";
}

/** How far the new link reaches, so people neither re-link each bot nor assume a bot-scoped link covers the rest. */
function identityLinkReach(channel: string): string {
  const label = CHANNEL_CATALOG.find(({ id }) => id === channel)?.label ?? channel;
  const access = "What you can do still follows the Channel access assigned to your Hub account.";
  const scope = CHANNEL_IDENTITY_REALM_SCOPE[channel as IdentityChannel];
  if (scope === "tenant") {
    return `Every bot in this ${label} workspace now recognizes you, so there is no need to link each bot. ${access}`;
  }
  if (scope === "channel") {
    return `Every ${label} bot now recognizes you, so there is no need to link each bot. ${access}`;
  }
  return `This bot now recognizes you. ${label} gives each bot its own user ids, so link other ${label} bots separately. ${access}`;
}

function workflowDeliveryId(message: InboundMessage, route: CompiledRoute): string | undefined {
  if (route.target.kind !== "workflow") return undefined;
  return `${message.channel}:${message.accountId}:${message.externalMessageId ?? message.ingressId ?? randomUUID()}`;
}

/**
 * Build the execution plane. `deps` carries the control-plane snapshot, the
 * clock + post + logger, the agent-spec resolver, and the inbound normalizer.
 * The daemon + store are injected at `start` (they are per-connection).
 */
/**
 * Commands that start or steer a run without passing through the ordinary
 * message path, so they are counted against the limits here. `/new <message>`,
 * `/skill` and `/command` deliver through that path and are counted there.
 */
const LIMITED_COMMANDS: ReadonlySet<ChannelTextCommand["name"]> = new Set([
  "fork",
  "side",
  "quick",
  "steer",
  "queue",
]);

export function createChannelPlane(deps: ChannelPlaneDeps): ChannelPlane {
  const clock = deps.clock ?? realClock();
  const logger: PlaneLogger = deps.logger;
  let daemon: DaemonConnection | undefined;
  let store: ChannelStore | undefined;
  let bindings: BindingEngine | undefined;
  let lifecycleCommands: ChannelLifecycleCommands | undefined;
  let commandDispatcher: ChannelCommandDispatcher | undefined;
  let relay: RelayEngine | undefined;
  let approvals: ApprovalEngine | undefined;
  /** The turn-lifecycle surfaces opened by accepted inbounds (plane/processing.ts). */
  let processing: ProcessingController | undefined;
  /** Context, held messages, running turns (`bindings/conversation-flow.ts`). */
  let conversationFlow: ConversationFlow | undefined;
  let executionLimiter: ChannelExecutionLimiter | undefined;
  /** Messages already told they are waiting for a limit, so a retry is not announced again. */
  const waitingNotices = new OnceMemory(1_000);
  /** Messages already told they were given up on; apart, since a waiting one may end there. */
  const unprocessedNotices = new OnceMemory(1_000);
  const agentEventOrder = new AgentEventOrder();
  /** Senders already told today that this bot does not admit them. */
  const notAdmittedNotices = new OnceMemory(1_000);
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
      const identityCode = parseChannelIdentityLinkCode(message.text);
      if (identityCode !== null && deps.consumeChannelIdentityChallenge !== undefined) {
        // A code redeems through any bot of its identity realm, but only the
        // addressed bot answers it, and an unaddressed code is never forwarded
        // to an agent.
        if (!commandAddressesThisBot(message)) return unaddressedCommand();
        return await handleIdentityLinkCommand(message, account, identityCode);
      }
      const command = parseApprovalCommand(message.text);
      if (command !== null) {
        return await handleApprovalCommand(message, account, command);
      }
      return dispatchInboundText(message, account, inbound);
    },

    ingressLaneKey(params) {
      if (isHeldFlushPayload(params)) return undefined;
      const message = deps.normalizeInbound(params);
      const account = message === null ? undefined : admitAccount(message).account;
      if (message === null || account === undefined) return undefined;
      const command = resolveTextCommand(message.text, readInboundKind(params.ctxPayload));
      return sessionLaneKey(account, message, command?.name);
    },

    onDeadLettered: async (record) => conversationFlow?.onDeadLettered(record),
    onHostLost: async () => conversationFlow?.hostLost(),
    deliverHeld: async (payload, id) => conversationFlow?.deliverHeld(payload, id),

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
      // The follow-up window counts from the agent's latest activity, so a
      // long turn keeps it open and it closes `ttlMinutes` after the turn ends.
      bindings?.markActive(agentId);
      await agentEventOrder.run(agentId, async () => {
        await consumeAgentStream(agentId, event);
        await lifecycleCommands?.onStream(agentId, event);
        if (isTerminalStreamEvent(event)) {
          executionLimiter?.completeAgent(agentId);
          await conversationFlow?.turnEnded(agentId);
        }
      });
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
        executionLimiter?.bindOrRestore({
          leaseId: channelWorkflowDeliveryId(execution.triggerContext),
          account,
          route,
          conversationId: channel.external_conversation_id,
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
        executionLimiter?.completeById(channelWorkflowDeliveryId(execution.triggerContext));
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
      const readRunningAgentIds = async () =>
        new Set(
          (await daemonConnection.listAgents())
            // An agent still starting is as alive as one mid-turn.
            .filter((agent) => agent.status === "running" || agent.status === "initializing")
            .map((agent) => agent.id),
        );
      processing = createProcessingController({
        logger,
        now: () => clock.now(),
        readRunningAgentIds,
        ...(deps.typing !== undefined ? { drive: deps.typing } : {}),
        ...(deps.processingTtlMs !== undefined ? { ttlMs: deps.processingTtlMs } : {}),
      });
      executionLimiter = new ChannelExecutionLimiter({
        logger,
        now: () => clock.now(),
        cancelAgent: (agentId) => daemonConnection.cancelAgent(agentId),
        readRunningAgentIds,
      });
      lifecycleCommands = new ChannelLifecycleCommands({
        organizationId: deps.organizationId,
        // Getters read the current revision after `refresh`.
        get channelRevisionId() {
          return deps.channelRevisionId ?? null;
        },
        daemon: daemonConnection,
        logger,
        store: channelStore,
        resolveConfig: (context, capability) =>
          commandDispatcher!.resolveConfig(context, capability),
        issueCapability: (context) => {
          if (!deps.replyCapabilities || context.route.target.kind !== "agent")
            throw new Error("Channel reply capability is unavailable");
          const target = deps.resolveAgentAccessTarget(context.route.target);
          const token = deps.replyCapabilities.issue({
            organizationId: deps.organizationId,
            channelRevisionId: deps.channelRevisionId ?? null,
            routePosition: routePosition(context.account, context.route),
            routeFingerprint: routeFingerprint(context.route),
            ref: {
              channel: context.message.channel,
              accountId: context.account.accountId,
              ...deriveBindingKey(context.message, context.route),
            },
            turnId: randomUUID(),
            requesterSenderId: context.message.senderIdentity.slice(
              context.message.channel.length + 1,
            ),
            ...(target.projectRoot ? { projectRoot: target.projectRoot } : {}),
          });
          return { token, canSendFiles: target.projectRoot !== undefined };
        },
        bindCapability: (token, agentId) => deps.replyCapabilities?.bind(token, agentId) ?? false,
        revokeCapability: (token) => deps.replyCapabilities?.revoke(token),
        revokeUnboundTurn: (turnId) => deps.replyCapabilities?.revokeUnboundTurn(turnId),
        authorizeResume: (agent, context) => commandDispatcher!.authorizeResume(agent, context),
        authorizeQueued: async (context) => {
          if (!isEnabled(deps.envFlag, deps.controlPlane, context.account)) return false;
          // A queued turn is chat into the Route's session: chat authority is enough.
          return (await mayUseChannel(context.message, context.account, context.route)).allowed;
        },
        attach: async (binding, context) => {
          plane.attachStreamFor(binding, context.route, context.account, {
            threadId: context.message.conversation.threadId,
            messageId: context.message.externalMessageId,
          });
          await resubscribe();
        },
        detach: detachChannelAgent,
        dispatchFresh: async (context) =>
          (await handleAgentMessage(context.message, context.account, context.route)).dispatched,
      });
      commandDispatcher = new ChannelCommandDispatcher({
        plane: deps,
        daemon: daemonConnection,
        store: channelStore,
        lifecycle: lifecycleCommands,
        pendingApprovals: (agentId) => engineOpenPrompts(agentId).length,
        dispatchPrompt: async (context, prompt) =>
          (
            await handleAgentMessage(
              { ...context.message, text: prompt, mentionedBot: true },
              context.account,
              context.route,
            )
          ).dispatched,
      });
      conversationFlow = new ConversationFlow({ ...deps, store: channelStore, plane: seams() });
      bindings = new BindingEngine({
        inbox: conversationFlow.inbox,
        organizationId: deps.organizationId,
        get channelRevisionId() {
          return deps.channelRevisionId ?? null;
        },
        get controlPlane() {
          return deps.controlPlane;
        },
        logger,
        clock,
        store: channelStore,
        daemon: daemonConnection,
        detachAgent: detachChannelAgent,
        onSlowStart: (message, account, route) =>
          void postWaitNotice(message, account, route, "starting").catch(() => undefined),
        ...(deps.resolveChannelSender === undefined
          ? {}
          : { resolveChannelSender: deps.resolveChannelSender }),
        get resolveAgentSpec() {
          return deps.resolveAgentSpec;
        },
        ...(deps.replyCapabilities === undefined
          ? {}
          : { replyCapabilities: deps.replyCapabilities }),
        get resolveAgentAccessTarget() {
          return deps.resolveAgentAccessTarget;
        },
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
        // The vertical's edit verb, when it publishes one: the tool-activity
        // line rewrites its own message rather than posting a second one.
        ...(deps.streaming?.edit === undefined ? {} : { editPost: deps.streaming.edit }),
        ...(deps.replyCapabilities === undefined ? {} : { toolDeliveries: deps.replyCapabilities }),
        // COMPAT(clisbot-control-plane): the surface is OPENED by the inbound
        // path (plane/processing.ts), not here; the relay keeps it alive on
        // stream events and releases it on the terminal one.
        ...(processing !== undefined ? { processing } : {}),
      });
      approvals = new ApprovalEngine({
        organizationId: deps.organizationId,
        get controlPlane() {
          return deps.controlPlane;
        },
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
      // Orphan recovery needs the daemon session: rebind a surviving agent
      // instead of re-creating it, then re-attach the streams of the markers
      // that re-bound so in-flight turns relay + prompt again.
      const recoverOrphans = async (): Promise<{ rebound: number; leftPending: number }> => {
        const recovered = await bindingsEngine().recoverOrphans(deps.accountScope);
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
        await conversationFlow?.recover();
        logger.info?.("channel plane started", {
          rebound: recovered.rebound,
          leftPending: recovered.leftPending,
        });
        return recovered;
      };
      try {
        await daemonConnection.waitForConnected();
      } catch (error) {
        // Only the initial connect timed out — the daemon session is not up yet.
        // In managed-access `external` mode the Hub relationship that consumes the
        // admission ticket can lag a cold Hub boot past this window; the socket
        // keeps reconnecting on its own, so defer orphan recovery to the first
        // connect instead of failing the account (which would tear the
        // reconnecting socket down with no retry — docs/audits/2026-09-10,
        // external boot race). `off` mode is unaffected: the loopback session is
        // immediate, so this path is not taken. Orphan-recovery errors are NOT
        // caught here — they propagate from the inline path below exactly as
        // before this change.
        logger.warn("channel plane: daemon session not ready at start; deferring orphan recovery", {
          detail: error instanceof Error ? error.message : String(error),
        });
        void daemonConnection
          .waitForConnected(DEFERRED_RECOVERY_WAIT_MS)
          .then(() => recoverOrphans())
          .catch(() => undefined);
        return { rebound: 0, leftPending: 0 };
      }
      return await recoverOrphans();
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

    refresh(snapshot) {
      deps.channelRevisionId = snapshot.channelRevisionId;
      deps.controlPlane = snapshot.controlPlane;
      deps.resolveAgentSpec = snapshot.resolveAgentSpec;
      deps.resolveAgentAccessTarget = snapshot.resolveAgentAccessTarget;
    },

    async stop(options) {
      // Before the socket: a stop the Hub asked for is not a Host that left.
      conversationFlow?.stop();
      await lifecycleCommands?.stop();
      lifecycleCommands = undefined;
      commandDispatcher = undefined;
      if (daemon !== undefined) {
        await daemon.setTimelineSubscription([]).catch(() => undefined);
        if (options?.cancelActive === true) {
          await executionLimiter?.cancelActive();
        } else {
          executionLimiter?.clear();
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
      conversationFlow = undefined;
      executionLimiter = undefined;
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
      text: identityLinkReplyText(status, channelName(account)),
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
    return await handleTextCommand(
      {
        ...message,
        externalMessageId: `callback:${createHash("sha256").update(callback.actionId).digest("hex")}`,
      },
      account,
      resolved.route,
      command,
    );
  }

  /**
   * The Bot, Conversation and Route limits for one message that starts or
   * steers work. A refusal that clears with time is back-pressure: it carries
   * `deferred`, so a durable ingress returns the message instead of completing
   * it, and the sender is told once that it is waiting. A refusal that never
   * clears (too long) is said in the thread.
   */
  async function admitExecution(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    leaseId?: string,
  ): Promise<{ lease: ExecutionLease | undefined } | { refused: PlaneInboundResult }> {
    const admission = executionLimiter?.admit({
      account,
      route,
      conversationId: message.conversation.rootConversationId,
      senderIdentity: message.senderIdentity,
      text: message.text,
      ...(leaseId === undefined ? {} : { leaseId }),
    }) ?? { allowed: true as const };
    if (admission.allowed) return { lease: admission.lease };
    const declined = result(false, { kind: "ignored", reason: admission.reason });
    if (admission.retryAfterMs !== undefined) {
      declined.deferred = { reason: admission.reason, retryAfterMs: admission.retryAfterMs };
    }
    await postWaitNotice(
      message,
      account,
      route,
      admission.retryAfterMs !== undefined ? "queued" : "too-long",
    );
    return {
      refused: await recordChannelActivity(message, account, route, {
        result: declined,
        limitDecision: "denied",
        limitReason: admission.reason,
      }),
    };
  }

  /**
   * A sender the Route's audience refused hears why instead of silence: once a
   * day when they addressed the bot, once per thread in a thread another
   * sender bound. A bound thread never falls through to a later Route, so the
   * sender is told to start their own conversation
   * (docs/audits/2026-09-19-route-audience-rules.md#routing). Chatter the
   * mention and follow-up gates already turned away, open Routes and Workflow
   * Routes stay silent.
   */
  async function postNotAdmittedNotice(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    refusal: FollowUpAdmission,
  ): Promise<void> {
    if (!refusal.audienceRefused || isOpenAudienceRoute(route) || route.target.kind !== "agent")
      return;
    const boundThread = await boundThreadOf(message, account);
    if (!boundThread && !message.mentionedBot) return;
    const day = Math.floor(clock.now() / 86_400_000);
    const once = boundThread
      ? `${message.senderIdentity}:${message.conversation.rootConversationId}:${String(message.conversation.threadId)}`
      : `${message.senderIdentity}:${String(day)}`;
    if (!notAdmittedNotices.remember(once)) return;
    await deps.post({
      channel: channelName(account),
      accountId: account.accountId,
      ...commandReplyAddress(message, route.defaults.replyAnchor),
      text: boundThread ? boundThreadRefusalText(account, route) : NOT_ADMITTED_TEXT,
    });
  }

  /** Is this message in a thread that a binding already gave to a Route? */
  async function boundThreadOf(
    message: InboundMessage,
    account: CompiledChannelAccount,
  ): Promise<boolean> {
    if (message.conversation.threadId === null) return false;
    const binding = await bindingForInbound(message, account);
    return binding !== undefined && binding.externalThreadId !== null;
  }

  /** One short line instead of silence; a waiting message is announced once, not per retry. */
  async function postWaitNotice(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    notice: keyof typeof WAIT_NOTICE_TEXT,
  ): Promise<void> {
    const key = message.externalMessageId ?? message.ingressId;
    const once = notice === "unprocessed" ? unprocessedNotices : waitingNotices;
    // `too-long` and `host-lost` are said once per message by construction.
    const repeatable = notice === "too-long" || notice === "host-lost";
    if (!repeatable && (key === undefined || !once.remember(key))) return;
    await deps.post({
      channel: channelName(account),
      accountId: account.accountId,
      ...commandReplyAddress(message, route.defaults.replyAnchor),
      text: WAIT_NOTICE_TEXT[notice],
    });
  }

  /** `plain` = the stored inbound as written (no command expansion): only such a
   * message is kept as context or held, since both send the stored row later. */
  async function handleAgentMessage(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    plain = false,
  ): Promise<PlaneInboundResult> {
    const sender =
      route.target.kind === "workflow"
        ? await admitWorkflowMessage(message, account, route)
        : await bindingsEngine().admit(message, account, route);
    if (!sender.allowed) return refuseAgentMessage(message, account, route, sender, plain);
    // The conversation is routed to a Workflow now, and a Workflow mints no
    // binding: any session still bound here answers for a target the
    // configuration no longer names, so it is retired rather than left to post
    // beside the run. Admission has passed, so this is a decision the sender is
    // allowed to cause.
    if (route.target.kind === "workflow") {
      const stale = await bindingForInbound(message, account);
      if (stale !== undefined) await bindingsEngine().retireBoundSession(stale);
    }
    const deliveryId = workflowDeliveryId(message, route);
    const admission = await admitExecution(message, account, route, deliveryId);
    if ("refused" in admission) return admission.refused;
    const executionLease = admission.lease;
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
    const held = plain ? await conversationFlow?.hold(message, route) : undefined;
    if (held === undefined)
      return dispatchDirectAgentMessage({ message }, account, route, executionLease);
    executionLimiter?.complete(executionLease);
    const heldOutcome = result(false, { kind: "held", reason: held });
    return recordChannelActivity(message, account, route, {
      result: heldOutcome,
      outcomeDetail: held,
      limitDecision: "allowed",
    });
  }

  async function refuseAgentMessage(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    sender: FollowUpAdmission,
    plain: boolean,
  ): Promise<PlaneInboundResult> {
    if (plain && sender.unaddressed) await conversationFlow?.keepAsContext(message, account, route);
    await postNotAdmittedNotice(message, account, route, sender);
    const reason = sender.reason ?? "message not admitted";
    return recordChannelActivity(message, account, route, {
      result: result(false, { kind: "ignored", reason }),
      limitDecision: "not_evaluated",
    });
  }

  /** What the conversation flow borrows from the plane (`ConversationPlaneSeams`). */
  function seams(): ConstructorParameters<typeof ConversationFlow>[0]["plane"] {
    return {
      engine: bindingsEngine,
      accountFor: (message) => admitAccount(message).account,
      resolveRoute: resolveInboundRoute,
      notice: (message, account, route, kind) => postWaitNotice(message, account, route, kind),
      mayUse: async (message, account, route) =>
        (await mayUseChannel(message, account, route)).allowed,
      dispatch: (delivery, account, route) =>
        dispatchDirectAgentMessage(delivery, account, route, undefined),
    };
  }

  async function dispatchWorkflowMessage(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    workflow: string,
    deliveryId: string,
    executionLease: ExecutionLease | undefined,
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
          ...(deps.resolveSessionIdentity
            ? { sessionIdentity: await deps.resolveSessionIdentity(message) }
            : {}),
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
              audienceRules: [...route.audienceRules],
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
      executionLimiter?.complete(executionLease);
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
    await endFollowUpPause(store, deps.organizationId, message, route);
    return recordChannelActivity(message, account, route, {
      result: result(true, { kind: "workflow", workflow, deliveryId }),
      limitDecision: "allowed",
    });
  }

  /**
   * The stream is subscribed from inside the dispatch, after the agent is
   * known and BEFORE its prompt is delivered — attaching afterwards is what
   * made a new session's first turn invisible (its events, including
   * `turn_started`, landed before anyone was listening).
   */
  async function subscribeStream(
    agentId: string,
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
  ): Promise<void> {
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
      ...(message.externalMessageId !== undefined ? { messageId: message.externalMessageId } : {}),
    });
  }

  async function dispatchDirectAgentMessage(
    delivery: Delivery,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    executionLease: ExecutionLease | undefined,
  ): Promise<PlaneInboundResult> {
    const message = delivery.message;
    let outcome: InboundOutcome;
    try {
      outcome = await conversationFlow!.deliver(delivery, account, route, (agentId) =>
        subscribeStream(agentId, message, account, route),
      );
    } catch (error) {
      executionLimiter?.complete(executionLease);
      // The message is retried; a Host that is away can stay away, so say so.
      if (isHostNotConnected(error)) {
        await postWaitNotice(message, account, route, "host-away").catch(() => undefined);
      }
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
      executionLimiter?.bind(executionLease, outcome.agentId);
    } else {
      executionLimiter?.complete(executionLease);
    }
    const dispatched = result(outcome.kind === "bound" || outcome.kind === "steered", outcome);
    if (outcome.kind === "deferred") {
      dispatched.deferred = { reason: outcome.reason, retryAfterMs: outcome.retryAfterMs };
      await postWaitNotice(message, account, route, "queued").catch(() => undefined);
    }
    return recordChannelActivity(message, account, route, {
      result: dispatched,
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
      await conversationFollowUpMode(store, deps.organizationId, message, route),
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

  async function dispatchInboundText(
    message: InboundMessage,
    account: CompiledChannelAccount,
    inbound: InboundKindReading,
  ): Promise<PlaneInboundResult> {
    const textCommand = resolveTextCommand(message.text, inbound);
    if (textCommand !== null && !commandAddressesThisBot(message)) {
      return unaddressedCommand();
    }
    const workflowCommandRoute = textCommand === null ? undefined : activeWorkflowRouteFor(message);
    if (textCommand !== null && workflowCommandRoute !== undefined) {
      return await handleWorkflowTextCommand(message, account, workflowCommandRoute, textCommand);
    }
    const resolved = await resolveInboundRoute(message, account);
    if (resolved.kind !== "selected") {
      return replyWithoutRoute(message, account, textCommand);
    }
    const route = resolved.route;
    // The upstream sender-admission gate (`access:`), in front of everything
    // that could start or steer a turn. A route with no `access:` block
    // allows here and only the RBAC gate decides, exactly as before.
    const gated =
      textCommand?.name === "help" || textCommand?.name === "me"
        ? undefined
        : await admitAccess(message, account, route);
    if (gated !== undefined) return gated;
    deps.noteOutboundRoute?.(message.conversation.rootConversationId, route);
    // The channel's other plain-text commands (/status, /stop, /new, /help —
    // shared, channel-agnostic; see commands.ts). `requireMention` and the
    // follow-up policy do not gate them: `commandAddressesThisBot` already
    // required this bot to be named outside a DM.
    if (textCommand !== null) {
      await conversationFlow?.beforeCommand(textCommand.name, message, route);
      return await handleTextCommand(message, account, route, textCommand);
    }
    return dispatchUnknownCommandOrPrompt(message, account, route, inbound);
  }

  async function replyWithoutRoute(
    message: InboundMessage,
    account: CompiledChannelAccount,
    textCommand: ChannelTextCommand | null,
  ): Promise<PlaneInboundResult> {
    if (textCommand?.name === "help" || textCommand?.name === "me") {
      const text =
        textCommand.name === "help"
          ? textCommandHelpText()
          : await channelIdentityText(deps, message, account);
      const delivered = await commandReplyFor(message, account, textCommand.name)(text);
      return result(delivered, {
        kind: "command",
        handled: delivered,
        detail: textCommand.name,
      });
    }
    return result(false, { kind: "ignored", reason: "no route matches this conversation" });
  }

  async function dispatchUnknownCommandOrPrompt(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    inbound: InboundKindReading,
  ): Promise<PlaneInboundResult> {
    // A native command this Hub does not own (`/deploy`, `/model`): it is
    // forwarded to the agent as text only when it addressed the bot.
    if (inbound.kind === "command" && !message.mentionedBot) {
      return recordChannelActivity(message, account, route, {
        result: result(false, { kind: "ignored", reason: "unknown command, bot not addressed" }),
        limitDecision: "not_evaluated",
      });
    }
    const expanded =
      store === undefined
        ? undefined
        : await expandDynamicCommand(
            store.access,
            {
              organizationId: deps.organizationId,
              channel: message.channel,
              accountId: account.accountId,
            },
            message.text,
          );
    if (expanded !== undefined) {
      if (!commandAddressesThisBot(message)) return unaddressedCommand();
      return handleTextCommand(message, account, route, {
        name: "command",
        value: normalizeChannelCommandText(message.text, true)
          .replace(/^\s*[/\\]/, "")
          .trim(),
      });
    }
    return handleAgentMessage(message, account, route, true);
  }

  async function handleTextCommand(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    command: ChannelTextCommand,
  ): Promise<PlaneInboundResult> {
    const post = commandReplyFor(message, account, command.name, route);
    if (
      command.name !== "help" &&
      command.name !== "me" &&
      !(await mayUseChannel(message, account, route)).allowed
    ) {
      await post("Sender may not control this conversation.");
      return result(false, {
        kind: "command",
        handled: false,
        detail: "sender may not control this conversation",
      });
    }
    if (!commandDispatcher)
      return result(false, { kind: "command", handled: false, detail: "plane not started" });
    const agentId = await conversationAgentFor(message, account, route);
    const accessTarget =
      route.target.kind === "workflow"
        ? await workflowAccessTarget(message, route, agentId)
        : undefined;
    const limited = LIMITED_COMMANDS.has(command.name)
      ? await admitExecution(message, account, route)
      : { lease: undefined };
    if ("refused" in limited) return limited.refused;
    const lease = limited.lease;
    // The run slot follows the session the command starts or steers.
    let leased = false;
    const holdLease = (id: string) => {
      executionLimiter?.bind(lease, id);
      leased = lease !== undefined;
    };
    if (agentId && (command.name === "steer" || command.name === "queue")) holdLease(agentId);
    try {
      const outcome = await commandDispatcher.handle(command, {
        message,
        account,
        route,
        ...(agentId ? { agentId } : {}),
        ...(accessTarget ? { accessTarget } : {}),
        post,
        onAgentCreated: holdLease,
      });
      return result(outcome.handled, { kind: "command", ...outcome });
    } finally {
      if (!leased) executionLimiter?.complete(lease);
    }
  }

  async function workflowAccessTarget(
    message: InboundMessage,
    route: CompiledRoute,
    agentId?: string,
  ) {
    if (route.target.kind !== "workflow") return undefined;
    const captured = [...workflowExecutionAgents.values()].find(
      (entry) => entry.agentId === agentId,
    )?.context.accessTarget;
    if (captured) return captured;
    const execution = await deps.workflowOutputStore.findLatestChannelWorkflowExecution({
      organizationId: deps.organizationId,
      bindingKey: workflowBindingKey(message, route),
      workflowName: route.target.workflow,
    });
    const environment = execution?.launchIntent?.environment;
    return environment
      ? {
          daemonReference: environment.daemonId,
          ...(environment.projectId ? { projectId: environment.projectId } : {}),
        }
      : undefined;
  }

  /**
   * The ONE reply path every session command answers on — `/help` and
   * `/status` take it exactly as `/stop` and `/new` do. Commands answer where
   * they were asked, at the marker's own level (the binding key may be
   * coarser, e.g. `binding.key: channel`), and follow the Route's
   * `reply.anchor` the way agent replies do (`reply-anchor.ts`).
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
    route?: CompiledRoute,
  ): CommandReply {
    const address = commandReplyAddress(message, route?.defaults.replyAnchor);
    return async (text) => {
      const response = await deps.post({
        channel: channelName(account),
        accountId: account.accountId,
        ...address,
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
    const gated =
      command.name === "help" || command.name === "me"
        ? undefined
        : await admitAccess(message, account, route);
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
    await postAccessRefusal(message, account, route, gated);
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
    route: CompiledRoute,
    gated: ChannelAccessGateOutcome,
  ): Promise<void> {
    const text = gated.kind === "allow" ? undefined : gated.reply;
    if (text === undefined) return;
    const response = await deps.post({
      channel: channelName(account),
      accountId: account.accountId,
      ...commandReplyAddress(message, route.defaults.replyAnchor),
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
      ...(deps.resolveChannelSender === undefined
        ? {}
        : { resolveChannelSender: deps.resolveChannelSender }),
    });
  }

  /** Member-grade admission: an audience rule other than `anyone`, or a role
   * granting `bot.interact`. */
  async function mayVerifiedMemberUseChannel(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
  ): Promise<boolean> {
    const sender = await audienceSenderFor({
      organizationId: deps.organizationId,
      account,
      route,
      message,
      ...(deps.resolveChannelSender === undefined
        ? {}
        : { resolveChannelSender: deps.resolveChannelSender }),
    });
    if (audienceRulesAdmit(route, message.conversation, sender, { membersOnly: true })) {
      return true;
    }
    return mayTrigger(message.senderIdentity, deps.controlPlane, account, route);
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
    lifecycleCommands?.forget(agentId);
    relay?.detach(agentId);
    approvals?.detach(agentId);
    processing?.closeAgent(agentId);
    executionLimiter?.completeAgent(agentId);
    await conversationFlow?.turnEnded(agentId);
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

  type InboundRouteResolution = { kind: "selected"; route: CompiledRoute } | { kind: "unmatched" };

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
      // A bound conversation stays with its Route: the live conversation
      // decides which Routes still cover it, the binding decides which of
      // those owns it, and the sender never moves it to another one.
      const route = routeForBinding(binding, message.conversation);
      // No route owns this conversation any more: the account stopped serving
      // it, which is the same silence it had before it was ever bound. Whether
      // the bound session is still the right one to answer with is the binding
      // engine's call, after admission.
      return route === undefined ? { kind: "unmatched" } : { kind: "selected", route };
    }
    const route = await resolveNewRoute(message, account);
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
   * Ordered selection for an unbound conversation: the first Route whose
   * Where covers it (thread and topic messages resolve to their room; a listed
   * thread id narrows to the thread) and whose audience admits the sender. A
   * Route that refuses the sender is skipped for the next one. When none
   * admits, the first applicable Route is returned so the refusal is worded
   * and audited against it.
   */
  async function resolveNewRoute(
    message: InboundMessage,
    account: CompiledChannelAccount,
  ): Promise<CompiledRoute | undefined> {
    const selection = await selectRouteForSender(
      message.conversation,
      account,
      message.text,
      async (route) => (await mayUseChannel(message, account, route)).allowed,
    );
    return selection.route ?? undefined;
  }

  function streamContextFor(
    binding: ThreadBindingRecord,
    route: CompiledRoute,
    account: CompiledChannelAccount,
    trigger?: InboundTriggerRef,
  ): StreamContext {
    if (
      typeof binding.route === "object" &&
      binding.route !== null &&
      "commandReplyPath" in binding.route &&
      binding.route.commandReplyPath === "relay"
    ) {
      route = {
        ...route,
        defaults: {
          ...route.defaults,
          sync: { ...route.defaults.sync, finalAnswers: true },
          outbound: { ...route.defaults.outbound, path: "relay" },
        },
      };
    }
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

  /**
   * Which route owns this conversation now (`storedRouteOwner`): matched on
   * the conversation, never on the message text, so a later keyword in an
   * ongoing conversation can never move it to another route, and never on the
   * sender, so two people in one thread never reach two Routes. Config edits
   * are therefore free — a route keeps owning its conversations while its
   * Where keeps covering them, and the authority gates behind this (audience
   * rules, access, `bot.interact`, command privileges, approval) re-evaluate
   * against the route as it is now, on every message.
   */
  function routeForBinding(
    binding: ThreadBindingRecord,
    live?: InboundConversation,
  ): CompiledRoute | undefined {
    const account = findAccountForBinding(binding);
    if (account === undefined) return undefined;
    return storedRouteOwner(account, binding, live);
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
   * A Workflow stream may outlive the Channel revision that started it, so its
   * later events attach through the same two questions the inbound path asks:
   * does a route still own this conversation, and does it still target this
   * Workflow. Editing an unrelated leaf of that route keeps the run's output
   * flowing; repointing or removing it stops the output, which is the answer
   * the configuration now gives. Old Member-only rows (no captured route) keep
   * their pre-capture behavior.
   */
  function workflowRouteForCurrentConfiguration(
    account: CompiledChannelAccount,
    channel: NonNullable<ReturnType<typeof channelWorkflowOutput>>,
    workflow: string,
  ): CompiledRoute | undefined {
    if (channel.route_fingerprint !== undefined && channel.route_position !== undefined) {
      // The run records the ROOT conversation and the thread it started in;
      // a Route's Where reads both (a listed thread id narrows to it).
      const threaded = channel.external_thread_id !== null && channel.root_kind !== "dm";
      const threadKind = channel.root_kind === "group" ? "topic" : "thread";
      const conversation: InboundConversation = {
        kind: threaded ? threadKind : channel.root_kind,
        id: channel.external_thread_id ?? channel.external_conversation_id,
        rootConversationId: channel.external_conversation_id,
      };
      const route = recordedRoute(account, conversation, {
        position: channel.route_position,
        fingerprint: channel.route_fingerprint,
      });
      return route?.target.kind === "workflow" && route.target.workflow === workflow
        ? route
        : undefined;
    }
    // A run from before route capture recorded no rules: it was Member-only.
    const audienceRules = channel.route.audienceRules ?? [];
    if (isOpenAudience(audienceRules)) return undefined;
    return {
      audienceRules,
      where: { dm: true, groups: ["all"], conversations: [] },
      target: { kind: "workflow", workflow },
      defaultRoles: channel.route.defaultRoles,
      assignments: channel.route.assignments,
      defaults: channel.route.defaults,
      approval: channel.route.approval,
      ...(channel.route.limits === undefined ? {} : { limits: channel.route.limits }),
    };
  }

  function unaddressedCommand(): PlaneInboundResult {
    return result(false, { kind: "ignored", reason: "command not addressed to this bot" });
  }

  function result(dispatched: boolean, outcome: InboundOutcome): PlaneInboundResult {
    const reply: PlaneInboundResult = { dispatched, outcome };
    if (dispatched) reply.dispatchResult = { queuedFinal: false, counts: {} };
    return reply;
  }

  return plane;
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
      route_position?: number;
      route_fingerprint?: string;
      route: Pick<
        CompiledRoute,
        "defaultRoles" | "assignments" | "defaults" | "approval" | "limits"
      > &
        Partial<Pick<CompiledRoute, "audienceRules">>;
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
