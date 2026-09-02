// Tool approval over the channel (plan §4-S6): the same stream consumer the
// relay rides (`permission_requested` is a stream event, not a second socket)
// hands each request to this engine. One decision path: classify the tool class
// -> the route's first-match rule decides auto-allow / auto-deny / prompt.
// Auto cases respond on the daemon immediately, attributed to policy; a prompt
// posts in-thread (text + command, or the native card when
// `transport.inlineButtons` admits it — card.ts) and the responder's answer is
// re-authorized at dispatch — the SECOND authority check (the first ran on the
// inbound message as `mayTrigger`). An approver without the class privilege is
// inert: zero side effect, the request stays open. The approval-required
// posture (plan S10: routes may relax per class, never the posture) is
// asserted at plane start for every route.
//
// EXACTLY-ONCE (2026-08-27 card decision): a prompt resolves to exactly one
// `agent_permission_response` no matter how many answer paths race — card
// click, typed command, and a paired Paseo client answer all land on this
// engine's open-prompt entry. The entry carries a `resolved` flag set the
// moment ANY path dispatches (or the wire reports a client resolution); every
// later path finds the flag and is an inert no-op. The daemon's own
// in-flight dedupe is the backstop, but the hub guarantees one frame.
import type {
  ChannelControlPlane,
  CompiledChannelAccount,
  CompiledFallback,
  CompiledRoute,
} from "../config/compile.js";
import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
} from "../daemon/types.js";
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
import type {
  OutboundPostResult,
  PlaneClock,
  PlaneLogger,
  PostFn,
  StreamContext,
  UpdateFn,
} from "../plane/types.js";
import {
  buildSlackCardBlocks,
  buildTelegramReplyKeyboard,
  cardIdFor,
  decidedPromptText,
  inlineButtonsAllowedFor,
  isInlineButtonsMode,
  parseCardValue,
  promptSurfaceKind,
  promptText,
  questionInfoFromRequest,
  resolveQuestionAnswer,
  shortIdOf,
  type QuestionInfo,
} from "./card.js";

export { decidedPromptText, promptText } from "./card.js";

/** The command a channel can answer a prompt with (shared parser + "latest"
 * target — `command.ts`): `approve|deny [id] [answer…]`, with an optional
 * leading slash and a leading @bot mention (Slack + Telegram friendly). */
export type { ApprovalCommand } from "./command.js";
export { parseApprovalCommand, resolveApprovalTarget } from "./command.js";
import type { ApprovalCommand } from "./command.js";

/** The card's in-place-update location (native message id + conversation). */
interface PromptCardLocation {
  to: string;
  threadId?: string;
  externalMessageId: string;
}

/** One in-thread prompt awaiting a responder's answer. `resolved` is the
 * exactly-once latch: set by the first dispatching path (or the wire's client
 * resolution) and read by every later one. */
export interface OpenPrompt {
  context: StreamContext;
  request: AgentPermissionRequest;
  /** The question shape (E5); undefined for tool-permission prompts. */
  questions?: QuestionInfo[];
  /** Set when the posted prompt carried native interactive markup. */
  cardPosted: boolean;
  /** Where the posted card lives (in-place update target); undefined when the
   * prompt was posted text-only or the post returned no message id. */
  cardLocation?: PromptCardLocation;
  /** The exactly-once latch. */
  resolved: boolean;
}

