/**
 * The turn a channel Steer names. A Host with the input queue (`hostInputQueue`)
 * refuses a Steer that names no turn while one runs (`strictSteer` in
 * `server/agent/agent-prompt.ts`), so a follow-up sent mid-turn was refused on
 * every attempt and dead-lettered once the drain gave up. The Hub names the
 * running turn it reads from the Host.
 *
 * The daemon fingerprints the whole request, turn included, under the message
 * id (`server/message-receipts`). Every attempt of a message therefore names the
 * turn its first attempt recorded, from any Hub process: a delivered message
 * replayed after a restart, a lost acknowledgement or on another replica is
 * answered as delivered, not as `agent_request_key_conflict`. The record is kept
 * after success for exactly that replay, and dropped only when the Host never
 * saw the attempt or refused the Steer before the agent saw it. A Host from
 * 2.2.2 frees the receipt then, so the next attempt reads the turn again.
 *
 * A Host before 2.2.2 keeps a refused attempt's receipt. A turn that ends
 * between the read and the send is refused there, and the message dead-letters:
 * no Hub-side order closes that window, only the Host update does.
 */

import { HostNotReachedError } from "./enrolled-client.js";

/** No turn: the agent was idle, so the Steer starts one. */
export type SteerTurn = string | null;

/** Durable in the Hub (`db/channel-steer-targets.ts`); first writer wins. */
export interface SteerTargetStore {
  /** `undefined` when nothing is recorded for the message. */
  find(agentId: string, messageId: string): Promise<SteerTurn | undefined>;
  /** Record `turn` unless one is recorded; return the recorded turn. */
  claim(agentId: string, messageId: string, turn: SteerTurn): Promise<SteerTurn>;
  /** Forget the record while it still names `turn`. */
  release(agentId: string, messageId: string, turn: SteerTurn): Promise<void>;
}

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

/** The turn to name: the recorded one, else the Host's, recorded first. */
export async function resolveSteerTurn(
  store: SteerTargetStore,
  agentId: string,
  messageId: string | undefined,
  read: () => Promise<SteerTurn>,
): Promise<SteerTurn> {
  if (messageId === undefined) return read();
  const recorded = await store.find(agentId, messageId);
  if (recorded !== undefined) return recorded;
  return store.claim(agentId, messageId, await read());
}

/** After a failed send: forget the turn only when this attempt provably reached no agent. */
export async function settleSteerTurn(
  store: SteerTargetStore,
  agentId: string,
  messageId: string | undefined,
  turn: SteerTurn,
  error: unknown,
): Promise<void> {
  if (messageId === undefined) return;
  if (error instanceof HostNotReachedError || isSteerRefusal(error))
    await store.release(agentId, messageId, turn);
}

/**
 * For a connection with no Hub database (a test, a CLI): survives neither a
 * restart nor another process. The supervisor passes the durable store.
 */
export function createMemorySteerTargets(): SteerTargetStore {
  const turns = new Map<string, SteerTurn>();
  const key = (agentId: string, messageId: string) => JSON.stringify([agentId, messageId]);
  return {
    find: async (agentId, messageId) => turns.get(key(agentId, messageId)),
    claim: async (agentId, messageId, turn) => {
      const k = key(agentId, messageId);
      if (!turns.has(k)) {
        turns.set(k, turn);
        if (turns.size > REMEMBERED_LIMIT) turns.delete(turns.keys().next().value!);
      }
      return turns.get(k)!;
    },
    release: async (agentId, messageId, turn) => {
      const k = key(agentId, messageId);
      if (turns.has(k) && turns.get(k) === turn) turns.delete(k);
    },
  };
}
