// Thread bindings + continuous execution (plan §4-S2, implementation doc §4.3.4).
// The Hub keeps one durable thread binding per thread key: the first mention in
// an unbound thread records a pre-create pending marker, issues
// `create_agent_request`, and resolves the marker to the new agent id; every
// follow-up steers the bound session. The pending marker + an execution-id
// label on the created agent make orphan recovery possible: on start the Hub scans its
// pending markers against `fetch_agents` and rebinds a surviving agent instead
// of re-creating it (plan §10 "one agent, no duplicate" — the trusted path has
// no create-dedup, so the marker is the idempotency). One decision path here:
// admit (mention / follow-up mode / idle TTL) -> binding lookup -> create or
// steer. Workflow targets are out of scope: they own their own session
// lifecycle (implementation doc §4.3.4).
import { randomUUID } from "node:crypto";
import type { ChannelStore } from "../../db/channels.js";
import type { ThreadBindingRecord } from "../../db/types.js";
import type {
  ChannelControlPlane,
  CompiledChannelAccount,
  CompiledRoute,
  EffectiveDefaults,
} from "../config/compile.js";
import { outboundAttachesTool, type FollowUpMode } from "../config/enums.js";
import {
  bindingSummary,
  deriveBindingKey,
  parseStoredRouteTarget,
  routePosition,
  type ThreadKey,
} from "./stored-route.js";
import { findChannelExecutionAgent } from "./session-create.js";
import {
  createMarkedSession,
  recordSessionMarker,
  releasePendingMarker,
  type SessionStartContext,
} from "./session-start.js";
import {
  ChannelAgentCreatePendingError,
  HOST_BUSY_RETRY_AFTER_MS,
  pendingMarkerExpired,
  recoverOrphanMarkers,
} from "./pending-marker.js";
import {
  admitFollowUp,
  conversationFollowUpMode,
  endFollowUpPause,
  type FollowUpAdmission,
} from "./follow-up.js";
import { mayUseChannelRoute } from "../policy/gate.js";
import { messagesOf, type BindingInbox, type Delivery, type PreparedDelivery } from "./inbox.js";
import { deliveryMessageId, renderConversationPrompt } from "./prompt.js";
import type { ProcessingController } from "../plane/processing.js";
import { processingSurfaceFor } from "../plane/processing.js";
import type {
  InboundMessage,
  InboundOutcome,
  ChannelSenderResolver,
  SupportedChannelName,
  PlaneClock,
} from "../plane/types.js";

// The binding row's route projection lives beside the engine; re-exported so
// `bindings/index.js` stays the one import for the binding surface.
export {
  bindingSummary,
  deriveBindingKey,
  dynamicProjectRoute,
  parseStoredRouteSelection,
  parseStoredRouteSummary,
  parseStoredRouteTarget,
  routeFingerprint,
  routePosition,
  recordedRoute,
  storedRouteOwner,
  type StoredRouteSummary,
  type ThreadKey,
} from "./stored-route.js";
export {
  CHANNEL_EXECUTION_ID_LABEL,
  ChannelWorkflowTargetError,
  applyRouteAutoAccept,
  channelExecutionLabels,
} from "./session-create.js";

const NO_AGENT_REASON = "thread binding has no agent; operator recovery required";

/**
 * The binding states no inbound may drive, as one rule: `admit` (which answers
 * before a turn is opened) and `bindOrSteer` (which answers while driving one)
 * must refuse the same thread for the same reason.
 */
function bindingBlock(binding: ThreadBindingRecord | undefined): string | undefined {
  if (binding?.status === "abandoned") return "thread is abandoned; operator recovery required";
  if (binding?.status === "bound" && binding.agentId === null) return NO_AGENT_REASON;
  return undefined;
}

/** Does the bound session still run at the target the route names? Comparing
 * agent name and environment deliberately ignores a dynamic Project override:
 * an existing session remains bound until `/new` releases it. */
function keepsTarget(binding: ThreadBindingRecord, route: CompiledRoute): boolean {
  const bound = parseStoredRouteTarget(binding.route);
  if (bound === undefined) return true;
  if (bound.kind === "workflow") {
    return route.target.kind === "workflow" && bound.workflow === route.target.workflow;
  }
  return (
    route.target.kind === "agent" &&
    bound.agent === route.target.agent &&
    bound.environment === route.target.environment
  );
}

