// One relay scope's in-memory state (a root turn or a subagent), and what of it
// survives a re-attach. Every channel follow-up re-attaches the relay, a steer
// into the running turn included: a scope still running keeps its state there,
// or its next answer would reuse a ledger key and be skipped as delivered (#40).
import type { ToolActivityTurn } from "./tool-activity.js";

export interface TurnState extends ToolActivityTurn {
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
   * Ledger sequence counter for this turn's ANSWER posts that carry no message
   * id, in order (a message with an id is keyed by it). Status lines count in
   * their own space (`nextToolSequence`) under their own ledger turn id: how
   * many of them went out depends on the clock, and the answer's ledger key
   * must not move with it — a shifted key is a second post of the same answer
   * after a replay.
   */
  nextSequence: number;
  /** Ledger sequence counter for this turn's tool lines. */
  nextToolSequence: number;
  /** True once the turn closed (no further relay posts for it). */
  closed: boolean;
}

export function newTurnState(): TurnState {
  return {
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
}

const SUBAGENT_KEY_PREFIX = "sub:";

/**
 * The subagent scope's turn key: `sub:<subagentId>`. The subagent id is a
 * per-spawn UUID, stable across wire replays, so root and subagent ledger
 * keys never collide and a replayed subagent scope dedupes against its own
 * earlier posts.
 */
export function subagentTurnKey(subagentId: string): string {
  return `${SUBAGENT_KEY_PREFIX}${subagentId}`;
}

/**
 * Forget the scopes that closed, with their subagent labels; keep the ones
 * still running. A re-attach calls this instead of starting over, so state
 * stays bounded by the turns between two follow-ups, as it was.
 */
export function dropClosedScopes(
  turns: Map<string, TurnState>,
  subagentLabels: Map<string, string | null>,
): void {
  for (const [key, turn] of turns) {
    if (!turn.closed) continue;
    turns.delete(key);
    if (key.startsWith(SUBAGENT_KEY_PREFIX)) {
      subagentLabels.delete(key.slice(SUBAGENT_KEY_PREFIX.length));
    }
  }
}
