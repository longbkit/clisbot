// Tool approval over the channel (plan §4-S6): the same stream consumer the
// relay rides (`permission_requested` is a stream event, not a second socket)
// hands each request to this engine. One decision path: classify the tool class
// -> the route's first-match rule decides auto-allow / auto-deny / prompt.
// Auto cases respond on the daemon immediately, attributed to policy; a prompt
// posts an in-thread text command (`approve <id>` / `deny <id>`) and the
// responder's answer is re-authorized at dispatch — the SECOND authority check
// (the first ran on the inbound message as `mayTrigger`). An approver without
// the class privilege is inert: zero side effect, the request stays open. The
// approval-required posture (plan S10: routes may relax per class, never the
// posture) is asserted at plane start for every route.
import type {
  ChannelControlPlane,
  CompiledChannelAccount,
  CompiledFallback,
  CompiledRoute,
} from "../config/compile.js";
import type { AgentPermissionRequest, AgentPermissionResponse } from "../daemon/types.js";
import type { DaemonConnection } from "../daemon/client.js";
import type { ChannelStore } from "../../db/channels.js";
import {
  approvalDecisionFor,
  assertApprovalRequiredPosture,
  classifyToolClass,
  mayApprove,
  type ApproverCheck,
} from "../policy.js";
import { replyLocationFor } from "../relay/index.js";
import type { PlaneClock, PlaneLogger, PostFn, StreamContext } from "../plane/types.js";

/** The two P0 commands a channel can answer a prompt with (text + command). */
export type ApprovalCommand =
  | { decision: "allow"; requestId: string }
  | { decision: "deny"; requestId: string };

/** Parse `<approve|deny> <requestId>`; null for any other text. */
export function parseApprovalCommand(text: string): ApprovalCommand | null {
  const match = /^\s*(approve|deny)\s+([A-Za-z0-9][A-Za-z0-9._-]*)\s*$/iu.exec(text);
  if (match === null) return null;
  const [decision, requestId] = [match[1], match[2]];
  if (decision === undefined || requestId === undefined) return null;
  return decision === "approve"
    ? { decision: "allow", requestId }
    : { decision: "deny", requestId };
}

/** One in-thread prompt awaiting a responder's answer. */
export interface OpenPrompt {
  context: StreamContext;
  request: AgentPermissionRequest;
}

interface ApprovalEngineContext {
  organizationId: string;
  controlPlane: ChannelControlPlane;
  logger: PlaneLogger;
  clock: PlaneClock;
  store: ChannelStore;
  daemon: DaemonConnection;
  post: PostFn;
}

/**
 * Drives approval dispatch + prompts. Constructed at plane start. The open
 * prompts are in-memory: the durable half (the binding + the ledger's posted
 * prompt row) is the store's, so a prompt lost to a Hub restart is re-asked by
 * the daemon's next `permission_requested` for the same open request — and the
 * ledger row already recorded makes the re-post a no-op (record-before-post).
 */
export class ApprovalEngine {
  private readonly context: ApprovalEngineContext;
  private readonly streams = new Map<string, StreamContext>();
  private readonly openPrompts = new Map<string, OpenPrompt>();

  constructor(context: ApprovalEngineContext) {
    this.context = context;
  }

  /** Register an agent's stream context (the prompt + decision lookup key). */
  bindStream(context: StreamContext): void {
    this.streams.set(context.agentId, context);
  }

  /** Drop an agent's stream state (plane stop / detach). */
  detach(agentId: string): void {
    this.streams.delete(agentId);
  }

  /**
   * Handle one `permission_requested` from the shared stream path: classify,
   * decide, and either auto-respond on the daemon or post the in-thread prompt.
   */
  async handlePermissionRequest(agentId: string, request: AgentPermissionRequest): Promise<void> {
    const context = this.streams.get(agentId);
    if (context === undefined) {
      // No context attached for this agent (a stream the plane never bound):
      // stay out of the decision rather than guess a route.
      this.context.logger.warn("permission_requested for an unbound agent; not deciding", {
        agentId,
        requestId: request.id,
      });
      return;
    }
    const toolClass = classifyToolClass(request);
    const decision = approvalDecisionFor(toolClass, context.route);
    if (decision.mode === "auto-allow") {
      await this.respond(agentId, request.id, { behavior: "allow" });
      this.context.logger.info?.("approval auto-allowed by route rule", {
        agentId,
        requestId: request.id,
      });
      return;
    }
    if (decision.mode === "auto-deny") {
      await this.respond(agentId, request.id, {
        behavior: "deny",
        message: "refused by the channel approval policy",
      });
      this.context.logger.info?.("approval auto-denied by route rule", {
        agentId,
        requestId: request.id,
      });
      return;
    }
    await this.postPrompt(context, request, decision.initiatorOnly);
  }

  /** A `permission_resolved` arriving from the wire (answered in a Paseo
   * client): the in-thread prompt is answered, so drop it. */
  onPermissionResolved(agentId: string, requestId: string): void {
    this.openPrompts.delete(this.promptKey(agentId, requestId));
  }

