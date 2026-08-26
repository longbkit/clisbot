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
import { randomUUID } from "node:crypto";
import { ChannelThreadBindingConflictError, type ChannelStore } from "../../db/channels.js";
import type {
  ChannelControlPlane,
  CompiledChannelAccount,
  CompiledRoute,
  EffectiveDefaults,
} from "../config/compile.js";
import type { DaemonConnection } from "../daemon/client.js";
import { mayTrigger, type InboundConversation } from "../policy.js";
import type {
  InboundConversationDetail,
  InboundMessage,
  InboundOutcome,
  P0ChannelName,
  PlaneClock,
  PlaneLogger,
} from "../plane/types.js";

/** The durable thread key (conversation + native thread id) a binding is keyed by. */
export interface ThreadKey {
  conversationId: string;
  externalThreadId: string | null;
}

/**
 * Derive the thread key a message binds to, per `binding.key` (§4.3.4).
 * `thread`: the native thread/topic is the unit — conversation + thread id (a
 * top-level channel message has no thread id and falls to the conversation
 * level, matching every channel's native "no thread = channel session" rule).
 * `channel` / `dm`: the whole conversation is one session; threads collapse.
 */
export function deriveBindingKey(
  conversation: InboundConversationDetail,
  bindingKey: EffectiveDefaults["bindingKey"],
): ThreadKey {
  const externalThreadId = bindingKey === "thread" ? conversation.threadId : null;
  return { conversationId: conversation.rootConversationId, externalThreadId };
}

/** The marker the plane stamps on a created agent so orphan recovery can match it. */
export function executionMarker(pendingExecutionId: string): string {
  return `clisbot-channel:${pendingExecutionId}`;
}

interface BindingEngineContext {
  organizationId: string;
  controlPlane: ChannelControlPlane;
  logger: PlaneLogger;
  clock: PlaneClock;
  store: ChannelStore;
  daemon: DaemonConnection;
  /** Resolve a route's agent target into a `create_agent_request` config. */
  resolveAgentSpec: (
    target: Extract<CompiledRoute["target"], { kind: "agent" }>,
  ) => import("../daemon/types.js").CreateAgentConfig;
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

  /**
   * The one inbound decision: admit, create, or steer. `account` + `route` are
   * the resolved route (the facade matches it); admission and the binding
   * lookup happen here, then the create or steer is driven on the daemon.
   */
  async bindOrSteer(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
  ): Promise<InboundOutcome> {
    const key = deriveBindingKey(message.conversation, route.defaults.bindingKey);
    const binding = await this.context.store.findThreadBinding(
      this.context.organizationId,
      account.accountId,
      key.conversationId,
      key.externalThreadId,
    );
    if (binding === undefined) return this.firstMention(message, account, route, key);
    if (binding.status === "pending") {
      return this.recoverPending(message, account, route, key, binding.pendingExecutionId);
    }
    if (binding.status === "abandoned") {
      // Abandonment is an explicit operator act (the plane never abandons);
      // the key is permanently held, so steering back needs operator recovery.
      return { kind: "ignored", reason: "thread is abandoned; operator recovery required" };
    }
    if (binding.agentId === null) {
      return { kind: "ignored", reason: "thread binding has no agent; operator recovery required" };
    }
    return this.followUp(message, account, route, binding.agentId);
  }

