// The outbound relay + delivery ledger (plan §4-S5, §4-S3 one-code-path). One
// consumer over the bound agents' `agent_stream` events: the relay mapper picks
// the event kinds a route's `sync` policy admits (final answers and tool
// activity — reasoning off at P0) and the delivery
// ledger records BEFORE every post, so a replayed stream event or a Hub restart
// can never double-post (`recordDelivery` → post → `confirmDelivery` /
// `failDelivery`; `created: false` skips the post). `permission_requested`
// flows through this same consumer to the approval engine — the relay and the
// approvals are two handlers on one stream path, never two consumers.
import type { ChannelStore } from "../../db/channels.js";
import { isHubFinishExecutionToolName } from "../../hub/protocol.js";
import { toolActivity, type EffectiveDefaults } from "../config/compile.js";
import type { AgentStreamTimelineItem } from "../daemon/types.js";
import type { RelayedStreamEvent, SubagentStreamEvent } from "../plane/stream.js";
import {
  type PlaneClock,
  type PlaneLogger,
  type PostFn,
  type SessionLinkRenderer,
  type StreamContext,
} from "../plane/types.js";
import type { ProcessingController } from "../plane/processing.js";
import { anchoredReplyThreadId } from "../reply-anchor.js";
import type {
  ChannelStreamingDriver,
  ChannelStreamingProducer,
  StreamingFinalizeTransport,
} from "../streaming/index.js";
import type { ChannelReplyCapabilityService } from "../channel-reply-capabilities.js";
import { deliverRelayPost, type OutputKind, type RelayPostOutcome } from "./delivery.js";
import {
  failureNotice,
  isSystemErrorText,
  owesFailureNotice,
  toolAlreadySent,
  toolTurnFallback,
} from "./turn-end.js";
import { appendThreadLink, ledgerTurnId, stripAssistantBoundary } from "./text.js";
import {
  relayToolCall,
  toolActivityLine,
  type ToolActivity,
  type ToolActivityTurn,
  type ToolLineWriter,
} from "./tool-activity.js";

export { appendThreadLink } from "./text.js";

/**
 * The relay knobs of a scope: root gates on `sync`, subagents on
 * `sync.subagents`. The typing indicator and the reaction are turn-level
 * surfaces driven from the turn lifecycle, not per-item relay gates, so they
 * never enter this type.
 */
interface SyncKnobs {
  finalAnswers: boolean;
  /** The separate progress MESSAGE (`sync.streaming.mode: progress`): its own
   * surface, with its own switch. The tool lines in the thread are gated by
   * `toolCalls`, so turning one off never silences the other. */
  progress: boolean;
  toolCalls: ToolActivity;
}

/** Edit a message this relay already posted — the vertical's own edit verb,
 * the one the streaming drafts drive. Absent = the channel cannot edit. */
type RelayEditFn = NonNullable<ChannelStreamingDriver["edit"]>;

/** The root scope's relay knobs: the `sync.progress` group's TEXT leaf is what
 * gates a relayed line, so the group collapses to `progress` here. The
 * indicator and the reaction are turn-level (plane/processing.ts), never per-item. */
function rootSyncKnobs(sync: EffectiveDefaults["sync"]): SyncKnobs {
  return {
    finalAnswers: sync.finalAnswers,
    progress: sync.progress.progressMessage,
    toolCalls: toolActivity(sync.toolCalls),
  };
}

/** A subagent scope's relay knobs. `sync.subagents` carries its own on/off
 * switches; how a tool line READS and how often it posts are the route's one
 * answer for the whole turn, so the rendering leaves come from the root. */
