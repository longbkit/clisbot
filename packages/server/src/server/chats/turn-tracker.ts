// One `AgentManager.subscribe` per live (bot, chat) session
// (docs/features/bots-and-chats/plans/server-chat.md, §2.7). Turns the agent
// stream into "this turn answered these chat lines with this text": the engine
// appends the bot line, the tracker never touches the transcript.
import type { Logger } from "pino";
import type { AgentManager, AgentManagerEvent } from "../agent/agent-manager.js";
import type { PromptDispatchDisposition } from "../agent/agent-prompt.js";
import type { AgentStreamEvent } from "../agent/agent-sdk-types.js";
import { finalAnswer, type AnsweredItem, type TimelineReference } from "./final-answer.js";

export type { TimelineReference } from "./final-answer.js";

/** Which chat lines a prompt asked the agent to answer, and how the send landed. */
export interface TurnExpectation {
  messageIds: string[];
  /** The hop of the newest line answered; the reply is one hop further. */
  hop: number;
  disposition: PromptDispatchDisposition;
}

export interface TurnOutcome {
  agentId: string;
  chatId: string;
  botId: string;
  turnId: string;
  /** The last contiguous assistant text of the turn; `null` when it said nothing. */
  text: string | null;
  /** The durable row of the last assistant item, when session storage recorded it. */
  lastRow: TimelineReference | null;
  /** `null` for a turn nobody in the chat asked for (started from the cowork view). */
  expectation: TurnExpectation | null;
}

export interface TurnTrackerHost {
  onTurnCompleted(outcome: TurnOutcome): Promise<void>;
  onTurnFailed(outcome: TurnOutcome, error: string): Promise<void>;
}

interface OpenTurn {
  expectation: TurnExpectation | null;
  items: AnsweredItem[];
}

interface WatchedAgent {
  chatId: string;
  botId: string;
  unsubscribe: () => void;
  /** Expectations waiting for their `turn_started`, oldest first. */
  pending: TurnExpectation[];
  turns: Map<string, OpenTurn>;
  openTurnId: string | null;
  unnamedTurns: number;
  buffered: AgentManagerEvent[] | null;
}

export class TurnTracker {
  private readonly agents = new Map<string, WatchedAgent>();
  private readonly logger: Logger;

  constructor(
    private readonly agentManager: Pick<AgentManager, "subscribe">,
    private readonly host: TurnTrackerHost,
    logger: Logger,
  ) {
    this.logger = logger.child({ module: "chats", component: "turn-tracker" });
  }

  /** Subscribes once per agent; a later call with the same agent is a no-op. */
  watch(agentId: string, chatId: string, botId: string): void {
    if (this.agents.has(agentId)) return;
    const watched: WatchedAgent = {
      chatId,
      botId,
      unsubscribe: () => undefined,
      pending: [],
      turns: new Map(),
      openTurnId: null,
      unnamedTurns: 0,
      buffered: null,
    };
    this.agents.set(agentId, watched);
    watched.unsubscribe = this.agentManager.subscribe(
      (event) => this.onEvent(agentId, watched, event),
      { agentId, replayState: false },
    );
  }

  unwatch(agentId: string): void {
    const watched = this.agents.get(agentId);
    if (!watched) return;
    this.agents.delete(agentId);
    watched.unsubscribe();
  }

  stop(): void {
    for (const agentId of Array.from(this.agents.keys())) this.unwatch(agentId);
  }

  /**
   * Records what a prompt asked for. `turn_started` binds it to the next turn that opens;
   * `steered` joins the turn already open; `out_of_band` (a duplicate send) binds nothing.
   */
  expect(agentId: string, expectation: TurnExpectation): void {
    const watched = this.agents.get(agentId);
    if (!watched || expectation.disposition === "out_of_band") return;
    const open = watched.openTurnId ? watched.turns.get(watched.openTurnId) : undefined;
    if (expectation.disposition === "steered" && open) {
      open.expectation = mergeExpectation(open.expectation, expectation);
      return;
    }
    watched.pending.push(expectation);
  }