  /**
   * Orphan recovery (plan §10): scan the org's pending markers against
   * `fetch_agents`; a marker whose agent survived (matched by the marker
   * title) is re-bound instead of re-created. A marker with no surviving agent
   * is left pending — the create may have timed out rather than failed, so a
   * later inbound (or a later restart) re-checks it.
   */
  async recoverOrphans(): Promise<{ rebound: number; leftPending: number }> {
    const pending = await this.context.store.listPendingThreadBindings(this.context.organizationId);
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
        conversationId: marker.conversationId,
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
  ): Promise<InboundOutcome> {
    const defaults = route.defaults;
    if (defaults.requireMention && !message.mentionedBot) {
      return { kind: "ignored", reason: "not mentioned; requireMention is on" };
    }
    if (!mayTrigger(message.senderIdentity, this.context.controlPlane, account, route)) {
      return { kind: "ignored", reason: "sender may not trigger this route" };
    }
    const executionId = randomUUID();
    try {
      await this.context.store.recordPendingThreadBinding({
        organizationId: this.context.organizationId,
        channel: account.channel as P0ChannelName,
        accountId: account.accountId,
        conversationId: key.conversationId,
        externalThreadId: key.externalThreadId,
        pendingExecutionId: executionId,
        initiator: message.senderIdentity,
        route: bindingSummary(route, message.conversation),
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
        key.conversationId,
        key.externalThreadId,
      );
      if (existing?.status === "pending") {
        return this.recoverPending(message, account, route, key, existing.pendingExecutionId);
      }
      throw error;
    }
    let created;
    try {
      created = await this.createAgent(route, executionId, message.text);
    } catch (error) {
      // Leave the marker pending: the create may have timed out rather than
      // failed, so a later inbound (or restart) can rebind the surviving
      // agent. Never re-create here — the marker is the idempotency.
      this.context.logger.warn("agent create failed; the thread marker stays pending", {
        accountId: account.accountId,
        executionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { kind: "ignored", reason: "agent create in progress; try again shortly" };
    }
    await this.context.store.resolvePendingThreadBinding({
      organizationId: this.context.organizationId,
      accountId: account.accountId,
      conversationId: key.conversationId,
      externalThreadId: key.externalThreadId,
      agentId: created.agentId,
      resolvedAt: new Date(),
    });
    this.markActive(created.agentId);
    this.context.logger.info?.("thread bound to a new agent session", {
      accountId: account.accountId,
      agentId: created.agentId,
    });
    return { kind: "bound", agentId: created.agentId, newSession: true };
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
    if (!mayTrigger(message.senderIdentity, this.context.controlPlane, account, route)) {
      return { kind: "ignored", reason: "sender may not trigger this route" };
    }
    const executionId = pendingExecutionId ?? "";
    const agents = await this.context.daemon.listAgents();
    const surviving = agents.find((agent) => agent.title === executionMarker(executionId));
    if (surviving === undefined) {
      return { kind: "ignored", reason: "agent create in progress; try again shortly" };
    }
    await this.context.store.resolvePendingThreadBinding({
      organizationId: this.context.organizationId,
      accountId: account.accountId,
      conversationId: key.conversationId,
      externalThreadId: key.externalThreadId,
      agentId: surviving.id,
      resolvedAt: new Date(),
    });
    this.markActive(surviving.id);
    this.context.logger.info?.("inbound re-bound a pending marker", {
      accountId: account.accountId,
      agentId: surviving.id,
    });
    return { kind: "bound", agentId: surviving.id, newSession: false };
  }

  /** A bound thread: admit the follow-up and steer the existing session. */
  private async followUp(
    message: InboundMessage,
    account: CompiledChannelAccount,
    route: CompiledRoute,
    agentId: string,
  ): Promise<InboundOutcome> {
    const admission = admitFollowUp(message, route.defaults, this.isIdle(agentId, route.defaults));
    if (!admission.allowed) {
      return { kind: "ignored", reason: admission.reason ?? "follow-up not admitted" };
    }
    if (!mayTrigger(message.senderIdentity, this.context.controlPlane, account, route)) {
      return { kind: "ignored", reason: "sender may not trigger this route" };
    }
    await this.context.daemon.sendAgentMessage(agentId, message.text, { steer: true });
    this.markActive(agentId);
    return { kind: "steered", agentId };
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

  /**
   * Issue the trusted `create_agent_request` with the route's agent target,
   * then deliver the first channel message as the session's first prompt (the
   * bot is created idle, implementation doc §2.1 — the mention is what starts
   * the turn).
   */
  private async createAgent(
    route: CompiledRoute,
    executionId: string,
    firstPrompt: string,
  ): Promise<{ agentId: string }> {
    const target = route.target;
    if (target.kind !== "agent") {
      throw new ChannelWorkflowTargetError(target.workflow);
    }
    const config = this.context.resolveAgentSpec(target);
    const created = await this.context.daemon.createAgent(config, {
      title: executionMarker(executionId),
    });
    await this.context.daemon.sendAgentMessage(created.agentId, firstPrompt, { steer: false });
    return { agentId: created.agentId };
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
    return { allowed: false, reason: "route requires a mention for every message" };
  }
  if (idle) return { allowed: false, reason: "session idled out; mention the bot to resume" };
  return { allowed: true };
}

/**
 * The compact route summary stored on the binding row (resume without
 * re-compile). It stores the original route-match descriptor so the facade can
 * re-derive the live route on re-attach — routes are live (a config edit is
 * picked up from the next message), so this is the match key, not a pinned rule
 * set. The other leaves are a human-readable reference, not a decision input.
 */
export interface StoredRouteSummary {
  /** The original route-match descriptor (`kind` + native id). */
  match: { kind: InboundConversationDetail["kind"]; id: string };
  target: CompiledRoute["target"];
  bindingKey: EffectiveDefaults["bindingKey"];
  replyAnchor: EffectiveDefaults["replyAnchor"];
}

export function bindingSummary(
  route: CompiledRoute,
  conversation: InboundConversationDetail,
): StoredRouteSummary {
  // Store the MATCHED-LEVEL descriptor: a thread/topic stores its own
  // (re-attach re-matches at thread level, not root); a root-level message
  // stores the root (its `id` equals `rootConversationId`). This mirrors the
  // facade's two-pass match (execution.ts `resolveRoute`).
  const match =
    conversation.threadId !== null
      ? { kind: conversation.kind, id: conversation.id }
      : { kind: conversation.kind, id: conversation.rootConversationId };
  return {
    match,
    target: route.target,
    bindingKey: route.defaults.bindingKey,
    replyAnchor: route.defaults.replyAnchor,
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

/** Raised when a route targets a workflow (out of scope for the bindings plane). */
export class ChannelWorkflowTargetError extends Error {
  constructor(workflow: string) {
    super(`route targets workflow ${workflow}; the bindings plane drives agent routes only`);
    this.name = "ChannelWorkflowTargetError";
  }
}
