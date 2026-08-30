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
import type { EffectiveDefaults } from "../config/compile.js";
import type { AgentStreamTimelineItem } from "../daemon/types.js";
import type { RelayedStreamEvent, SubagentStreamEvent } from "../plane/stream.js";
import {
  SLACK_THREAD_TS_PATTERN,
  type PlaneClock,
  type PlaneLogger,
  type PostFn,
  type SessionLinkRenderer,
  type StreamContext,
} from "../plane/types.js";
import type { ProcessingController } from "../plane/processing.js";

/**
 * The relay knobs of a scope: root gates on `sync`, subagents on
 * `sync.subagents`. `progress` is the group's TEXT leaf only — the typing
 * indicator and the reaction are turn-level surfaces driven from the turn
 * lifecycle, not per-item relay gates, so they never enter this type.
 */
type SyncKnobs = Pick<EffectiveDefaults["sync"], "finalAnswers" | "toolCalls"> & {
  progress: EffectiveDefaults["sync"]["progress"]["progressMessage"];
};

/** The throttle window (ms) between progress snapshots when unset by deps. */
export const DEFAULT_PROGRESS_THROTTLE_MS = 30_000;

/** The root scope's relay knobs: the `sync.progress` group's TEXT leaf is what
 * gates a relayed line, so the group collapses to `progress` here. The
 * indicator and the reaction are turn-level (plane/processing.ts), never per-item. */
function rootSyncKnobs(sync: EffectiveDefaults["sync"]): SyncKnobs {
  return {
    finalAnswers: sync.finalAnswers,
    progress: sync.progress.progressMessage,
    toolCalls: sync.toolCalls,
  };
}

/**
 * Where one relay post lands for a stream context (from `reply.anchor`).
 *
 * Both values follow the marker: the binding's persisted thread wins
 * (`binding.key: thread`, survives restarts), then the live trigger thread
 * (`binding.key: channel`, where the binding is collapsed to root), else the
 * conversation root. `thread` goes one step further: when the marker sat at
 * the conversation root, the reply mints a new thread by answering the marker
 * message itself (`thread_ts` = the marker's native `ts` — Slack has no
 * create-thread API; OpenClaw `replyToMode: all`). Minting is Slack-only, is
 * skipped for DMs (no thread level), and needs the marker's `ts` in native
 * shape (a restart re-attach carries none, so it never mints). Under
 * `binding.key: thread` a root marker already binds at its own minted thread
 * (`deriveBindingKey`'s marker rule), so this branch is the collapsed case
 * only (`binding.key: channel` / `dm`, where the binding carries no thread).
 */
export function replyLocationFor(context: StreamContext): {
  to: string;
  threadId?: string | undefined;
} {
  let threadId = context.externalThreadId ?? context.triggerThreadId ?? null;
  if (
    threadId === null &&
    context.route.defaults.replyAnchor === "thread" &&
    context.channel === "slack" &&
    context.rootKind !== "dm" &&
    context.triggerMessageId !== undefined &&
    SLACK_THREAD_TS_PATTERN.test(context.triggerMessageId)
  ) {
    threadId = context.triggerMessageId;
  }
  return {
    to: context.externalConversationId,
    ...(threadId !== null ? { threadId } : {}),
  };
}

interface TurnState {
  /**
   * The in-flight assistant message's text. A logical assistant message reaches
   * the relay as several coalesced `assistant_message` items sharing one
   * `messageId` (the daemon coalesces the stream on a 60ms window and flushes
   * early on terminal tool calls); the items of one message are concatenated
   * with `""` (never a newline) so the message is reassembled whole rather than
   * split by blank lines mid-word.
   */
  pendingAssistantText: string;
  /** The `messageId` of the in-flight assistant message (undefined = none open). */
  pendingAssistantMessageId: string | undefined;
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
  /** COMPAT(clisbot-control-plane): the turn-lifecycle surface owner, opened
   * by the inbound path (the plane accepted a message that will run a turn)
   * not by this relay. The relay only keeps it alive and releases it. Absent
   * = no surface. */
  processing?: ProcessingController | undefined;
}

