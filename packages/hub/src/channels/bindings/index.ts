// Thread bindings + continuous execution (plan §4-S2, implementation doc §4.3.4).
// The Hub keeps one durable thread binding per thread key: the first mention in
// an unbound thread records a pre-create pending marker, issues
// `create_agent_request`, and resolves the marker to the new agent id; every
// follow-up steers the bound session. The pending marker + a marker title on
// the created agent make orphan recovery possible: on start the Hub scans its
// pending markers against `fetch_agents` and rebinds a surviving agent instead
// of re-creating it (plan §10 "one agent, no duplicate" — the trusted path has
// no create-dedup, so the marker is the idempotency). One decision path here:
// admit (mention / follow-up mode / idle TTL) -> binding lookup -> create or
// steer. Workflow targets are out of scope: they own their own session
// lifecycle (implementation doc §4.3.4).
import { createHash, randomUUID } from "node:crypto";
import { ChannelThreadBindingConflictError, type ChannelStore } from "../../db/channels.js";
import type {
  ChannelControlPlane,
  CompiledChannelAccount,
  CompiledRoute,
  EffectiveDefaults,
} from "../config/compile.js";
import type { DaemonConnection } from "../daemon/client.js";
import type { CreateAgentConfig } from "../daemon/types.js";
import { resolveConversationConfiguration } from "../commands-config.js";
import type { InboundConversation } from "../policy.js";
import { mayUseChannelRoute } from "../policy/gate.js";
import type { ProcessingController } from "../plane/processing.js";
import { processingSurfaceFor } from "../plane/processing.js";
import {
  nativeSenderId,
  type ChannelReplyCapabilityService,
} from "../channel-reply-capabilities.js";
import {
  SLACK_THREAD_TS_PATTERN,
  type ChannelReplyBindingRef,
  type InboundConversationDetail,
  type InboundMessage,
  type InboundOutcome,
  type ChannelAgentAccessTarget,
  type ChannelUseAuthorizer,
  type SupportedChannelName,
  type PlaneClock,
  type PlaneLogger,
} from "../plane/types.js";

/** The durable thread key (conversation + native thread id) a binding is keyed by. */
export interface ThreadKey {
  externalConversationId: string;
  externalThreadId: string | null;
}

/**
 * Derive the thread key a message binds to, per `binding.key` (§4.3.4).
 * `thread`: the native thread/topic is the unit — conversation + thread id (a
 * top-level channel message has no thread id and falls to the conversation
 * level, matching every channel's native "no thread = channel session" rule).
 * `channel` / `dm`: the whole conversation is one session; threads collapse.
 *
 * One exception — the minted-thread key: under `reply.anchor: thread` a
 * root-level Slack marker mints its reply thread on the marker message itself
 * (`thread_ts` = the marker's native ts, the relay's mint), so the marker is
 * already the root of a real thread. It binds at THAT thread's key, not the
 * conversation level: the marker's turn and the thread's follow-ups share one
 * session, two root markers never share one, and the minted thread never
 * re-binds a second session on its first reply.
 */
export function deriveBindingKey(message: InboundMessage, route: CompiledRoute): ThreadKey {
  const conversation = message.conversation;
  let externalThreadId = route.defaults.bindingKey === "thread" ? conversation.threadId : null;
  if (
    externalThreadId === null &&
    route.defaults.bindingKey === "thread" &&
    route.defaults.replyAnchor === "thread" &&
    message.channel === "slack" &&
    conversation.kind !== "dm" &&
    message.externalMessageId !== undefined &&
    SLACK_THREAD_TS_PATTERN.test(message.externalMessageId)
  ) {
    externalThreadId = message.externalMessageId;
  }
  return {
    externalConversationId: conversation.rootConversationId,
    externalThreadId,
  };
}

/** The marker the plane stamps on a created agent so orphan recovery can match it. */
export function executionMarker(pendingExecutionId: string): string {
  return `clisbot-channel:${pendingExecutionId}`;
}

