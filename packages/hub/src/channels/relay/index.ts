// The outbound relay + delivery ledger (plan §4-S5, §4-S3 one-code-path). One
// consumer over the bound agents' `agent_stream` events: the relay mapper picks
// the event kinds a route's `sync` policy admits (final answers, throttled
// progress snapshots, tool-call lines — reasoning off at P0) and the delivery
// ledger records BEFORE every post, so a replayed stream event or a Hub restart
// can never double-post (`recordDelivery` → post → `confirmDelivery` /
// `failDelivery`; `created: false` skips the post). `permission_requested`
// flows through this same consumer to the approval engine — the relay and the
// approvals are two handlers on one stream path, never two consumers.
import type { ChannelStore } from "../../db/channels.js";
import type { AgentStreamTimelineItem } from "../daemon/types.js";
import type { RelayedStreamEvent } from "../plane/stream.js";
import type {
  PlaneClock,
  PlaneLogger,
  PostFn,
  SessionLinkRenderer,
  StreamContext,
} from "../plane/types.js";

/** The throttle window (ms) between progress snapshots when unset by deps. */
export const DEFAULT_PROGRESS_THROTTLE_MS = 30_000;

/** Where one relay post lands for a stream context (from `reply.anchor`). */
export function replyLocationFor(context: StreamContext): {
  to: string;
  threadId?: string | undefined;
} {
  // `thread`: the native thread the binding is keyed by (null = post at the
  // conversation root). `channel`: always the conversation root.
  const threadId =
    context.route.defaults.replyAnchor === "thread" ? context.externalThreadId : null;
  return {
    to: context.externalConversationId,
    ...(threadId !== null ? { threadId } : {}),
  };
}

interface TurnState {
  /** Accumulated `assistant_message` text, in arrival order. */
  assistant: string[];
  /** Clock time of the last posted progress snapshot (the throttle cursor). */
  lastProgressAt: number | null;
  /** Ledger sequence counter for this turn's relay posts, in order. */
  nextSequence: number;
  /** True once the turn closed (no further relay posts for it). */
  closed: boolean;
}

interface RelayContext {
  organizationId: string;
  logger: PlaneLogger;
  clock: PlaneClock;
  store: ChannelStore;
  post: PostFn;
  sessionLink?: SessionLinkRenderer | undefined;
  progressThrottleMs: number;
}

/** One agent's relay state: its stream context + the open turns. */
export interface RelayStream {
  context: StreamContext;
  turns: Map<string, TurnState>;
}

/**
 * The relay engine: owns the per-agent stream state and the record-before-post
 * delivery. Constructed once per plane; `attach` registers an agent and the
 * facade calls `dispatch` for every one of its stream events.
 */
export class RelayEngine {
  private readonly relay: RelayContext;
  private readonly streams = new Map<string, RelayStream>();

  constructor(relay: RelayContext) {
    this.relay = relay;
  }

  /** Register (or re-register after restart) an agent's stream context. */
  attach(context: StreamContext): RelayStream {
    const stream: RelayStream = { context, turns: new Map() };
    this.streams.set(context.agentId, stream);
    return stream;
  }

  /** The live stream for an agent, when attached. */
  streamFor(agentId: string): RelayStream | undefined {
    return this.streams.get(agentId);
  }

  /** Drop an agent's stream state (plane stop). */
  detach(agentId: string): void {
    this.streams.delete(agentId);
  }

  /**
   * Route one wire stream event, already narrowed to a relay-consumable shape by
   * the facade's single consumer (`plane/stream.ts`). Unattached agents are a
   * no-op; `turn_started` / `attention_required` / unknown never reach here.
   */
  async onStream(agentId: string, event: RelayedStreamEvent): Promise<void> {
    const stream = this.streams.get(agentId);
    if (stream === undefined) return;
    switch (event.kind) {
      case "timeline":
        await this.onTimeline(stream, event.item, event.turnId);
        return;
      case "turn_completed":
        await this.onTurnCompleted(stream, event.turnId);
        return;
      case "turn_closed":
        this.onTurnClosed(stream, event.turnId);
        return;
    }
  }

  // --- Event handlers ------------------------------------------------------

  /**
   * One timeline item. `assistant_message` accumulates toward the final answer;
   * a running tool call is a progress snapshot (throttled, `sync.progress`); a
   * terminal tool call is a tool-call line (`sync.toolCalls`). Reasoning is not
   * relayed at P0 (the plan's `reasoning` sync knob lands with P0.5 native
   * cards); todo/error/compaction/user_message are not relayed.
   */
  private async onTimeline(stream: RelayStream, item: AgentStreamTimelineItem, turnId: string) {
    const turn = this.turn(stream, turnId);
    if (turn.closed) return;
    const sync = stream.context.route.defaults.sync;
    switch (item.type) {
      case "assistant_message":
        if (item.text !== undefined && item.text.trim() !== "") {
          turn.assistant.push(item.text);
        }
        return;
      case "tool_call":
        await this.onToolCall(stream, turnId, turn, item, sync);
        return;
      case "reasoning":
      case "error":
      case "todo":
      case "compaction":
      case "user_message":
      default:
        return;
    }
  }

