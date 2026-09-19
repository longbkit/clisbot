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
import { ChannelThreadBindingConflictError, type ChannelStore } from "../../db/channels.js";
import type { ThreadBindingRecord } from "../../db/types.js";
import type {
  ChannelControlPlane,
  CompiledChannelAccount,
  CompiledRoute,
  EffectiveDefaults,
} from "../config/compile.js";
import type { FollowUpMode } from "../config/enums.js";
import {
  bindingSummary,
  deriveBindingKey,
  parseStoredRouteTarget,
  routePosition,
  type ThreadKey,
} from "./stored-route.js";
import {
  ChannelWorkflowTargetError,
  createRouteSession,
  findChannelExecutionAgent,
  type SessionCreateContext,
} from "./session-create.js";
import {
  admitFollowUp,
  conversationFollowUpMode,
  endFollowUpPause,
  type FollowUpAdmission,
} from "./follow-up.js";
import { mayUseChannelRoute } from "../policy/gate.js";
import type { ProcessingController } from "../plane/processing.js";
import { processingSurfaceFor } from "../plane/processing.js";
import type {
  InboundMessage,
  InboundOutcome,
  ChannelSenderResolver,
  ChannelUseAuthorizer,
  SupportedChannelName,
  PlaneClock,
} from "../plane/types.js";