interface ApprovalEngineContext {
  organizationId: string;
  controlPlane: ChannelControlPlane;
  logger: PlaneLogger;
  clock: PlaneClock;
  store: ChannelStore;
  daemon: DaemonConnection;
  post: PostFn;
  /** The in-place update adapter (the card's decided state); absent = no
   * in-place update (the card goes stale, the resolution is unaffected). */
  update?: UpdateFn;
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
    for (const [key, prompt] of this.openPrompts) {
      if (prompt.context.agentId === agentId) this.openPrompts.delete(key);
    }
  }

  /**
   * Handle one `permission_requested` from the shared stream path: classify,
   * decide, and either auto-respond on the daemon or post the in-thread prompt.
   */
  async handlePermissionRequest(
    agentId: string,
    request: AgentPermissionRequest,
  ): Promise<void> {
    const context = this.streams.get(agentId);
    if (context === undefined) {
      // No context attached for this agent (a stream the plane never bound):
      // stay out of the decision rather than guess a route.
      this.context.logger.warn(
        "permission_requested for an unbound agent; not deciding",
        {
          agentId,
          requestId: request.id,
        },
      );
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
   * client): the prompt is answered EXTERNALLY — latch it resolved so a racing
   * channel-side answer (card click / typed command in flight) is an inert
   * no-op, and drop it. */
  onPermissionResolved(agentId: string, requestId: string): void {
    const prompt = this.openPrompts.get(this.promptKey(agentId, requestId));
    if (prompt !== undefined) prompt.resolved = true;
    this.openPrompts.delete(this.promptKey(agentId, requestId));
  }

  /**
   * The approval exit: answer a prompted request from the channel. The second
   * authority check (`mayApprove`) runs HERE, at dispatch, against the current
   * rule set — a revoked role is live from this message, and a responder
   * without the class privilege is inert (the request stays open). The
   * exactly-once latch runs FIRST: a prompt that already resolved (another
   * path won the race) is inert — zero side effect, zero daemon frame.
   *
   * Hard-limit exception (~63 lines > 50): this IS the exactly-once core —
   * lookup, latch read, authority check, build, latch write, dispatch,
   * in-place update, in one linear flow; splitting it would scatter the
   * race semantics across helpers.
   */
  async answerFromChannel(
    agentId: string,
    responderIdentity: string,
    command: ApprovalCommand & { requestId: string },
    responderName?: string,
  ): Promise<ApproverCheck & { answered: boolean; stale?: boolean }> {
    // The caller resolves the "latest" target first (`resolveOpenPrompt`);
    // the command that reaches here always names an open request id.
    const { requestId } = command;
    const prompt = this.openPrompts.get(this.promptKey(agentId, requestId));
    if (prompt === undefined) {
      // Unknown request id, or a prompt already answered elsewhere (latched +
      // deleted, or the hub restarted since it was posted): the responder's
      // message is inert, and nothing is posted to the daemon. The reason is
      // NOT a privilege verdict — the prompt is simply not open.
      return { allowed: false, answered: false, reason: "prompt-not-open" };
    }
    if (prompt.resolved) {
      // A later path lost the race (card click after the typed command, or a
      // client answer in flight): exactly-once — the second response is an
      // inert no-op.
      this.context.logger.info?.(
        "approval answer ignored (prompt already resolved)",
        {
          agentId,
          requestId: command.requestId,
          responder: responderIdentity,
        },
      );
      return { allowed: false, answered: false, reason: "ok", stale: true };
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
      this.context.logger.info?.(
        "approval answer refused; request stays open",
        {
          agentId,
          requestId: command.requestId,
          reason: check.reason,
        },
      );
      return { ...check, answered: false };
    }
    const response = this.buildResponse(prompt, command);
    if (response === null) {
      // A question prompt answered without an actionable answer (bare
      // `approve <id>`, bare "Other"): inert, the prompt stays open.
      this.context.logger.info?.(
        "approval answer ignored (no actionable answer)",
        {
          agentId,
          requestId: command.requestId,
          responder: responderIdentity,
        },
      );
      return { ...check, answered: false, stale: true };
    }
    // Latch BEFORE dispatch: a concurrent path that reads the entry between
    // here and the daemon call sees resolved and stays inert.
    prompt.resolved = true;
    await this.respond(agentId, command.requestId, response);
    this.openPrompts.delete(this.promptKey(agentId, command.requestId));
    this.context.logger.info?.("approval answered in the channel thread", {
      agentId,
      requestId: command.requestId,
      decision: command.decision,
      responder: responderIdentity,
    });
    await this.updateDecidedCard(
      prompt,
      responderIdentity,
      command,
      response,
      responderName,
    );
    return { ...check, answered: true };
  }

  // --- Sub-decisions -------------------------------------------------------

  /** Build the daemon response for a channel answer. Null when a question
   * prompt's answer is not actionable (the prompt stays open). */
  private buildResponse(
    prompt: OpenPrompt,
    command: ApprovalCommand,
  ): AgentPermissionResponse | null {
    if (command.decision === "deny") {
      return { behavior: "deny", message: "denied in the channel thread" };
    }
    if (prompt.questions === undefined) return { behavior: "allow" };
    const resolved = resolveQuestionAnswer(prompt.questions, command.answer);
    if (resolved === null) return null;
    // E5: `updatedInput.answers` keyed by the FULL question text — the daemon
    // normalizes via normalizeClaudeAskUserQuestionUpdatedInput (question text
    // first, header fallback). Do NOT re-key by header.
    return {
      behavior: "allow",
      updatedInput: { answers: { [resolved.questionText]: resolved.value } },
    };
  }

  /** The in-place card update (E1: "Approved by <sender>" / "Denied" /
   * "Answered: <option>") — fired only for a channel-side answer that
   * dispatched, against a prompt that actually posted a card. A failed update
   * never affects the resolution (the daemon frame is already gone). */
  private async updateDecidedCard(
    prompt: OpenPrompt,
    responderIdentity: string,
    command: ApprovalCommand,
    response: AgentPermissionResponse,
    responderName?: string,
  ): Promise<void> {
    const update = this.context.update;
    const location = prompt.cardLocation;
    if (update === undefined || location === undefined || !prompt.cardPosted)
      return;
    if (response.behavior !== "allow" && response.behavior !== "deny") return;
    // The Slack responder is tagged with the native `<@USERID>` mention —
    // Slack renders it as the person's name, so nobody reads a raw id. The
    // identity is `slack:<USERID>` (monitor.ts); anything else (a channel
    // without user ids) falls back to the display name / identity.
    const slackUserId =
      prompt.context.channel === "slack" &&
      /^slack:[A-Z][A-Z0-9]+$/u.test(responderIdentity)
        ? responderIdentity.slice("slack:".length)
        : undefined;
    const text = decidedPromptText({
      request: prompt.request,
      questions: prompt.questions,
      decision: response.behavior,
      ...(command.answer !== undefined ? { answer: command.answer } : {}),
      // Slack: the prepended `<@USERID>` mention IS the who — rendering the
      // display name again would be a duplicate. Other channels carry the
      // name (or the identity) in the text itself.
      responder:
        slackUserId !== undefined ? "" : (responderName ?? responderIdentity),
      cardMode: true,
    });
    const result = await update({
      channel: prompt.context.channel,
      accountId: prompt.context.accountId,
      to: location.to,
      ...(location.threadId !== undefined
        ? { threadId: location.threadId }
        : {}),
      externalMessageId: location.externalMessageId,
      text,
      clearCard: true,
      ...(slackUserId !== undefined
        ? { senderMention: `<@${slackUserId}>` }
        : {}),
    });
    if (!result.ok) {
      this.context.logger.warn("approval card in-place update failed", {
        agentId: prompt.context.agentId,
        requestId: prompt.request.id,
        error: result.error,
      });
    }
  }

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
      externalConversationId: context.externalConversationId,
      externalThreadId: context.externalThreadId,
      eventTurnId,
      sequence: 0,
    });
    if (!recorded.created) {
      // Replayed (posted earlier, Hub restarted): track it so the responder's
      // command can be re-authorized and dispatched. No card location survives
      // a restart (the native message id is gone with the in-memory post) —
      // the prompt stays text+command-answerable.
      this.openPrompts.set(this.promptKey(context.agentId, request.id), {
        context,
        request,
        cardPosted: false,
        resolved: false,
      });
      return;
    }
    const posted = await this.postPromptMessage(
      context,
      request,
      initiatorOnly,
      eventTurnId,
    );
    if (posted === undefined) return; // post failed: leave no open prompt to answer
    this.openPrompts.set(this.promptKey(context.agentId, request.id), {
      context,
      request,
      ...(posted.card.questions !== undefined
        ? { questions: posted.card.questions }
        : {}),
      cardPosted: posted.card.requested && (posted.result.cardPosted ?? true),
      ...(posted.cardLocation !== undefined
        ? { cardLocation: posted.cardLocation }
        : {}),
      resolved: false,
    });
  }

  /** The record→post→confirm/fail delivery-ledger triad. `undefined` = the
   * prompt never reached the channel (post failed, ledger row failed, no
   * open prompt may remain). */
  private async postPromptMessage(
    context: StreamContext,
    request: AgentPermissionRequest,
    initiatorOnly: boolean,
    eventTurnId: string,
  ): Promise<
    | {
        card: ReturnType<ApprovalEngine["cardFor"]>;
        result: OutboundPostResult;
        cardLocation: PromptCardLocation | undefined;
      }
    | undefined
  > {
    const location = replyLocationFor(context);
    const card = this.cardFor(context, request, initiatorOnly);
    const result = await this.context.post({
      channel: context.channel,
      accountId: context.accountId,
      to: location.to,
      ...(location.threadId !== undefined
        ? { threadId: location.threadId }
        : {}),
      text: promptText(request, initiatorOnly, card.questions),
      ...(card.blocks !== undefined ? { blocks: card.blocks } : {}),
      ...(card.replyMarkup !== undefined
        ? { replyMarkup: card.replyMarkup }
        : {}),
    });
    if (!result.ok) {
      await this.context.store.failDelivery({
        organizationId: this.context.organizationId,
        accountId: context.accountId,
        externalConversationId: context.externalConversationId,
        externalThreadId: context.externalThreadId,
        eventTurnId,
        sequence: 0,
        failureReason: result.error ?? "channel post failed",
      });
      this.context.logger.warn(
        "approval prompt post failed; the request stays open",
        {
          agentId: context.agentId,
          requestId: request.id,
          error: result.error,
        },
      );
      return undefined;
    }
    await this.context.store.confirmDelivery({
      organizationId: this.context.organizationId,
      accountId: context.accountId,
      externalConversationId: context.externalConversationId,
      externalThreadId: context.externalThreadId,
      eventTurnId,
      sequence: 0,
      externalMessageId: result.externalMessageId ?? "",
      postedAt: new Date(),
    });
    return { card, result, cardLocation: this.cardLocation(location, result) };
  }

  /** The native card payload for this prompt, gated by the account's
   * `transport.inlineButtons` at THIS surface (E1). Absent card fields = the
   * plain text + command post. */
  private cardFor(
    context: StreamContext,
    request: AgentPermissionRequest,
    initiatorOnly: boolean,
  ): {
    requested: boolean;
    questions?: QuestionInfo[];
    blocks?: Record<string, unknown>[];
    replyMarkup?: Record<string, unknown>;
  } {
    const questions = questionInfoFromRequest(request);
    const mode = context.account.transport["inlineButtons"];
    const allowed = inlineButtonsAllowedFor(
      isInlineButtonsMode(mode) ? mode : undefined,
      promptSurfaceKind(context.rootKind),
    );
    if (!allowed)
      return {
        requested: false,
        ...(questions !== undefined ? { questions } : {}),
      };
    if (context.channel === "slack") {
      return {
        requested: true,
        ...(questions !== undefined ? { questions } : {}),
        blocks: buildSlackCardBlocks(request, initiatorOnly, questions),
      };
    }
    return {
      requested: true,
      ...(questions !== undefined ? { questions } : {}),
      replyMarkup: buildTelegramReplyKeyboard(request, questions),
    };
  }

  /** The in-place-update target, when the post returned a native message id. */
  private cardLocation(
    location: { to: string; threadId?: string | undefined },
    result: OutboundPostResult,
  ): PromptCardLocation | undefined {
    const externalMessageId = result.externalMessageId;
    if (externalMessageId === undefined || externalMessageId === "")
      return undefined;
    return {
      to: location.to,
      ...(location.threadId !== undefined
        ? { threadId: location.threadId }
        : {}),
      externalMessageId,
    };
  }

  private async respond(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
  ) {
    await this.context.daemon.respondToAgentPermission(
      agentId,
      requestId,
      response,
    );
  }

  private promptKey(agentId: string, requestId: string): string {
    return `${agentId}:${requestId}`;
  }

  /** The newest open (unresolved) prompt for an agent, or the one named by
   * `requestId` when it is open. `requestId` undefined → the "latest" target.
   * Undefined when nothing open matches — the caller treats the command as
   * inert. Insertion order = prompt post order, so last = newest. */
  resolveOpenPrompt(
    agentId: string,
    requestId?: string,
  ): AgentPermissionRequest | undefined {
    if (requestId !== undefined) {
      const prompt = this.openPrompts.get(this.promptKey(agentId, requestId));
      if (prompt !== undefined && !prompt.resolved) return prompt.request;
      // Not the full id — try the prompt's short id, or any UNIQUE PREFIX
      // of the full id among this agent's open prompts.
      let prefixMatch: AgentPermissionRequest | undefined;
      for (const candidate of this.openPrompts.values()) {
        if (candidate.resolved || candidate.context.agentId !== agentId)
          continue;
        const matches =
          shortIdOf(candidate.request.id).toLowerCase() ===
            requestId.toLowerCase() ||
          candidate.request.id.startsWith(requestId);
        if (!matches) continue;
        if (
          prefixMatch !== undefined &&
          prefixMatch.id !== candidate.request.id
        )
          return undefined;
        prefixMatch = candidate.request;
      }
      return prefixMatch;
    }
    let newest: OpenPrompt | undefined;
    for (const prompt of this.openPrompts.values()) {
      if (prompt.context.agentId !== agentId || prompt.resolved) continue;
      newest = prompt;
    }
    return newest?.request;
  }

  /** The open prompts of one agent (newest last — the "latest" target's
   * candidate set). Used by the facade when a typed command's id is absent. */
  openPromptRequests(agentId: string): AgentPermissionRequest[] {
    const out: AgentPermissionRequest[] = [];
    for (const prompt of this.openPrompts.values()) {
      if (prompt.context.agentId !== agentId || prompt.resolved) continue;
      out.push(prompt.request);
    }
    return out;
  }
}