/** The optional conversation label, in the one spelling every outcome uses. */
function labelOf(message: InboundMessage): { conversationLabel?: string } {
  return message.conversationLabel === undefined
    ? {}
    : { conversationLabel: message.conversationLabel };
}

interface BindingEngineContext extends SessionStartContext {
  controlPlane: ChannelControlPlane;
  clock: PlaneClock;
  store: ChannelStore;
  resolveChannelSender?: ChannelSenderResolver | undefined;
  /** Release a session the plane no longer streams — the conversation moved to
   * another target. Absent = the engine only cancels and unbinds it. */
  detachAgent?: ((agentId: string) => Promise<void> | void) | undefined;
  /** COMPAT(clisbot-control-plane): the turn-lifecycle surface (the vertical's
   * `outbound.typing`). The lease opens HERE, at the moment the inbound
   * has passed every admission gate and is known to be running a turn — not
   * later on `turn_started`, which the plane cannot reliably see because it
   * sends the prompt before the daemon reports anything. Absent = no surface.
   */
  processing?: ProcessingController | undefined;
  /** The binding's inbox (`inbox.ts`): the context a prompt carries. Absent =
   * each prompt is its sender line alone. */
  inbox?: BindingInbox | undefined;
}

/**
 * Drives the thread binding lifecycle and continuous execution. Constructed at
 * plane start with the daemon + store; holds the in-memory idle window (the
 * `followUp.ttlMinutes` clock seam — no real timers on the happy path).
 */
export class BindingEngine {
  private readonly context: BindingEngineContext;
  private readonly lastActivity = new Map<string, number>();

  constructor(context: BindingEngineContext) {
    this.context = context;
  }

  async admit(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
  ): Promise<FollowUpAdmission> {
    const key = deriveBindingKey(message, route);
    const binding = await this.context.store.findThreadBinding(
      this.context.organizationId,
      account.accountId,
      key.externalConversationId,
      key.externalThreadId,
    );
    const blocked = bindingBlock(binding);
    if (blocked !== undefined) return { allowed: false, reason: blocked };
    if (binding?.status === "bound" && binding.agentId !== null) {
      const followUp = admitFollowUp(
        message,
        route.defaults,
        this.isIdle(binding.agentId, route.defaults),
        await this.followUpMode(message, route),
      );
      if (!followUp.allowed) return followUp;
    } else if (route.defaults.requireMention && !message.mentionedBot) {
      return { allowed: false, reason: "not mentioned; requireMention is on", unaddressed: true };
    }
    const decision = await this.mayUse(message, account, route);
    return decision.allowed ? decision : { ...decision, audienceRefused: true };
  }

  /**
   * The one inbound decision: admit, create, or steer. `account` + `route` are
   * the resolved route (the facade matches it); admission and the binding
   * lookup happen here, then the create or steer is driven on the daemon.
   *
   * `subscribe` runs once the agent exists and BEFORE its prompt is delivered,
   * so the plane can register the session's stream first. Without it the first
   * turn of a new session streams its events to nobody — the create returns,
   * the prompt goes out, and the subscription is only registered after the
   * whole exchange (which is why a channel turn's `turn_started` never arrived).
   */
  bindOrSteer(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    subscribe?: (agentId: string) => Promise<void> | void,
  ): Promise<InboundOutcome> {
    return this.deliver({ message }, account, route, subscribe);
  }

  /** `bindOrSteer` for any delivery: one message, or a held batch sent as one prompt. */
  async deliver(
    delivery: Delivery,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    subscribe?: (agentId: string) => Promise<void> | void,
  ): Promise<InboundOutcome> {
    // A replay of a delivery its session already took (the queue lost the
    // completion) is done: sending again would be a second prompt.
    if (await this.context.inbox?.delivered(delivery, route)) {
      return { kind: "ignored", reason: "already delivered to its session" };
    }
    const outcome = await this.dispatch(delivery, account, route, subscribe);
    if (outcome.kind === "bound" || outcome.kind === "steered") {
      await endFollowUpPause(
        this.context.store,
        this.context.organizationId,
        delivery.message,
        route,
      );
    }
    return outcome;
  }