function subagentSyncKnobs(sync: EffectiveDefaults["sync"]): SyncKnobs {
  return {
    finalAnswers: sync.subagents.finalAnswers,
    progress: sync.subagents.progress,
    toolCalls: { ...toolActivity(sync.toolCalls), enabled: sync.subagents.toolCalls },
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
  const threadId = anchoredReplyThreadId({
    channel: context.channel,
    rootKind: context.rootKind,
    replyAnchor: context.route.defaults.replyAnchor,
    threadId: context.externalThreadId ?? context.triggerThreadId ?? null,
    messageId: context.triggerMessageId,
  });
  return {
    to: context.externalConversationId,
    ...(threadId !== undefined ? { threadId } : {}),
  };
}

interface TurnState extends ToolActivityTurn {
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
  /** Message ids already closed and posted before a terminal tool event. */
  postedAssistantMessageIds: Set<string>;
  /** Exact assistant payloads already closed in this turn (guards id drift/replay). */
  postedAssistantTexts: Set<string>;
  /**
   * Ledger sequence counter for this turn's ANSWER posts, in order. Status
   * lines count in their own space (`nextToolSequence`) under their own ledger
   * turn id: how many of them went out depends on the clock, and the answer's
   * ledger key must not move with it — a shifted key is a second post of the
   * same answer after a replay.
   */
  nextSequence: number;
  /** Ledger sequence counter for this turn's tool lines. */
  nextToolSequence: number;
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
  /** The channel's edit-in-place verb, when the loaded vertical publishes one.
   * `sync.toolCalls.whenThrottled: update` and the one-line-per-tool-call
   * terminal state both need it; without it both fall back to posting. */
  editPost?: RelayEditFn | undefined;
  /** COMPAT(clisbot-control-plane): the turn-lifecycle surface owner, opened
   * by the inbound path (the plane accepted a message that will run a turn)
   * not by this relay. The relay only keeps it alive and releases it. Absent
   * = no surface. */
  processing?: ProcessingController | undefined;
  /** COMPAT(clisbot-control-plane): the live-draft producer (slice 22b). It
   * turns the accumulating assistant text into a draft the channel updates
   * while the turn runs, and hands back the transport that finishes that draft
   * in place. Absent (no `sync.streaming`, or a vertical with no drivable
   * streaming primitive) leaves this relay's final-only post path untouched. */
  streaming?: ChannelStreamingProducer | undefined;
  /** What the `message` tool delivered per turn: the `tool` fallback and the
   * `hybrid` duplicate check read it. Absent = no tool-attaching Route here. */
  toolDeliveries?:
    | Pick<ChannelReplyCapabilityService, "takeTurnDeliveries" | "peekTurnDeliveries">
    | undefined;
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
    this.relay.streaming?.detach(agentId);
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
        await this.onTurnClosed(stream, event);
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
          subagentSyncKnobs(stream.context.route.defaults.sync),
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
          subagentSyncKnobs(stream.context.route.defaults.sync),
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
    if (text === "" || isSystemErrorText(text)) return;
    const turn = this.turn(stream, key);
    const messageId = item.messageId;
    if (messageId !== undefined && turn.postedAssistantMessageIds.has(messageId)) return;
    if (turn.pendingAssistantText !== "" && turn.pendingAssistantMessageId !== messageId) {
      await this.postAssistantMessage(stream, key, sync, prefix, false);
    }
    turn.pendingAssistantMessageId = messageId;
    turn.pendingAssistantText += text;
    // Subagent scopes carry a prefix and are relayed as their own posts; only
    // the root answer is drafted.
    if (prefix !== "") return;
    await this.relay.streaming?.onAssistantText(
      stream.context,
      key,
      replyLocationFor(stream.context),
      turn.pendingAssistantText,
    );
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
    const messageId = turn.pendingAssistantMessageId;
    turn.pendingAssistantText = "";
    turn.pendingAssistantMessageId = undefined;
    if (messageId !== undefined) turn.postedAssistantMessageIds.add(messageId);
    if (!sync.finalAnswers) return;
    if (turn.postedAssistantTexts.has(text) || (prefix === "" && this.toolSent(stream, text))) {
      this.relay.streaming?.discard(stream.context, key);
      return;
    }
    turn.postedAssistantTexts.add(text);
    const caption = `${prefix}${text}`;
    // The message is closing, so its draft closes with it: the transport
    // finishes the draft in place (and falls back to the plain post path
    // itself), which keeps this one post on one ledger row either way.
    const transport = this.relay.streaming?.takeFinalizeTransport(stream.context, key);
    // The caption posts verbatim: files leave through the `message` tool's
    // media params (channel-reply.ts), never through a text parse of the answer.
    await this.post(stream, key, turn, caption, finalAnswer, "assistant", transport);
  }

  /**
   * One tool call. The two surfaces it feeds have separate switches: the
   * thread's tool lines are gated by `sync.toolCalls`, the turn's progress
   * message by `sync.progress`. Turning one off never silences the other.
   */
  private async onToolCall(
    stream: RelayStream,
    key: string,
    sync: SyncKnobs,
    item: AgentStreamTimelineItem,
    prefix: string,
  ): Promise<void> {
    // `finish_execution` is Workflow control-plane plumbing, not work the
    // user asked the Agent to perform. Keep it out of both surfaces without
    // muting useful tool visibility.
    if (item.name !== undefined && isHubFinishExecutionToolName(item.name)) return;
    await this.raiseProgressCard(stream, key, sync, item, prefix);
    if (!sync.toolCalls.enabled) return;
    const turn = this.turn(stream, key);
    await relayToolCall(
      { clock: this.relay.clock, writer: this.toolLineWriter(stream, key, turn) },
      turn,
      sync.toolCalls,
      item,
      prefix,
    );
  }

  /** The relay's verbs for one scope's tool line: a ledgered post, and the
   * channel's edit verb with this relay's thread link on it. */
  private toolLineWriter(stream: RelayStream, key: string, turn: TurnState): ToolLineWriter {
    return {
      canEdit: this.relay.editPost !== undefined,
      post: async (line) => await this.post(stream, key, turn, line, false, "tool"),
      edit: async (externalMessageId, line) =>
        await this.editPosted(stream, externalMessageId, line),
    };
  }

  /** Rewrite a message this relay posted. False = the channel has no edit verb
   * or refused the edit; the tool surface then posts instead of updating. */
  private async editPosted(
    stream: RelayStream,
    externalMessageId: string,
    line: string,
  ): Promise<boolean> {
    const edit = this.relay.editPost;
    if (edit === undefined) return false;
    const context = stream.context;
    try {
      await edit({
        ...replyLocationFor(context),
        externalMessageId,
        text: appendThreadLink(
          line,
          context.route.defaults.sync.threadLink,
          false,
          this.relay,
          context.agentId,
        ),
      });
    } catch (error) {
      this.relay.logger.warn("relay message edit failed", {
        channel: context.channel,
        accountId: context.accountId,
        agentId: context.agentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
    return true;
  }

  /** Feed the turn's progress MESSAGE (`sync.streaming.mode: progress`), which
   * `sync.progress` gates. It shows the running tool, so it is rendered at the
   * Route's tool detail even when the thread's own tool lines are off. */
  private async raiseProgressCard(
    stream: RelayStream,
    key: string,
    sync: SyncKnobs,
    item: AgentStreamTimelineItem,
    prefix: string,
  ): Promise<void> {
    if (!sync.progress || item.status !== "running") return;
    await this.relay.streaming?.onProgress(stream.context, key, replyLocationFor(stream.context), {
      kind: "tool",
      text: `${prefix}${toolActivityLine(item, sync.toolCalls.detail)}`,
      label: item.name ?? item.type,
      ...(item.name === undefined ? {} : { toolName: item.name }),
      status: "running",
    });
  }

  private async onTurnCompleted(stream: RelayStream, turnId: string) {
    const turn = this.turn(stream, turnId);
    // A replayed end must not answer the turn a second time.
    if (turn.closed) return;
    turn.closed = true;
    const finalText = turn.pendingAssistantText;
    // Turn completion closes the last in-flight assistant message (the stream
    // gives no other "this message ended" signal for it), as the turn's final
    // answer (the threadLink `final-only` post). It reads the tool's record
    // for the `hybrid` duplicate check, so the record is taken after it.
    await this.postAssistantMessage(
      stream,
      turnId,
      rootSyncKnobs(stream.context.route.defaults.sync),
      "",
      true,
    );
    const deliveries = this.takeToolDeliveries(stream);
    if (stream.context.route.defaults.outbound.path !== "tool") return;
    if (deliveries?.channelTurn !== true) return;
    // The `tool` path relays no text, so a channel turn that never answered
    // through the tool would end in silence: forward its last message instead.
    const fallback = toolTurnFallback(deliveries, finalText);
    if (fallback !== undefined) await this.post(stream, turnId, turn, fallback, true, "assistant");
  }

  /**
   * A turn that did not complete stops any further relay posts for it. A
   * failure is reported: the partial answer is flushed where text is relayed,
   * then one notice when one is owed (`owesFailureNotice`). A cancel was
   * deliberate (`/stop`, an interrupting message), so it stays quiet.
   */
  private async onTurnClosed(
    stream: RelayStream,
    event: Extract<RelayedStreamEvent, { kind: "turn_closed" }>,
  ): Promise<void> {
    const turn = this.turn(stream, event.turnId);
    if (turn.closed) return;
    const failed = event.reason === "failed";
    if (failed) {
      await this.postAssistantMessage(
        stream,
        event.turnId,
        rootSyncKnobs(stream.context.route.defaults.sync),
        "",
        false,
      );
    }
    turn.closed = true;
    this.relay.streaming?.discard(stream.context, event.turnId);
    // A cancel is usually a message replacing the turn: its mark belongs to
    // the turn that message starts.
    const deliveries = this.takeToolDeliveries(stream, !failed);
    if (!failed || !owesFailureNotice(stream.context.route.defaults.outbound.path, deliveries)) {
      return;
    }
    await this.post(stream, event.turnId, turn, failureNotice(event.error), true, "assistant");
  }

  /** On `hybrid`, text the tool already posted this turn is not relayed again. */
  private toolSent(stream: RelayStream, text: string): boolean {
    if (stream.context.route.defaults.outbound.path !== "hybrid") return false;
    const deliveries = this.relay.toolDeliveries?.peekTurnDeliveries(stream.context.agentId);
    return toolAlreadySent(text, deliveries);
  }

  private takeToolDeliveries(stream: RelayStream, keepChannelTurn = false) {
    return this.relay.toolDeliveries?.takeTurnDeliveries(stream.context.agentId, {
      keepChannelTurn,
    });
  }

  // --- Delivery (record-before-post) ----------------------------------------

  /** One relay post; says whether it reached the channel and, when it did,
   * the message's native id (a tool line keeps it, to rewrite it later). */
  private async post(
    stream: RelayStream,
    turnId: string,
    turn: TurnState,
    text: string,
    finalAnswer: boolean,
    outputKind: OutputKind,
    transport?: StreamingFinalizeTransport | undefined,
  ): Promise<RelayPostOutcome> {
    const context = stream.context;
    // One post per recorded sequence, in order; the final answer is the turn's
    // last ANSWER post. Status lines count in their own space, so the answer's
    // key does not move with how many of them the clock let through.
    const sequence = outputKind === "assistant" ? turn.nextSequence : turn.nextToolSequence;
    if (outputKind === "assistant") turn.nextSequence += 1;
    else turn.nextToolSequence += 1;
    return await deliverRelayPost(this.relay, {
      context,
      key: {
        organizationId: this.relay.organizationId,
        accountId: context.accountId,
        externalConversationId: context.externalConversationId,
        externalThreadId: context.externalThreadId,
        eventTurnId: ledgerTurnId(context.deliveryScopeId ?? context.agentId, turnId, outputKind),
        sequence,
      },
      location: replyLocationFor(context),
      text: appendThreadLink(
        text,
        context.route.defaults.sync.threadLink,
        finalAnswer,
        this.relay,
        context.agentId,
      ),
      outputKind,
      transport,
    });
  }

  private turn(stream: RelayStream, turnId: string): TurnState {
    let turn = stream.turns.get(turnId);
    if (turn === undefined) {
      turn = {
        pendingAssistantText: "",
        pendingAssistantMessageId: undefined,
        postedAssistantMessageIds: new Set(),
        postedAssistantTexts: new Set(),
        toolLines: new Map(),
        liveToolCall: undefined,
        lastToolPostAt: null,
        nextSequence: 0,
        nextToolSequence: 0,
        closed: false,
      };
      stream.turns.set(turnId, turn);
    }
    return turn;
  }
}

// Media is sent only through the Hub's `message` MCP tool (`attachments`/`media`/`buffer`).