interface BindingEngineContext {
  organizationId: string;
  /** Immutable Channel revision used to select every route in this plane. */
  channelRevisionId?: string | null | undefined;
  controlPlane: ChannelControlPlane;
  logger: PlaneLogger;
  clock: PlaneClock;
  store: ChannelStore;
  daemon: DaemonConnection;
  authorizeChannelUse?: ChannelUseAuthorizer | undefined;
  authorizeConfiguration?:
    | ((input: {
        message: InboundMessage;
        account: CompiledChannelAccount;
        route: CompiledRoute;
        config: CreateAgentConfig;
      }) => Promise<{ allowed: boolean; reason?: string }>)
    | undefined;
  replyCapabilities?: ChannelReplyCapabilityService | undefined;
  /** Resolve a route's agent target into a `create_agent_request` config.
   * The route's effective defaults select the outbound path (E4/E6); on a
   * `tool` path the `bindingRef` names the thread the attached MCP tool
   * posts into (the account + the thread key being created). */
  resolveAgentSpec: import("../plane/types.js").AgentSpecResolver;
  resolveAgentAccessTarget?:
    | ((target: Extract<CompiledRoute["target"], { kind: "agent" }>) => ChannelAgentAccessTarget)
    | undefined;
  /** COMPAT(clisbot-control-plane): record a created agent's home (its
   * create-time `cwd`) for the relay's native-media path (G7–G11). The plane
   * owns the agentId→cwd Map; the relay resolves it through its `agentCwd`
   * resolver. Absent = the engine records nothing (the relay's media home
   * falls back to the shared home root). */
  noteAgentCwd?: ((agentId: string, cwd: string) => void) | undefined;
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
    if (binding?.status === "abandoned") {
      return {
        allowed: false,
        reason: "thread is abandoned; operator recovery required",
      };
    }
    if (binding?.status === "bound" && binding.agentId === null) {
      return {
        allowed: false,
        reason: "thread binding has no agent; operator recovery required",
      };
    }
    if (binding?.status === "bound" && binding.agentId !== null) {
      const followUp = admitFollowUp(
        message,
        route.defaults,
        this.isIdle(binding.agentId, route.defaults),
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
    if (binding.status === "abandoned") {
      // Abandonment is an explicit operator act (the plane never abandons);
      // the key is permanently held, so steering back needs operator recovery.
      return {
        kind: "ignored",
        reason: "thread is abandoned; operator recovery required",
      };
    }
    if (binding.agentId === null) {
      return {
        kind: "ignored",
        reason: "thread binding has no agent; operator recovery required",
      };
    }
    return this.followUp(message, account, route, binding.agentId, subscribe);
  }

  /**
   * Orphan recovery (plan §10): scan the org's pending markers against
   * `fetch_agents`; a marker whose agent survived (matched by the marker
   * title) is re-bound instead of re-created. A marker with no surviving agent
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
    const byTitle = new Map(agents.map((agent) => [agent.title ?? "", agent]));
    let rebound = 0;
    let leftPending = 0;
    for (const marker of pending) {
      const title = executionMarker(marker.pendingExecutionId ?? "");
      const agent = byTitle.get(title);
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
    const defaults = route.defaults;
    if (defaults.requireMention && !message.mentionedBot) {
      return { kind: "ignored", reason: "not mentioned; requireMention is on" };
    }
    const authorization = await this.mayUse(message, account, route);
    if (!authorization.allowed) {
      return { kind: "ignored", reason: authorization.reason };
    }
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
      created = await this.createAgent(account, route, key, executionId, message);
    } catch (error) {
      return this.settleCreationFailure(error, account, key, executionId);
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
      ...(message.conversationLabel !== undefined
        ? { conversationLabel: message.conversationLabel }
        : {}),
      agentId: created.agentId,
    });
    return {
      kind: "bound",
      agentId: created.agentId,
      newSession: true,
      ...(message.conversationLabel !== undefined
        ? { conversationLabel: message.conversationLabel }
        : {}),
    };
  }

  /** A definitive authorization refusal releases its marker; uncertain daemon failures retain it for recovery. */
  private async settleCreationFailure(
    error: unknown,
    account: CompiledChannelAccount,
    key: ThreadKey,
    executionId: string,
  ): Promise<InboundOutcome> {
    this.context.processing?.close(executionId);
    if (error instanceof ChannelConfigurationDeniedError) {
      await this.context.store.releaseThreadBinding({
        organizationId: this.context.organizationId,
        accountId: account.accountId,
        ...key,
      });
      return { kind: "ignored", reason: error.message };
    }
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
    if (route.defaults.requireMention && !message.mentionedBot) {
      return { kind: "ignored", reason: "not mentioned; requireMention is on" };
    }
    const authorization = await this.mayUse(message, account, route);
    if (!authorization.allowed) {
      return { kind: "ignored", reason: authorization.reason };
    }
    const executionId = pendingExecutionId ?? "";
    const agents = await this.context.daemon.listAgents();
    const surviving = agents.find((agent) => agent.title === executionMarker(executionId));
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
      ...(message.conversationLabel !== undefined
        ? { conversationLabel: message.conversationLabel }
        : {}),
      agentId: surviving.id,
    });
    return {
      kind: "bound",
      agentId: surviving.id,
      newSession: false,
      ...(message.conversationLabel !== undefined
        ? { conversationLabel: message.conversationLabel }
        : {}),
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
    const admission = admitFollowUp(message, route.defaults, this.isIdle(agentId, route.defaults));
    if (!admission.allowed) {
      return {
        kind: "ignored",
        reason: admission.reason ?? "follow-up not admitted",
      };
    }
    const authorization = await this.mayUse(message, account, route);
    if (!authorization.allowed) {
      return { kind: "ignored", reason: authorization.reason };
    }
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
      });
    } catch (error) {
      this.context.processing?.close(leaseId);
      throw error;
    }
    this.markActive(agentId);
    return {
      kind: "steered",
      agentId,
      ...(message.conversationLabel !== undefined
        ? { conversationLabel: message.conversationLabel }
        : {}),
    };
  }

  // --- Idle window ----------------------------------------------------------

  /** True when the agent's last activity is older than the idle window. An
   * agent with no recorded activity in this process is not idle. */
  isIdle(agentId: string, defaults: EffectiveDefaults): boolean {
    const last = this.lastActivity.get(agentId);
    if (last === undefined) return false;
    return this.context.clock.now() - last > defaults.followUp.ttlMinutes * 60_000;
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
  private issueReplyCapability(input: {
    account: CompiledChannelAccount;
    route: CompiledRoute;
    ref: ChannelReplyBindingRef;
    executionId: string;
    requester: InboundMessage;
    target: Extract<CompiledRoute["target"], { kind: "agent" }>;
  }): { token: string; canSendFiles: boolean } {
    const { account, route, ref, executionId, requester } = input;
    const capabilities = this.context.replyCapabilities;
    const accessTarget = this.context.resolveAgentAccessTarget?.(input.target);
    if (capabilities === undefined || accessTarget === undefined) {
      throw new Error("Channel reply capability is unavailable");
    }
    const token = capabilities.issue({
      organizationId: this.context.organizationId,
      channelRevisionId: this.context.channelRevisionId ?? null,
      routePosition: routePosition(account, route),
      routeFingerprint: routeFingerprint(route),
      ref,
      // The turn that is minting the session. Every later turn restamps it
      // (`noteTurn` in `followUp`): the tool's idempotency keys and its
      // output ceiling are scoped by the turn, and the model reuses
      // "reply-1" in every one of them.
      turnId: executionId,
      // The turn's requester, in the native form the platform reports back:
      // the ported channel tools authorize against it, and a command button
      // this Agent posts is clickable only by them.
      requesterSenderId: nativeSenderId(account.channel, requester.senderIdentity),
      // The message this turn is answering, so the tool's `react` has a
      // current message to target (see `requesterMessageId`).
      ...(requester.externalMessageId === undefined
        ? {}
        : { requesterMessageId: requester.externalMessageId }),
      ...(accessTarget.projectRoot === undefined ? {} : { projectRoot: accessTarget.projectRoot }),
    });
    return { token, canSendFiles: accessTarget.projectRoot !== undefined };
  }

  /**
   * Issue the trusted `create_agent_request` with the route's agent target. The
   * bot is created IDLE (implementation doc §2.1): the caller delivers the
   * first channel prompt only after it has subscribed the session's stream,
   * so splitting create from send is what keeps the first turn observable.
   */
  private async createAgent(
    account: CompiledChannelAccount,
    route: CompiledRoute,
    key: ThreadKey,
    executionId: string,
    requester: InboundMessage,
  ): Promise<{ agentId: string }> {
    const routeTarget = route.target;
    if (routeTarget.kind !== "agent") {
      throw new ChannelWorkflowTargetError(routeTarget.workflow);
    }
    const ref = {
      channel: account.channel as SupportedChannelName,
      accountId: account.accountId,
      externalConversationId: key.externalConversationId,
      externalThreadId: key.externalThreadId,
    };
    // `/agent` and `/model` are conversation-scoped and outlive every session
    // in it, so they are read here — at the one place a session is minted —
    // rather than carried on the binding row that `/new` deletes.
    const chosen = await this.context.store.access.findConversationSelection({
      organizationId: this.context.organizationId,
      ...ref,
    });
    const target = routeTarget;
    const issued =
      route.defaults.outbound.path === "tool"
        ? this.issueReplyCapability({ account, route, ref, executionId, requester, target })
        : undefined;
    const capabilityToken = issued?.token;
    const canSendFiles = issued?.canSendFiles === true;
    try {
      const baseConfig = this.context.resolveAgentSpec(
        target,
        route.defaults,
        ref,
        capabilityToken === undefined
          ? undefined
          : {
              token: capabilityToken,
              canSendFiles,
            },
        undefined,
      );
      const config = resolveConversationConfiguration(baseConfig, chosen);
      const authorization = await this.context.authorizeConfiguration?.({
        message: requester,
        account,
        route,
        config,
      });
      if (authorization?.allowed === false)
        throw new ChannelConfigurationDeniedError(
          authorization.reason ?? "Agent configuration is outside your access.",
        );
      const created = await this.context.daemon.createAgent(config, {
        title: executionMarker(executionId),
      });
      if (
        capabilityToken !== undefined &&
        this.context.replyCapabilities?.bind(capabilityToken, created.agentId) !== true
      ) {
        await this.context.daemon.cancelAgent(created.agentId).catch(() => undefined);
        throw new Error("Channel reply capability could not bind to the created Agent");
      }
      // COMPAT(clisbot-control-plane): the agent's home for the relay's
      // native-media path — the `cwd` the daemon runs it in (G7–G11).
      this.context.noteAgentCwd?.(created.agentId, config.cwd);
      return { agentId: created.agentId };
    } catch (error) {
      if (capabilityToken !== undefined) {
        this.context.replyCapabilities?.revoke(capabilityToken);
      }
      throw error;
    }
  }

  /**
   * Raise the turn's liveness surface for an admitted inbound. The location
   * is the BINDING key (where the reply will be addressed, including the
   * thread a root Slack marker mints), because the lease opens before the
   * prompt is sent and the stream context does not exist yet.
   *
   * No controller, no admitted leaf, or a drive that fails on the wire all
   * leave the turn running: the surface is decoration, never a gate.
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

/** A follow-up admission result over a bound session. */
export interface FollowUpAdmission {
  allowed: boolean;
  reason?: string | undefined;
}

/**
 * Admit a follow-up into a bound session. A mention always steers. An
 * unmentioned follow-up steers only in `followUp.mode: auto` while the session
 * is still active — `mention-only` always re-mentions, and an idle `auto`
 * session idled out and needs a fresh mention (implementation doc §4.3.4:
 * `interaction.followUp.mode` gates whether an unmentioned follow-up is
 * admitted; `binding` decides which session it lands in).
 */
export function admitFollowUp(
  message: { mentionedBot: boolean },
  defaults: EffectiveDefaults,
  idle: boolean,
): FollowUpAdmission {
  if (message.mentionedBot) return { allowed: true };
  if (defaults.followUp.mode === "mention-only") {
    return {
      allowed: false,
      reason: "route requires a mention for every message",
    };
  }
  if (idle)
    return {
      allowed: false,
      reason: "session idled out; mention the bot to resume",
    };
  return { allowed: true };
}

/**
 * The compact route summary stored on the binding row. `selection` pins the
 * immutable revision decision without promoting routes into durable resources:
 * position addresses the route inside that revision and fingerprint proves a
 * later revision retained equivalent target and policy before continuation.
 * Older rows without `selection` remain readable through the legacy match key.
 */
export interface StoredRouteSummary {
  /** The original route-match descriptor (`kind` + native id). */
  match: { kind: InboundConversationDetail["kind"]; id: string };
  target: CompiledRoute["target"];
  bindingKey: EffectiveDefaults["bindingKey"];
  replyAnchor: EffectiveDefaults["replyAnchor"];
  /** Human label observed at admission; display-only and never an access key. */
  conversationLabel?: string;
  selection?: {
    revisionId: string | null;
    position: number | "fallback";
    fingerprint: string;
  };
}

export function bindingSummary(
  route: CompiledRoute,
  conversation: InboundConversationDetail,
  selection?: { revisionId: string | null; position: number | "fallback" },
  conversationLabel?: string,
): StoredRouteSummary {
  // The route may have matched a thread message at its root-level descriptor;
  // store the level the route declares, not necessarily the inbound's most
  // specific level. Fallbacks use the root descriptor.
  const atInboundLevel = route.match.kind === conversation.kind;
  const match = atInboundLevel
    ? { kind: conversation.kind, id: conversation.id }
    : {
        kind: rootKind(conversation.kind),
        id: conversation.rootConversationId,
      };
  const safeConversationLabel = conversationLabel?.trim().slice(0, 200);
  return {
    match,
    target: route.target,
    bindingKey: route.defaults.bindingKey,
    replyAnchor: route.defaults.replyAnchor,
    ...(safeConversationLabel ? { conversationLabel: safeConversationLabel } : {}),
    ...(selection === undefined
      ? {}
      : {
          selection: {
            revisionId: selection.revisionId,
            position: selection.position,
            fingerprint: routeFingerprint(route),
          },
        }),
  };
}

/** Internal position of a compiled route inside one immutable account revision. */
export function routePosition(
  account: CompiledChannelAccount,
  route: CompiledRoute,
): number | "fallback" {
  const position = account.routes.indexOf(route);
  return position < 0 ? "fallback" : position;
}

/** Stable comparison token for continuation across a Channel revision. */
export function routeFingerprint(route: CompiledRoute): string {
  return createHash("sha256").update(JSON.stringify(route)).digest("base64url");
}

/** Parsed captured selection; undefined for a legacy or malformed row. */
export function parseStoredRouteSelection(
  stored: unknown,
): StoredRouteSummary["selection"] | undefined {
  if (typeof stored !== "object" || stored === null) return undefined;
  const selection = (stored as { selection?: unknown }).selection;
  if (typeof selection !== "object" || selection === null) return undefined;
  const revisionId = (selection as { revisionId?: unknown }).revisionId;
  const position = (selection as { position?: unknown }).position;
  const fingerprint = (selection as { fingerprint?: unknown }).fingerprint;
  if (revisionId !== null && typeof revisionId !== "string") return undefined;
  if (position !== "fallback" && (!Number.isInteger(position) || Number(position) < 0)) {
    return undefined;
  }
  if (typeof fingerprint !== "string" || fingerprint.length === 0) return undefined;
  return {
    revisionId: revisionId as string | null,
    position: position as number | "fallback",
    fingerprint,
  };
}

/** The route-match descriptor the facade re-matches on re-attach; undefined when
 * the row carries no summary (or a malformed one). */
export function parseStoredRouteSummary(stored: unknown): InboundConversation | undefined {
  if (typeof stored !== "object" || stored === null) return undefined;
  const match = (stored as { match?: unknown }).match;
  if (typeof match !== "object" || match === null) return undefined;
  const kind = (match as { kind?: unknown }).kind;
  const id = (match as { id?: unknown }).id;
  if (typeof kind !== "string" || typeof id !== "string") return undefined;
  return { kind: kind as InboundConversationDetail["kind"], id };
}

function rootKind(kind: InboundConversationDetail["kind"]): "dm" | "channel" | "group" {
  if (kind === "thread") return "channel";
  if (kind === "topic") return "group";
  return kind;
}

/** Raised when a route targets a workflow (out of scope for the bindings plane). */
export class ChannelWorkflowTargetError extends Error {
  constructor(workflow: string) {
    super(`route targets workflow ${workflow}; the bindings plane drives agent routes only`);
    this.name = "ChannelWorkflowTargetError";
  }
}

class ChannelConfigurationDeniedError extends Error {}