  private async dispatch(
    delivery: Delivery,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    subscribe?: (agentId: string) => Promise<void> | void,
  ): Promise<InboundOutcome> {
    const key = deriveBindingKey(delivery.message, route);
    const binding = await this.context.store.findThreadBinding(
      this.context.organizationId,
      account.accountId,
      key.externalConversationId,
      key.externalThreadId,
    );
    if (binding === undefined) return this.firstMention(delivery, account, route, key, subscribe);
    if (binding.status === "pending") {
      return this.recoverPending(delivery, account, route, binding, subscribe);
    }
    // Abandonment is an explicit operator act (the plane never abandons); the
    // key is permanently held, so steering back needs operator recovery.
    const blocked = bindingBlock(binding);
    if (blocked !== undefined) return { kind: "ignored", reason: blocked };
    if (binding.agentId === null) return { kind: "ignored", reason: NO_AGENT_REASON };
    // The conversation is routed somewhere else now. Steering the bound session
    // would answer from a target the configuration no longer names, so the
    // thread starts a session at the new one — but only for an inbound that may
    // start one, so an unadmitted message never retires a running session.
    if (!keepsTarget(binding, route)) {
      const refusal = await this.admitUnbound(delivery, account, route);
      if (refusal !== undefined) return refusal;
      await this.retireRetargeted(binding);
      return this.firstMention(delivery, account, route, key, subscribe);
    }
    if (this.lostReplyCapability(binding.agentId, route)) {
      return this.replaceSilencedSession(delivery, account, route, binding, key, subscribe);
    }
    return this.followUp(delivery, account, route, binding.agentId, subscribe);
  }

  /** The start-time half of orphan recovery; the inline half is `recoverPending`. */
  recoverOrphans(scope?: {
    channel: SupportedChannelName;
    accountId: string;
  }): Promise<{ rebound: number; leftPending: number }> {
    return recoverOrphanMarkers(this.context, scope);
  }

  // --- Sub-decisions -------------------------------------------------------

  /** First mention in an unbound thread: gate on `bot.interact`, then create. */
  private async firstMention(
    delivery: Delivery,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    key: ThreadKey,
    subscribe?: (agentId: string) => Promise<void> | void,
  ): Promise<InboundOutcome> {
    const refusal = await this.admitUnbound(delivery, account, route);
    if (refusal !== undefined) return refusal;
    return this.startSession(delivery, account, route, key, subscribe);
  }

  /**
   * A `tool`-path session whose reply capability is gone (revoked, expired)
   * answers into silence for the rest of its life: the daemon keeps the MCP URL
   * it was created with, so no new capability can reach it. The conversation
   * gets a fresh session instead — admitted as the follow-up it is, so a
   * message that could have steered the old session does not need a new mention.
   */
  private async replaceSilencedSession(
    delivery: Delivery,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    binding: ThreadBindingRecord,
    key: ThreadKey,
    subscribe?: (agentId: string) => Promise<void> | void,
  ): Promise<InboundOutcome> {
    const agentId = binding.agentId ?? "";
    const refusal = await this.admitBound(delivery, account, route, agentId);
    if (refusal !== undefined) return refusal;
    this.context.logger.warn(
      "bound session lost its channel reply capability; starting a new one",
      {
        channel: account.channel,
        accountId: account.accountId,
        ...labelOf(delivery.message),
        agentId,
      },
    );
    await this.retireRetargeted(binding);
    return this.startSession(delivery, account, route, key, subscribe);
  }

  /** A tool-attaching (`tool`/`hybrid`) route whose bound session can no longer post its reply. */
  private lostReplyCapability(agentId: string, route: CompiledRoute): boolean {
    const capabilities = this.context.replyCapabilities;
    return (
      outboundAttachesTool(route.defaults.outbound.path) &&
      capabilities !== undefined &&
      !capabilities.holdsAgentCapability(agentId)
    );
  }