/** One agent's relay state: its stream context, the subagent labels, and the
 * open scopes. Root turns are keyed by the stream `turnId`; subagent scopes by
 * their own id (their message/sequence state, separate from the root's). */
export interface RelayStream {
  context: StreamContext;
  /** Subagent display labels, keyed by subagentId (from the upsert frames). */
  subagentLabels: Map<string, string | null>;
  /** Open root + subagent scopes, keyed by the scope's turn key. */
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
    const stream: RelayStream = {
      context,
      subagentLabels: new Map(),
      turns: new Map(),
    };
    this.streams.set(context.agentId, stream);
    return stream;
  }

  /** The live stream for an agent, when attached. */
  streamFor(agentId: string): RelayStream | undefined {
    return this.streams.get(agentId);
  }

  /** Drop an agent's stream state (plane stop). Its surface goes with it. */
  detach(agentId: string): void {
    this.relay.processing?.closeAgent(agentId);
    this.streams.delete(agentId);
  }

  /**
   * Route one ROOT wire stream event, already narrowed to a relay-consumable
   * shape by the facade's single consumer (`plane/stream.ts`). Unattached
   * agents are a no-op; `attention_required` / unknown never reach here.
   */
  async onStream(agentId: string, event: RelayedStreamEvent): Promise<void> {
    const stream = this.streams.get(agentId);
    if (stream === undefined) return;
    switch (event.kind) {
      case "turn_started":
        // Nothing to raise: the surface was already opened when the plane
        // accepted the inbound that started this turn. Waiting for this event
        // is what made the indicator invisible — the prompt is sent before the
        // stream is subscribed, so a channel turn's own `turn_started` can
        // arrive before anyone is listening. It is still consumed so a
        // non-channel turn cannot be mistaken for a closed one.
        this.relay.processing?.touch(agentId);
        return;
      case "timeline":
        // Any stream event proves the turn is alive: push the TTL out.
        this.relay.processing?.touch(agentId);
        await this.onTimeline(
          stream,
          event.turnId,
          rootSyncKnobs(stream.context.route.defaults.sync),
          event.item,
        );
        return;
      case "turn_completed":
        this.relay.processing?.closeAgent(agentId);
        await this.onTurnCompleted(stream, event.turnId);
        return;
      case "turn_closed":
        this.relay.processing?.closeAgent(agentId);
        this.onTurnClosed(stream, event.turnId);
        return;
    }
  }

  /**
   * Route one subagent wire frame (`agent.provider_subagents.update`),
   * narrowed by the facade's single consumer. `upsert` remembers the label
   * only; `timeline` relays the subagent's items under the subagent's own
   * scope + ledger key; `remove` closes its in-flight state.
   */
  async onSubagentStream(event: SubagentStreamEvent): Promise<void> {
    const stream = this.streams.get(event.parentAgentId);
    if (stream === undefined) return;
    switch (event.kind) {
      case "upsert":
        if (event.label !== null) stream.subagentLabels.set(event.subagentId, event.label);
        return;
      case "timeline": {
        const key = this.subagentTurnKey(event.subagentId);
        await this.onTimeline(
          stream,
          key,
          stream.context.route.defaults.sync.subagents,
          event.item,
          this.subagentPrefix(stream, event.subagentId),
        );
        return;
      }
      case "remove": {
        // The subagent is done: close its in-flight scope so any pending
        // message is posted, and nothing more posts for it. `finalAnswer`
        // stays false: the session-link final post is the root turn's, never
        // a subagent's.
        const key = this.subagentTurnKey(event.subagentId);
        const turn = stream.turns.get(key);
        if (turn !== undefined) turn.closed = true;
        await this.postAssistantMessage(
          stream,
          key,
          stream.context.route.defaults.sync.subagents,
          this.subagentPrefix(stream, event.subagentId),
          false,
        );
        return;
      }
    }
  }

  // --- Event handlers ------------------------------------------------------

  /**
   * The subagent scope's turn key: `sub:<subagentId>`. The subagent id is a
   * per-spawn UUID, stable across wire replays, so root and subagent ledger
   * keys never collide and a replayed subagent scope dedupes against its own
   * earlier posts.
   */
  private subagentTurnKey(subagentId: string): string {
    return `sub:${subagentId}`;
  }

  /** The subagent post prefix (`▶ {label} (subagent):`), from the upsert label. */
  private subagentPrefix(stream: RelayStream, subagentId: string): string {
    const label = stream.subagentLabels.get(subagentId) ?? subagentId;
    return `▶ ${label} (subagent): `;
  }

  /**
   * One timeline item (root or subagent scope). `assistant_message` accumulates
   * toward the final answer; a running tool call is a progress snapshot
   * (throttled, `progress`); a terminal tool call is a tool-call line
   * (`toolCalls`). Reasoning is not relayed at P0 (the plan's `reasoning` sync
   * knob lands with P0.5 native cards); todo/error/compaction/user_message are
   * not relayed.
   *
   * Assistant text is relayed PER MESSAGE: one logical assistant message arrives
   * as several coalesced items sharing a `messageId` (the daemon coalesces the
   * stream and flushes early on terminal tool calls), so the items of one
   * message are concatenated into a single post. A new `messageId`, a tool call,
   * or the scope's completion closes the in-flight message — posting it keeps
   * the per-message posts ordered with the tool-call / progress lines by
   * sequence.
   */
  private async onTimeline(
    stream: RelayStream,
    key: string,
    sync: SyncKnobs,
    item: AgentStreamTimelineItem,
    prefix: string = "",
  ) {
    const turn = stream.turns.get(key);
    if (turn !== undefined && turn.closed) return;
    switch (item.type) {
      case "assistant_message":
        await this.onAssistantMessage(stream, key, sync, item, prefix);
        return;
      case "tool_call":
        // A tool call closes the in-flight assistant message (posted first, in
        // order; not the scope's final answer — the link/throttle semantics of
        // the final post stay on the scope-completion flush).
        await this.postAssistantMessage(stream, key, sync, prefix, false);
        await this.onToolCall(stream, key, sync, item, prefix);
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

  /**
   * One `assistant_message` item. Items sharing the in-flight `messageId` are
   * concatenated (with `""`, never a newline — the daemon's coalesce window
   * splits messages arbitrarily mid-word). A new `messageId` closes the
   * in-flight message (posted first, in order) and opens a fresh one. Items
   * without a `messageId` compare equal to one another, so an id-less stream
   * still accumulates as one message.
   */
  private async onAssistantMessage(
    stream: RelayStream,
    key: string,
    sync: SyncKnobs,
    item: AgentStreamTimelineItem,
    prefix: string,
  ): Promise<void> {
    if (item.text === undefined) return;
    const text = stripAssistantBoundary(item.text);
    if (text === "") return;
    const turn = this.turn(stream, key);
    const messageId = item.messageId;
    if (turn.pendingAssistantText !== "" && turn.pendingAssistantMessageId !== messageId) {
      await this.postAssistantMessage(stream, key, sync, prefix, false);
    }
    turn.pendingAssistantMessageId = messageId;
    turn.pendingAssistantText += text;
  }

  /**
   * Post the in-flight assistant message (if any non-empty text has accumulated
   * and the scope's `finalAnswers` admits it), then reset the accumulator.
   * No-op when there is nothing pending. `finalAnswer` marks the scope's last
   * post (the threadLink `final-only` target); the mid-scope close on a new
   * `messageId` / tool call / subagent remove posts the message but not as the
   * final answer.
   */
  private async postAssistantMessage(
    stream: RelayStream,
    key: string,
    sync: SyncKnobs,
    prefix: string,
    finalAnswer: boolean,
  ): Promise<void> {
    const turn = stream.turns.get(key);
    if (turn === undefined || turn.pendingAssistantText === "") return;
    const text = turn.pendingAssistantText;
    turn.pendingAssistantText = "";
    turn.pendingAssistantMessageId = undefined;
    if (!sync.finalAnswers) return;
    const caption = `${prefix}${text}`;
    // The caption posts verbatim: files leave through the explicit `send_file`
    // tool (channel-reply.ts), never through a text parse of the answer.
    await this.post(stream, key, turn, caption, finalAnswer);
  }

  private async onToolCall(
    stream: RelayStream,
    key: string,
    sync: SyncKnobs,
    item: AgentStreamTimelineItem,
    prefix: string,
  ): Promise<void> {
    const turn = this.turn(stream, key);
    if (item.status === "running") {
      if (!sync.progress || item.name === undefined) return;
      await this.postProgressSnapshot(stream, key, turn, `${prefix}Running ${item.name}…`);
      return;
    }
    if (!isTerminalToolStatus(item.status)) return;
    if (!sync.toolCalls) return;
    await this.post(stream, key, turn, `${prefix}${toolCallLine(item)}`, false);
  }

  private async onTurnCompleted(stream: RelayStream, turnId: string) {
    const turn = this.turn(stream, turnId);
    turn.closed = true;
    // Turn completion closes the last in-flight assistant message (the stream
    // gives no other "this message ended" signal for it), as the turn's final
    // answer (the threadLink `final-only` post).
    await this.postAssistantMessage(
      stream,
      turnId,
      rootSyncKnobs(stream.context.route.defaults.sync),
      "",
      true,
    );
  }

  /** A turn that did not complete stops any further relay posts for it. */
  private onTurnClosed(stream: RelayStream, turnId: string): void {
    this.turn(stream, turnId).closed = true;
  }

  // --- Progress snapshots --------------------------------------------------

  /**
   * Post a progress snapshot when the throttle window has elapsed since the
   * last one; otherwise hold it — the next eligible event re-checks the clock.
   * A progress line and a tool-call line share the scope's sequence counter.
   */
  private async postProgressSnapshot(
    stream: RelayStream,
    key: string,
    turn: TurnState,
    line: string,
  ) {
    const now = this.relay.clock.now();
    const lastAt = turn.lastProgressAt;
    if (lastAt !== null && now - lastAt < this.relay.progressThrottleMs) return;
    await this.post(stream, key, turn, line, false);
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
      turn = {
        pendingAssistantText: "",
        pendingAssistantMessageId: undefined,
        lastProgressAt: null,
        nextSequence: 0,
        closed: false,
      };
      stream.turns.set(turnId, turn);
    }
    return turn;
  }
}

// --- Mappers (pure) ----------------------------------------------------------

/**
 * The provider's assistant-message boundary marker (`---` between messages),
 * prepended by the Codex provider to the first delta of each new assistant
 * message. It is an app UI cue, not content: the daemon strips it only on the
 * app-client's reduce path, so the stream path (the relay) must strip it too.
 * Mirrors `ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN` (server
 * `providers/codex-app-server-agent.ts`).
 */
const ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN = "\n\n---\n\n";

/**
 * Strip the boundary marker from one assistant-message chunk. The marker only
 * ever prefixes a chunk (the provider prepends it to the first delta of a new
 * message), and at most once.
 */
function stripAssistantBoundary(text: string): string {
  if (!text.startsWith(ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN)) return text;
  let result = text.slice(ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN.length);
  while (result.startsWith(ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN)) {
    result = result.slice(ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN.length);
  }
  return result;
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

// Media is sent only through the Hub's explicit `send_file` MCP tool.
