/**
 * The turn a channel Steer names. A Host with the input queue (`hostInputQueue`)
 * refuses a Steer that names no turn while one runs (`strictSteer` in
 * `server/agent/agent-prompt.ts`), so a follow-up sent mid-turn was refused on
 * every attempt and dead-lettered once the drain gave up. The Hub names the
 * running turn it reads from the Host.
 *
 * The daemon fingerprints the whole request, turn included, under the message
 * id (`server/message-receipts`). A retry therefore names the turn its first
 * attempt named: a delivered message whose answer was lost replays as delivered,
 * not as `agent_request_key_conflict`. The remembered turn is dropped only when
 * the Host never saw the attempt or refused the Steer before the agent saw it,
 * which frees the receipt on Hosts from 2.2.2, so the next attempt reads the turn
 * again. Memory is per Hub process; a retry after a Hub restart reads the turn
 * again.
 */

import { HostNotReachedError } from "./enrolled-client.js";

/** No turn: the agent was idle, so the Steer starts one. */
type SteerTurn = string | null;

/** Refusals the Host gives before the provider sees the prompt (`agent-prompt.ts`, `agent-manager.ts`). */
const STEER_REFUSALS = [
  "Active turn changed before steering could be delivered",
  "Active turn identity is unavailable",
  "This provider cannot steer this active turn",
  "Exact turn steering is unavailable",
  "Exact turn steering is disabled on this Host",
];

const REMEMBERED_LIMIT = 1_000;

/** The Host's running turn, `null` when the agent is not running. */
export function runningTurnOf(agent: Record<string, unknown> | undefined): SteerTurn {
  if (agent?.["status"] !== "running") return null;
  const activeTurn = agent["activeTurn"];
  const turnId =
    typeof activeTurn === "object" && activeTurn !== null && "turnId" in activeTurn
      ? activeTurn.turnId
      : undefined;
  // Sending now would be refused, and a Host before 2.2.2 keeps a refused attempt's receipt,
  // so the message could never be sent again. Not sending leaves it to the ingress retry.
  if (typeof turnId !== "string" || turnId === "")
    throw new Error("The running turn cannot be named yet; wait a moment.");
  return turnId;
}

export function isSteerRefusal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return STEER_REFUSALS.some((refusal) => message.startsWith(refusal));
}

export class SteerTargets {
  private readonly turns = new Map<string, SteerTurn>();

  /** `key` is set when the daemon keeps a receipt for the message (it has a message id). */
  async resolve(key: string | undefined, read: () => Promise<SteerTurn>): Promise<SteerTurn> {
    if (key !== undefined && this.turns.has(key)) return this.turns.get(key)!;
    const turn = await read();
    if (key === undefined) return turn;
    this.turns.set(key, turn);
    if (this.turns.size > REMEMBERED_LIMIT) this.turns.delete(this.turns.keys().next().value!);
    return turn;
  }

  /** `error` is what the send threw; absent when it was delivered. */
  settle(key: string | undefined, error?: unknown): void {
    if (key === undefined) return;
    if (error === undefined || error instanceof HostNotReachedError || isSteerRefusal(error))
      this.turns.delete(key);
  }
}