  /** Mint and bind a session for an admitted inbound, then deliver its prompt. */
  private async startSession(
    delivery: Delivery,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    key: ThreadKey,
    subscribe?: (agentId: string) => Promise<void> | void,
  ): Promise<InboundOutcome> {
    const message = delivery.message;
    // The Host is already starting as many sessions as it runs at once. The
    // message goes back to the durable queue instead of waiting here, so the
    // worker it holds is free for conversations that need no new session.
    if (!this.context.daemon.hasFreeCreateSlot()) {
      return {
        kind: "deferred",
        reason: "the Host is busy starting other sessions",
        retryAfterMs: HOST_BUSY_RETRY_AFTER_MS,
      };
    }
    const start = { account, route, key, executionId: randomUUID(), message };
    // Admitted: the turn is happening. Raise the surface before any daemon
    // call, keyed provisionally on the execution id and re-keyed to the
    // agent once it exists.
    this.openSurface(start.executionId, message, account, route, key);
    const contested = await recordSessionMarker(this.context, start).catch((error: unknown) => {
      this.context.processing?.close(start.executionId);
      throw error;
    });
    if (contested !== undefined) {
      // Another start owns this thread; its recovery raises its own surface.
      this.context.processing?.close(start.executionId);
      return this.recoverPending(delivery, account, route, contested, subscribe);
    }
    const agentId = await createMarkedSession(this.context, start);
    await this.deliverFirstPrompt(agentId, start.executionId, delivery, account, route, subscribe);
    this.context.logger.info?.("conversation bound to a new agent session", {
      channel: account.channel,
      accountId: account.accountId,
      ...labelOf(message),
      agentId,
    });
    return { kind: "bound", agentId, newSession: true, ...labelOf(message) };
  }

  /**
   * Retire the session a conversation leaves behind when its route no longer
   * targets it — a Workflow route, in particular, mints no binding of its own,
   * so the plane retires the agent session it replaces. The caller admits the
   * inbound first: ending a session is gated like starting one.
   */
  async retireBoundSession(binding: ThreadBindingRecord): Promise<void> {
    if (binding.status !== "bound") return;
    await this.retireRetargeted(binding);
  }

  /** Cancel, detach and unbind the session a retargeted conversation leaves. */
  private async retireRetargeted(binding: ThreadBindingRecord): Promise<void> {
    const agentId = binding.agentId;
    await this.context.store.releaseThreadBinding({
      organizationId: this.context.organizationId,
      accountId: binding.accountId,
      externalConversationId: binding.externalConversationId,
      externalThreadId: binding.externalThreadId,
      ...(agentId === null ? {} : { expectedAgentId: agentId }),
    });
    if (agentId === null) return;
    this.lastActivity.delete(agentId);
    await this.context.daemon.cancelAgent(agentId).catch(() => undefined);
    await this.context.detachAgent?.(agentId);
  }

  /**
   * The admission an UNBOUND thread needs before it may mint or re-bind a
   * session: the mention gate, then the route's `bot.interact` gate. A
   * re-bind is driven by an inbound, not by an operator, so it passes exactly
   * the same gates as a first mention. `undefined` = admitted.
   */
  private async admitUnbound(
    delivery: Delivery,
    account: CompiledChannelAccount,
    route: CompiledRoute,
  ): Promise<InboundOutcome | undefined> {
    if (delivery.admitted === true) return undefined;
    const message = delivery.message;
    if (route.defaults.requireMention && !message.mentionedBot) {
      return { kind: "ignored", reason: "not mentioned; requireMention is on" };
    }
    const authorization = await this.mayUse(message, account, route);
    return authorization.allowed ? undefined : { kind: "ignored", reason: authorization.reason };
  }

  /**
   * The admission a BOUND thread needs to continue: the follow-up gate (mode,
   * idle window) and then the route's `bot.interact` gate. `undefined` = admitted.
   */
  private async admitBound(
    delivery: Delivery,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    agentId: string,
  ): Promise<InboundOutcome | undefined> {
    if (delivery.admitted === true) return undefined;
    const message = delivery.message;
    const admission = admitFollowUp(
      message,
      route.defaults,
      this.isIdle(agentId, route.defaults),
      await this.followUpMode(message, route),
    );
    if (!admission.allowed) {
      return { kind: "ignored", reason: admission.reason ?? "follow-up not admitted" };
    }
    const authorization = await this.mayUse(message, account, route);
    return authorization.allowed ? undefined : { kind: "ignored", reason: authorization.reason };
  }