  /**
   * The approval exit: answer a prompted request from the channel. The second
   * authority check (`mayApprove`) runs HERE, at dispatch, against the current
   * rule set — a revoked role is live from this message, and a responder
   * without the class privilege is inert (the request stays open).
   */
  async answerFromChannel(
    agentId: string,
    responderIdentity: string,
    command: ApprovalCommand,
  ): Promise<ApproverCheck & { answered: boolean }> {
    const prompt = this.openPrompts.get(this.promptKey(agentId, command.requestId));
    if (prompt === undefined) {
      // Unknown request id (or the prompt was already answered elsewhere): the
      // responder's message is inert, and nothing is posted to the daemon.
      return { allowed: false, answered: false, reason: "class-not-approved" };
    }
    const { context, request } = prompt;
    const check = mayApprove(
      responderIdentity,
      classifyToolClass(request),
      context.initiator,
      this.context.controlPlane,
      context.account,
      context.route,
    );
    if (!check.allowed) {
      this.context.logger.info?.("approval answer refused; request stays open", {
        agentId,
        requestId: command.requestId,
        reason: check.reason,
      });
      return { ...check, answered: false };
    }
    const response: AgentPermissionResponse =
      command.decision === "allow"
        ? { behavior: "allow" }
        : { behavior: "deny", message: "denied in the channel thread" };
    await this.respond(agentId, command.requestId, response);
    this.openPrompts.delete(this.promptKey(agentId, command.requestId));
    this.context.logger.info?.("approval answered in the channel thread", {
      agentId,
      requestId: command.requestId,
      decision: command.decision,
      responder: responderIdentity,
    });
    return { ...check, answered: true };
  }

  // --- Sub-decisions -------------------------------------------------------

  private async postPrompt(
    context: StreamContext,
    request: AgentPermissionRequest,
    initiatorOnly: boolean,
  ): Promise<void> {
    const eventTurnId = `approval:${request.id}`;
    const recorded = await this.context.store.recordDelivery({
      organizationId: this.context.organizationId,
      channel: context.channel,
      accountId: context.accountId,
      conversationId: context.conversationId,
      externalThreadId: context.externalThreadId,
      eventTurnId,
      sequence: 0,
    });
    if (recorded.created) {
      const location = replyLocationFor(context);
      const result = await this.context.post({
        channel: context.channel,
        accountId: context.accountId,
        to: location.to,
        ...(location.threadId !== undefined ? { threadId: location.threadId } : {}),
        text: promptText(request, initiatorOnly),
      });
      if (result.ok) {
        await this.context.store.confirmDelivery({
          organizationId: this.context.organizationId,
          accountId: context.accountId,
          conversationId: context.conversationId,
          externalThreadId: context.externalThreadId,
          eventTurnId,
          sequence: 0,
          nativeMessageId: result.nativeMessageId ?? "",
          postedAt: new Date(),
        });
      } else {
        await this.context.store.failDelivery({
          organizationId: this.context.organizationId,
          accountId: context.accountId,
          conversationId: context.conversationId,
          externalThreadId: context.externalThreadId,
          eventTurnId,
          sequence: 0,
          failureReason: result.error ?? "channel post failed",
        });
        this.context.logger.warn("approval prompt post failed; the request stays open", {
          agentId: context.agentId,
          requestId: request.id,
          error: result.error,
        });
        return; // not posted: leave no open prompt to answer
      }
    }
    // created (posted or just posted) or replayed (posted earlier): track it so
    // the responder's command can be re-authorized and dispatched.
    this.openPrompts.set(this.promptKey(context.agentId, request.id), { context, request });
  }

  private async respond(agentId: string, requestId: string, response: AgentPermissionResponse) {
    await this.context.daemon.respondToAgentPermission(agentId, requestId, response);
  }

  private promptKey(agentId: string, requestId: string): string {
    return `${agentId}:${requestId}`;
  }
}

// --- Posture + prompt text ------------------------------------------------------

/**
 * The S10 invariant at plane start: every route of every account keeps the
 * approval-required posture (no rule set auto-allows every tool class). A
 * catch-all fallback that targets an agent is a route too and is checked the
 * same way. Propagates policy's `ApprovalPostureError` naming the offender.
 */
export function assertChannelPosture(accounts: readonly CompiledChannelAccount[]): void {
  for (const account of accounts) {
    for (const route of account.routes) {
      assertApprovalRequiredPosture(route);
    }
    const fallback = account.fallback;
    if (
      fallback.deny === false &&
      fallback.target !== undefined &&
      fallback.defaults !== undefined
    ) {
      assertApprovalRequiredPosture(catchAllRoute(fallback));
    }
  }
}

/** The catch-all fallback rendered as the route the posture check decides on. */
export function catchAllRoute(fallback: CompiledFallback): CompiledRoute {
  const target = fallback.target;
  return {
    match: { kind: "channel", ids: [] },
    target: target ?? { kind: "workflow", workflow: "none" },
    defaultRoles: fallback.defaultRoles ?? [],
    assignments: fallback.assignments ?? [],
    defaults: fallback.defaults ?? accountlessDefaults(),
    approval: fallback.approval ?? [],
  };
}

/** The in-thread prompt text (P0: text + command, no native card). */
export function promptText(request: AgentPermissionRequest, initiatorOnly: boolean): string {
  const lines = [
    `The agent is asking for permission to use **${request.name}**.`,
    ...(request.description !== undefined ? [request.description] : []),
    `Reply with \`approve ${request.id}\` to allow it, or \`deny ${request.id}\` to refuse.`,
    ...(initiatorOnly
      ? ["Only the person who started this thread can answer."]
      : ["Anyone with approval rights for this tool class can answer."]),
  ];
  return lines.join("\n");
}

// The catch-all fallback synthesized without an account still needs a
// well-formed defaults block for the posture check.
function accountlessDefaults() {
  return {
    requireMention: true,
    followUp: { mode: "auto" as const, ttlMinutes: 60 },
    bindingKey: "thread" as const,
    replyAnchor: "thread" as const,
    sync: {
      finalAnswers: true,
      progress: false,
      toolCalls: false,
      threadLink: "final-only" as const,
    },
  };
}