// --- Card-id passthrough -------------------------------------------------------

/** The card id a resolver input carries (card click / typed command). The
 * facade maps it back to the daemon's request id through the open prompts
 * (one card id ↔ one request id per agent). */
export { cardIdFor, parseCardValue };

// --- Posture + prompt text ------------------------------------------------------

/**
 * The S10 invariant at plane start: every route of every account keeps the
 * approval-required posture (no rule set auto-allows every tool class). A
 * catch-all fallback that targets an agent is a route too and is checked the
 * same way. Propagates policy's `ApprovalPostureError` naming the offender.
 */
export function assertChannelPosture(
  accounts: readonly CompiledChannelAccount[],
): void {
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

// The catch-all fallback synthesized without an account still needs a
// well-formed defaults block for the posture check.
function accountlessDefaults() {
  return {
    requireMention: true,
    followUp: { mode: "auto" as const, ttlMinutes: 60 },
    bindingKey: "thread" as const,
    replyAnchor: "thread" as const,
    outbound: { path: "relay" as const, template: null },
    sync: {
      finalAnswers: true,
      progress: {
        progressMessage: false,
        typingIndicator: false,
        messageReaction: "off",
      },
      toolCalls: false,
      threadLink: "final-only" as const,
      subagents: { finalAnswers: false, progress: false, toolCalls: false },
    },
  };
}