  /**
   * Subscribe the session, then deliver the prompt that opened it: everything
   * the turn emits from here on is seen, including its terminal event. A prompt
   * the Agent did not take throws, so the message is retried into the session
   * that is now bound instead of being lost.
   */
  private async deliverFirstPrompt(
    agentId: string,
    executionId: string,
    delivery: Delivery,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    subscribe?: (agentId: string) => Promise<void> | void,
  ): Promise<void> {
    this.markActive(agentId);
    this.context.processing?.bind(executionId, agentId);
    await subscribe?.(agentId);
    try {
      await this.deliverPrompt(agentId, delivery, route);
    } catch (error) {
      this.context.processing?.close(executionId);
      this.context.logger.warn("first prompt delivery failed; the message is retried", {
        accountId: account.accountId,
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Hand a delivery to the Agent. The daemon keys the send by the delivery's
   * messages and refuses a replay whose request differs
   * (`agent_request_key_conflict`), so the request is a function of the
   * delivery alone, never of the path that sends it: the prompt that opened a
   * session and its retry — which finds the session bound and arrives as a
   * follow-up — must be the same request. The inbox renders it from rows that
   * arrived before the delivery, which a replay reads the same way. Steering
   * an Agent with no turn running starts one, so a first prompt loses nothing
   * by steering.
   */
  private async deliverPrompt(
    agentId: string,
    delivery: Delivery,
    route: CompiledRoute,
  ): Promise<void> {
    const prepared = await this.prepare(delivery, route);
    await prepared.markSent();
    await this.context.daemon.sendAgentMessage(agentId, prepared.prompt, {
      steer: true,
      source: delivery.message,
      messageId: prepared.messageId,
    });
    await prepared.settle();
  }

  private prepare(delivery: Delivery, route: CompiledRoute): Promise<PreparedDelivery> {
    if (this.context.inbox !== undefined) return this.context.inbox.prepare(delivery, route);
    const messages = messagesOf(delivery);
    return Promise.resolve({
      prompt: renderConversationPrompt({ context: [], messages }),
      messageId: deliveryMessageId(messages),
      markSent: async () => undefined,
      settle: async () => undefined,
    });
  }

  /**
   * A pending marker already exists for this key. This is the inline half of
   * orphan recovery (the start-time scan is `recoverOrphans`): re-bind when the
   * Agent survived and deliver this message to it; start over once the marker
   * has waited out its TTL with no Agent; otherwise the create may still land,
   * so the message is retried. The inbound drives all three, so it carries the
   * same admission as a first mention.
   */
  private async recoverPending(
    delivery: Delivery,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    marker: ThreadBindingRecord,
    subscribe?: (agentId: string) => Promise<void> | void,
  ): Promise<InboundOutcome> {
    const refusal = await this.admitUnbound(delivery, account, route);
    if (refusal !== undefined) return refusal;
    const message = delivery.message;
    const key = deriveBindingKey(message, route);
    const executionId = marker.pendingExecutionId ?? "";
    const agents = await this.context.daemon.listAgents();
    const surviving = findChannelExecutionAgent(agents, executionId);
    if (surviving === undefined) {
      if (!pendingMarkerExpired(marker, this.context.clock.now())) {
        throw new ChannelAgentCreatePendingError();
      }
      await releasePendingMarker(this.context, account, key, executionId);
      return this.startSession(delivery, account, route, key, subscribe);
    }
    // The Agent was launched with the capability its create issued; bind it now
    // that the Agent is known. Without one (a Hub restart forgot the turn) a
    // `tool` route Agent could only answer into silence, so it is replaced.
    this.context.replyCapabilities?.bindTurn(executionId, surviving.id);
    if (this.lostReplyCapability(surviving.id, route)) {
      await this.context.daemon.cancelAgent(surviving.id).catch(() => undefined);
      await releasePendingMarker(this.context, account, key, executionId);
      return this.startSession(delivery, account, route, key, subscribe);
    }
    await this.context.store.resolvePendingThreadBinding({
      organizationId: this.context.organizationId,
      accountId: account.accountId,
      externalConversationId: key.externalConversationId,
      externalThreadId: key.externalThreadId,
      agentId: surviving.id,
      resolvedAt: new Date(),
    });
    this.openSurface(executionId, message, account, route, key);
    await this.deliverFirstPrompt(surviving.id, executionId, delivery, account, route, subscribe);
    this.context.logger.info?.("inbound re-bound a pending marker", {
      channel: account.channel,
      accountId: account.accountId,
      ...labelOf(message),
      agentId: surviving.id,
    });
    return { kind: "bound", agentId: surviving.id, newSession: false, ...labelOf(message) };
  }

  /** A bound thread: admit the follow-up and steer the existing session. */
  private async followUp(
    delivery: Delivery,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    agentId: string,
    subscribe?: (agentId: string) => Promise<void> | void,
  ): Promise<InboundOutcome> {
    const refusal = await this.admitBound(delivery, account, route, agentId);
    if (refusal !== undefined) return refusal;
    const message = delivery.message;
    const leaseId = randomUUID();
    this.openSurface(leaseId, message, account, route, deriveBindingKey(message, route));
    this.context.processing?.bind(leaseId, agentId);
    // The session's reply capability now answers for THIS turn: its delivery
    // keys and its per-turn output ceiling both reset here.
    this.context.replyCapabilities?.noteTurn(agentId, leaseId, message.externalMessageId);
    await subscribe?.(agentId);
    try {
      await this.deliverPrompt(agentId, delivery, route);
    } catch (error) {
      this.context.processing?.close(leaseId);
      throw error;
    }
    this.markActive(agentId);
    return {
      kind: "steered",
      agentId,
      ...labelOf(message),
    };
  }

  // --- Idle window ----------------------------------------------------------

  /** True when the agent's last activity is older than the follow-up window.
   * The window lives in memory, so an agent with no recorded activity in this
   * process (a Hub restart) is outside it: the next message must mention the
   * bot, as clisbot's `participationTtl` does with no recorded bot reply. */
  isIdle(agentId: string, defaults: EffectiveDefaults): boolean {
    const last = this.lastActivity.get(agentId);
    if (last === undefined) return true;
    return this.context.clock.now() - last > defaults.followUp.ttlMinutes * 60_000;
  }

  private followUpMode(message: InboundMessage, route: CompiledRoute): Promise<FollowUpMode> {
    return conversationFollowUpMode(
      this.context.store,
      this.context.organizationId,
      message,
      route,
    );
  }

  /** Record that the agent is active now (a steer or a fresh create). */
  markActive(agentId: string): void {
    this.lastActivity.set(agentId, this.context.clock.now());
  }

  private async mayUse(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
  ): ReturnType<typeof mayUseChannelRoute> {
    return await mayUseChannelRoute({
      store: this.context.store.access,
      organizationId: this.context.organizationId,
      controlPlane: this.context.controlPlane,
      account,
      route,
      message,
      ...(this.context.resolveChannelSender === undefined
        ? {}
        : { resolveChannelSender: this.context.resolveChannelSender }),
    });
  }

  /**
   * Mint the turn's reply capability for a `outbound.path: tool` route.
   *
   * Everything on it is the Hub's, never the model's: the conversation it may
   * post into, the turn it is answering, the requester it acts for, and the
   * inbound message that turn is answering.
   */
  private openSurface(
    leaseId: string,
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    key: ThreadKey,
  ): void {
    const processing = this.context.processing;
    if (processing === undefined) return;
    const surface = processingSurfaceFor({
      channel: account.channel as SupportedChannelName,
      accountId: account.accountId,
      sync: route.defaults.sync,
      to: key.externalConversationId,
      ...(key.externalThreadId !== null ? { threadId: key.externalThreadId } : {}),
      ...(message.externalMessageId !== undefined ? { messageId: message.externalMessageId } : {}),
    });
    if (surface === undefined) return;
    processing.open(leaseId, surface);
  }
}

export { admitFollowUp, type FollowUpAdmission } from "./follow-up.js";