// The binding row's route projection lives beside the engine; re-exported so
// `bindings/index.js` stays the one import for the binding surface.
export {
  bindingSummary,
  deriveBindingKey,
  parseStoredRouteSelection,
  parseStoredRouteSummary,
  parseStoredRouteTarget,
  routeFingerprint,
  routePosition,
  storedRouteOwner,
  type StoredRouteSummary,
  type ThreadKey,
} from "./stored-route.js";
export {
  CHANNEL_EXECUTION_ID_LABEL,
  ChannelWorkflowTargetError,
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

/**
 * Does the bound session still run at the target the route names? Comparing
 * targets — not the route's content — is what lets an operator edit a route
 * without disturbing the conversations it already owns. A row written before
 * targets were summarized states nothing, so it keeps its session.
 */
function keepsTarget(binding: ThreadBindingRecord, route: CompiledRoute): boolean {
  const bound = parseStoredRouteTarget(binding.route);
  if (bound === undefined) return true;
  if (bound.kind !== route.target.kind) return false;
  return bound.kind === "workflow"
    ? bound.workflow === (route.target as { workflow: string }).workflow
    : bound.agent === (route.target as { agent: string }).agent &&
        bound.environment === (route.target as { environment: string }).environment;
}

/** The optional conversation label, in the one spelling every outcome uses. */
function labelOf(message: InboundMessage): { conversationLabel?: string } {
  return message.conversationLabel === undefined
    ? {}
    : { conversationLabel: message.conversationLabel };
}

interface BindingEngineContext extends SessionCreateContext {
  controlPlane: ChannelControlPlane;
  clock: PlaneClock;
  store: ChannelStore;
  authorizeChannelUse?: ChannelUseAuthorizer | undefined;
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
      return { allowed: false, reason: "not mentioned; requireMention is on" };
    }
    return this.mayUse(message, account, route);
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
  async bindOrSteer(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    subscribe?: (agentId: string) => Promise<void> | void,
  ): Promise<InboundOutcome> {
    const outcome = await this.dispatch(message, account, route, subscribe);
    if (outcome.kind === "bound" || outcome.kind === "steered") {
      await endFollowUpPause(this.context.store, this.context.organizationId, message, route);
    }
    return outcome;
  }

  private async dispatch(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    subscribe?: (agentId: string) => Promise<void> | void,
  ): Promise<InboundOutcome> {
    const key = deriveBindingKey(message, route);
    const binding = await this.context.store.findThreadBinding(
      this.context.organizationId,
      account.accountId,
      key.externalConversationId,
      key.externalThreadId,
    );
    if (binding === undefined) return this.firstMention(message, account, route, key, subscribe);
    if (binding.status === "pending") {
      return this.recoverPending(message, account, route, key, binding.pendingExecutionId);
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
      const refusal = await this.admitUnbound(message, account, route);
      if (refusal !== undefined) return refusal;
      await this.retireRetargeted(binding);
      return this.firstMention(message, account, route, key, subscribe);
    }
    if (this.lostReplyCapability(binding.agentId, route)) {
      return this.replaceSilencedSession(message, account, route, binding, key, subscribe);
    }
    return this.followUp(message, account, route, binding.agentId, subscribe);
  }

  /**
   * Orphan recovery (plan §10): scan the org's pending markers against
   * `fetch_agents`; a marker whose agent survived (matched by its
   * execution-id label) is re-bound instead of re-created. A marker with no surviving agent
   * is left pending — the create may have timed out rather than failed, so a
   * later inbound (or a later restart) re-checks it.
   */
  async recoverOrphans(scope?: {
    channel: SupportedChannelName;
    accountId: string;
  }): Promise<{ rebound: number; leftPending: number }> {
    const pending = await this.context.store.listPendingThreadBindings(
      this.context.organizationId,
      scope,
    );
    if (pending.length === 0) return { rebound: 0, leftPending: 0 };
    const agents = await this.context.daemon.listAgents();
    let rebound = 0;
    let leftPending = 0;
    for (const marker of pending) {
      const agent = findChannelExecutionAgent(agents, marker.pendingExecutionId ?? "");
      if (agent === undefined) {
        leftPending += 1;
        continue;
      }
      await this.context.store.resolvePendingThreadBinding({
        organizationId: marker.organizationId,
        accountId: marker.accountId,
        externalConversationId: marker.externalConversationId,
        externalThreadId: marker.externalThreadId,
        agentId: agent.id,
        resolvedAt: new Date(),
      });
      this.context.logger.info?.("orphan recovery re-bound a pending marker", {
        accountId: marker.accountId,
        agentId: agent.id,
      });
      rebound += 1;
    }
    return { rebound, leftPending };
  }

  // --- Sub-decisions -------------------------------------------------------

  /** First mention in an unbound thread: gate on `bot.interact`, then create. */
  private async firstMention(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    key: ThreadKey,
    subscribe?: (agentId: string) => Promise<void> | void,
  ): Promise<InboundOutcome> {
    const refusal = await this.admitUnbound(message, account, route);
    if (refusal !== undefined) return refusal;
    return this.startSession(message, account, route, key, subscribe);
  }

  /**
   * A `tool`-path session whose reply capability is gone (revoked, expired)
   * answers into silence for the rest of its life: the daemon keeps the MCP URL
   * it was created with, so no new capability can reach it. The conversation
   * gets a fresh session instead — admitted as the follow-up it is, so a
   * message that could have steered the old session does not need a new mention.
   */
  private async replaceSilencedSession(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    binding: ThreadBindingRecord,
    key: ThreadKey,
    subscribe?: (agentId: string) => Promise<void> | void,
  ): Promise<InboundOutcome> {
    const agentId = binding.agentId ?? "";
    const refusal = await this.admitBound(message, account, route, agentId);
    if (refusal !== undefined) return refusal;
    this.context.logger.warn(
      "bound session lost its channel reply capability; starting a new one",
      {
        channel: account.channel,
        accountId: account.accountId,
        ...labelOf(message),
        agentId,
      },
    );
    await this.retireRetargeted(binding);
    return this.startSession(message, account, route, key, subscribe);
  }

  /** A `tool`-path route whose bound session can no longer post its reply. */
  private lostReplyCapability(agentId: string, route: CompiledRoute): boolean {
    const capabilities = this.context.replyCapabilities;
    return (
      route.defaults.outbound.path === "tool" &&
      capabilities !== undefined &&
      !capabilities.holdsAgentCapability(agentId)
    );
  }

  /** Mint and bind a session for an admitted inbound, then deliver its prompt. */
  private async startSession(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    key: ThreadKey,
    subscribe?: (agentId: string) => Promise<void> | void,
  ): Promise<InboundOutcome> {
    const executionId = randomUUID();
    // Admitted: the turn is happening. Raise the surface before any daemon
    // call, keyed provisionally on the execution id and re-keyed to the
    // agent once it exists.
    this.openSurface(executionId, message, account, route, key);
    try {
      await this.context.store.recordPendingThreadBinding({
        organizationId: this.context.organizationId,
        channel: account.channel as SupportedChannelName,
        accountId: account.accountId,
        externalConversationId: key.externalConversationId,
        externalThreadId: key.externalThreadId,
        pendingExecutionId: executionId,
        initiator: message.senderIdentity,
        route: bindingSummary(
          route,
          message.conversation,
          {
            revisionId: this.context.channelRevisionId ?? null,
            position: routePosition(account, route),
          },
          message.conversationLabel,
        ),
      });
    } catch (error) {
      // A concurrent mention won the insert between our lookup and our insert:
      // re-read the key and drive the existing marker instead of creating a
      // second agent. `ChannelThreadBindingConflictError` is the only record
      // failure here (a missing row is impossible — we just looked it up), so
      // anything else is a real fault and stays fatal.
      if (!(error instanceof ChannelThreadBindingConflictError)) throw error;
      const existing = await this.context.store.findThreadBinding(
        this.context.organizationId,
        account.accountId,
        key.externalConversationId,
        key.externalThreadId,
      );
      if (existing?.status === "pending") {
        return this.recoverPending(message, account, route, key, existing.pendingExecutionId);
      }
      throw error;
    }
    let created;
    try {
      created = await createRouteSession(this.context, account, route, key, executionId, message);
    } catch (error) {
      return this.settleCreationFailure(error, account, executionId);
    }
    await this.context.store.resolvePendingThreadBinding({
      organizationId: this.context.organizationId,
      accountId: account.accountId,
      externalConversationId: key.externalConversationId,
      externalThreadId: key.externalThreadId,
      agentId: created.agentId,
      resolvedAt: new Date(),
    });
    this.markActive(created.agentId);
    this.context.processing?.bind(executionId, created.agentId);
    // Subscribe the session before the prompt: everything the turn emits from
    // here on is seen, including its terminal event.
    await subscribe?.(created.agentId);
    try {
      await this.context.daemon.sendAgentMessage(created.agentId, message.text, {
        steer: false,
        source: message,
      });
    } catch (error) {
      // The turn never started: release the surface, and say so.
      this.context.processing?.close(executionId);
      this.context.logger.warn("first prompt delivery failed", {
        accountId: account.accountId,
        agentId: created.agentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        kind: "ignored",
        reason: "agent did not accept the first prompt",
      };
    }
    this.context.logger.info?.("conversation bound to a new agent session", {
      channel: account.channel,
      accountId: account.accountId,
      ...labelOf(message),
      agentId: created.agentId,
    });
    return {
      kind: "bound",
      agentId: created.agentId,
      newSession: true,
      ...labelOf(message),
    };
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
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
  ): Promise<InboundOutcome | undefined> {
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
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    agentId: string,
  ): Promise<InboundOutcome | undefined> {
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

  /** A failed create keeps its marker: the daemon may have created the Agent anyway. */
  private async settleCreationFailure(
    error: unknown,
    account: CompiledChannelAccount,
    executionId: string,
  ): Promise<InboundOutcome> {
    this.context.processing?.close(executionId);
    // The daemon may have created an Agent before the RPC timed out: the
    // pending marker is the recovery identity, so never recreate or release it.
    this.context.logger.warn("agent create failed; the thread marker stays pending", {
      accountId: account.accountId,
      executionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { kind: "ignored", reason: "agent create in progress; try again shortly" };
  }

  /**
   * A pending marker already exists for this key: rebind when the agent
   * survived the create-then-crash window, otherwise stay pending. This is the
   * inline half of orphan recovery (the start-time scan is `recoverOrphans`).
   * The re-bind is the inbound driving it, so it carries the same admission as
   * a first mention: `requireMention` and `mayTrigger` both gate it — the
   * re-bind is not an operator act, and a sender the route does not admit must
   * not pull the thread to a bound state (nor may an unmentioned message under
   * `requireMention`).
   */

  private async recoverPending(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    key: ThreadKey,
    pendingExecutionId: string | null,
  ): Promise<InboundOutcome> {
    const refusal = await this.admitUnbound(message, account, route);
    if (refusal !== undefined) return refusal;
    const executionId = pendingExecutionId ?? "";
    const agents = await this.context.daemon.listAgents();
    const surviving = findChannelExecutionAgent(agents, executionId);
    if (surviving === undefined) {
      return {
        kind: "ignored",
        reason: "agent create in progress; try again shortly",
      };
    }
    await this.context.store.resolvePendingThreadBinding({
      organizationId: this.context.organizationId,
      accountId: account.accountId,
      externalConversationId: key.externalConversationId,
      externalThreadId: key.externalThreadId,
      agentId: surviving.id,
      resolvedAt: new Date(),
    });
    this.markActive(surviving.id);
    this.context.logger.info?.("inbound re-bound a pending marker", {
      channel: account.channel,
      accountId: account.accountId,
      ...labelOf(message),
      agentId: surviving.id,
    });
    return {
      kind: "bound",
      agentId: surviving.id,
      newSession: false,
      ...labelOf(message),
    };
  }

  /** A bound thread: admit the follow-up and steer the existing session. */
  private async followUp(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    agentId: string,
    subscribe?: (agentId: string) => Promise<void> | void,
  ): Promise<InboundOutcome> {
    const refusal = await this.admitBound(message, account, route, agentId);
    if (refusal !== undefined) return refusal;
    const leaseId = randomUUID();
    this.openSurface(leaseId, message, account, route, deriveBindingKey(message, route));
    this.context.processing?.bind(leaseId, agentId);
    // The session's reply capability now answers for THIS turn: its delivery
    // keys and its per-turn output ceiling both reset here.
    this.context.replyCapabilities?.noteTurn(agentId, leaseId, message.externalMessageId);
    await subscribe?.(agentId);
    try {
      await this.context.daemon.sendAgentMessage(agentId, message.text, {
        steer: true,
        source: message,
      });
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
  ): ReturnType<ChannelUseAuthorizer> {
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
      ...(this.context.authorizeChannelUse === undefined
        ? {}
        : { authorizeChannelUse: this.context.authorizeChannelUse }),
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

/**
 * The compact route summary stored on the binding row. `selection` pins the
 * immutable revision decision without promoting routes into durable resources:
 * position addresses the route inside that revision and fingerprint proves a
 * later revision retained equivalent target and policy before continuation.
 * Older rows without `selection` remain readable through the legacy match key.
 */

export { admitFollowUp, type FollowUpAdmission } from "./follow-up.js";