  private async onToolCall(
    stream: RelayStream,
    turnId: string,
    turn: TurnState,
    item: AgentStreamTimelineItem,
    sync: RelayStream["context"]["route"]["defaults"]["sync"],
  ): Promise<void> {
    if (item.status === "running") {
      if (!sync.progress || item.name === undefined) return;
      await this.postProgressSnapshot(stream, turnId, turn, `Running ${item.name}…`);
      return;
    }
    if (!isTerminalToolStatus(item.status)) return;
    if (!sync.toolCalls) return;
    await this.post(stream, turnId, turn, toolCallLine(item), false);
  }

  private async onTurnCompleted(stream: RelayStream, turnId: string) {
    const turn = this.turn(stream, turnId);
    turn.closed = true;
    const sync = stream.context.route.defaults.sync;
    if (!sync.finalAnswers) return;
    const finalText = joinAssistantText(turn.assistant);
    if (finalText === "") return;
    await this.post(stream, turnId, turn, finalText, true);
  }

  /** A turn that did not complete stops any further relay posts for it. */
  private onTurnClosed(stream: RelayStream, turnId: string): void {
    this.turn(stream, turnId).closed = true;
  }

  // --- Progress snapshots --------------------------------------------------

  /**
   * Post a progress snapshot when the throttle window has elapsed since the
   * last one; otherwise hold it — the next eligible event re-checks the clock.
   * A progress line and a tool-call line share the turn's sequence counter.
   */
  private async postProgressSnapshot(
    stream: RelayStream,
    turnId: string,
    turn: TurnState,
    line: string,
  ) {
    const now = this.relay.clock.now();
    const lastAt = turn.lastProgressAt;
    if (lastAt !== null && now - lastAt < this.relay.progressThrottleMs) return;
    await this.post(stream, turnId, turn, line, false);
    turn.lastProgressAt = this.relay.clock.now();
  }

  // --- Delivery (record-before-post) ----------------------------------------

  private async post(
    stream: RelayStream,
    turnId: string,
    turn: TurnState,
    text: string,
    finalAnswer: boolean,
  ) {
    const context = stream.context;
    const sync = context.route.defaults.sync;
    const eventTurnId = ledgerTurnId(context.agentId, turnId);
    // One post per recorded sequence, in order; the final answer is the turn's
    // last relay post.
    const sequence = turn.nextSequence;
    turn.nextSequence += 1;
    const fullText = appendThreadLink(
      text,
      sync.threadLink,
      finalAnswer,
      this.relay,
      context.agentId,
    );
    const recorded = await this.relay.store.recordDelivery({
      organizationId: this.relay.organizationId,
      channel: context.channel,
      accountId: context.accountId,
      externalConversationId: context.externalConversationId,
      externalThreadId: context.externalThreadId,
      eventTurnId,
      sequence,
    });
    if (!recorded.created) return; // replay/restart: already posted (or posted elsewhere)
    const location = replyLocationFor(context);
    const result = await this.relay.post({
      channel: context.channel,
      accountId: context.accountId,
      to: location.to,
      ...(location.threadId !== undefined ? { threadId: location.threadId } : {}),
      text: fullText,
    });
    if (result.ok) {
      await this.relay.store.confirmDelivery({
        organizationId: this.relay.organizationId,
        accountId: context.accountId,
        externalConversationId: context.externalConversationId,
        externalThreadId: context.externalThreadId,
        eventTurnId,
        sequence,
        externalMessageId: result.externalMessageId ?? "",
        postedAt: new Date(),
      });
      return;
    }
    await this.relay.store.failDelivery({
      organizationId: this.relay.organizationId,
      accountId: context.accountId,
      externalConversationId: context.externalConversationId,
      externalThreadId: context.externalThreadId,
      eventTurnId,
      sequence,
      failureReason: result.error ?? "channel post failed",
    });
    this.relay.logger.warn("relay post failed; the ledger row stays recoverable", {
      agentId: context.agentId,
      eventTurnId,
      sequence,
      error: result.error,
    });
  }

  private turn(stream: RelayStream, turnId: string): TurnState {
    let turn = stream.turns.get(turnId);
    if (turn === undefined) {
      turn = { assistant: [], lastProgressAt: null, nextSequence: 0, closed: false };
      stream.turns.set(turnId, turn);
    }
    return turn;
  }
}

// --- Mappers (pure) ----------------------------------------------------------

function joinAssistantText(parts: readonly string[]): string {
  return parts.join("\n\n").trim();
}

function isTerminalToolStatus(status: string | undefined): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

/** One tool-call line (`name: status`), gated by `sync.toolCalls`. */
function toolCallLine(item: AgentStreamTimelineItem): string {
  const name = item.name ?? item.type;
  const status = item.status ?? "completed";
  return `Tool ${name}: ${status}`;
}

/**
 * Append the back-link to the live session, per `sync.threadLink`. `full`: on
 * every relay post; `final-only`: on the final answer; `none` (or no
 * renderer): never.
 */
export function appendThreadLink(
  text: string,
  threadLink: "full" | "final-only" | "none",
  finalAnswer: boolean,
  relay: { sessionLink?: SessionLinkRenderer | undefined },
  agentId: string,
): string {
  if (threadLink === "none") return text;
  if (threadLink === "final-only" && !finalAnswer) return text;
  const renderer = relay.sessionLink;
  if (renderer === undefined) return text;
  const link = renderer(agentId);
  if (link === "") return text;
  return `${text}\n\n${link}`;
}

/** The ledger event-turn id: the agent + stream turn id (stable across replay). */
function ledgerTurnId(agentId: string, turnId: string): string {
  return `${agentId}:${turnId}`;
}