  /** Provider events can arrive before prompt admission returns its disposition. */
  async dispatch(
    agentId: string,
    expectation: Omit<TurnExpectation, "disposition">,
    send: () => Promise<{ disposition: PromptDispatchDisposition }>,
  ): Promise<void> {
    const watched = this.agents.get(agentId);
    if (!watched) throw new Error(`Agent ${agentId} is not watched`);
    if (watched.buffered) throw new Error(`Concurrent prompt admission for ${agentId}`);
    const events: AgentManagerEvent[] = [];
    watched.buffered = events;
    try {
      const { disposition } = await send();
      this.expect(agentId, { ...expectation, disposition });
    } finally {
      watched.buffered = null;
      for (const event of events) this.onEvent(agentId, watched, event);
    }
  }

  private onEvent(agentId: string, watched: WatchedAgent, event: AgentManagerEvent): void {
    if (watched.buffered) {
      watched.buffered.push(event);
      return;
    }
    if (event.type === "agent_state") {
      if (event.agent.lifecycle === "closed") this.unwatch(agentId);
      return;
    }
    if (event.type !== "agent_stream") return;
    const stream = event.event;
    switch (stream.type) {
      case "turn_started":
        return this.openTurn(watched, stream.turnId);
      case "timeline":
        return this.absorb(watched, stream, event);
      case "turn_completed":
        return this.close(agentId, watched, stream.turnId, null);
      case "turn_failed":
        return this.close(agentId, watched, stream.turnId, stream.error);
      case "turn_canceled":
        return this.discard(watched, stream.turnId);
      default:
        return;
    }
  }

  private openTurn(watched: WatchedAgent, turnId: string | undefined): void {
    const id = turnId ?? `unnamed-${++watched.unnamedTurns}`;
    watched.turns.set(id, { expectation: watched.pending.shift() ?? null, items: [] });
    watched.openTurnId = id;
  }

  private absorb(
    watched: WatchedAgent,
    stream: Extract<AgentStreamEvent, { type: "timeline" }>,
    event: Extract<AgentManagerEvent, { type: "agent_stream" }>,
  ): void {
    const id = stream.turnId ?? watched.openTurnId;
    const turn = id ? watched.turns.get(id) : undefined;
    if (!turn) return;
    const row =
      event.epoch !== undefined && event.seq !== undefined
        ? { epoch: event.epoch, seq: event.seq }
        : null;
    // Only the final contiguous assistant run is projected into the transcript.
    // Tool output stays in the timeline, not in this long-lived subscriber's memory.
    if (stream.item.type !== "assistant_message") turn.items = [];
    else turn.items.push({ item: stream.item, row });
  }

  private close(
    agentId: string,
    watched: WatchedAgent,
    turnId: string | undefined,
    error: string | null,
  ): void {
    const id = turnId ?? watched.openTurnId;
    const turn = id ? watched.turns.get(id) : undefined;
    if (!id || !turn) return;
    this.discard(watched, id);
    const answer = finalAnswer(turn.items);
    const outcome: TurnOutcome = {
      agentId,
      chatId: watched.chatId,
      botId: watched.botId,
      turnId: id,
      text: answer?.text ?? null,
      lastRow: answer?.lastRow ?? null,
      expectation: turn.expectation,
    };
    const handled =
      error === null ? this.host.onTurnCompleted(outcome) : this.host.onTurnFailed(outcome, error);
    handled.catch((cause: unknown) =>
      this.logger.error({ agentId, turnId: id, err: cause }, "chat.turn.handler_failed"),
    );
  }

  private discard(watched: WatchedAgent, turnId: string | undefined): void {
    const id = turnId ?? watched.openTurnId;
    if (!id) return;
    watched.turns.delete(id);
    if (watched.openTurnId === id) watched.openTurnId = null;
  }
}

function mergeExpectation(
  current: TurnExpectation | null,
  added: TurnExpectation,
): TurnExpectation {
  if (!current) return added;
  return {
    messageIds: [...current.messageIds, ...added.messageIds],
    hop: Math.max(current.hop, added.hop),
    disposition: current.disposition,
  };
}
