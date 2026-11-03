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
 * after success for exactly that replay. It is dropped only once every attempt
 * that began sending is known not to have reached the agent: the Host never saw
 * it, or refused the Steer before the agent saw it. One attempt with an unknown
 * outcome, in flight or lost, keeps the turn for good. A Host from 2.2.2 frees a
 * refused attempt's receipt, so after the drop the next attempt reads the turn
 * again.
 *
 * A Host before 2.2.2 keeps a refused attempt's receipt. A turn that ends
 * between the read and the send is refused there, and the message dead-letters:
 * no Hub-side order closes that window, only the Host update does.
 */

import { HostNotReachedError } from "./enrolled-client.js";

/** No turn: the agent was idle, so the Steer starts one. */
export type SteerTurn = string | null;

/** Durable in the Hub (`db/channel-steer-targets.ts`); each method is atomic. */
export interface SteerTargetStore {
  /** `undefined` when nothing is recorded for the message. */
  find(agentId: string, messageId: string): Promise<SteerTurn | undefined>;
  /** Record `turn` unless one is recorded (first writer wins). */
  claim(agentId: string, messageId: string, turn: SteerTurn): Promise<void>;
  /** Count an attempt about to send; the recorded turn, `undefined` when none. */
  begin(agentId: string, messageId: string): Promise<SteerTurn | undefined>;
  /** Count a begun attempt naming `turn` as undelivered; forget the record once all are. */
  undelivered(agentId: string, messageId: string, turn: SteerTurn): Promise<void>;
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
  await store.claim(agentId, messageId, await read());
  const claimed = await store.find(agentId, messageId);
  if (claimed === undefined) throw new Error("The Steer target changed; this message is retried.");
  return claimed;
}

/**
 * Count this attempt right before it sends. A record forgotten or replaced since
 * the turn was resolved means another attempt settled it: send nothing now.
 */
export async function beginSteerTurn(
  store: SteerTargetStore,
  agentId: string,
  messageId: string | undefined,
  turn: SteerTurn,
): Promise<void> {
  if (messageId === undefined) return;
  const recorded = await store.begin(agentId, messageId);
  if (recorded === turn) return;
  // Counted but not sent: say so, or the record could never be forgotten.
  if (recorded !== undefined) await store.undelivered(agentId, messageId, recorded);
  throw new Error("The Steer target changed; this message is retried.");
}

/** After a begun send failed: count it undelivered only when it provably reached no agent. */
export async function settleSteerTurn(
  store: SteerTargetStore,
  agentId: string,
  messageId: string | undefined,
  turn: SteerTurn,
  error: unknown,
): Promise<void> {
  if (messageId === undefined) return;
  if (error instanceof HostNotReachedError || isSteerRefusal(error))
    await store.undelivered(agentId, messageId, turn);
}

/** Count the attempt, send it, and count a failure that provably reached no agent. */
export async function sendNamingSteerTurn(
  store: SteerTargetStore,
  agentId: string,
  messageId: string | undefined,
  turn: SteerTurn,
  send: () => Promise<void>,
): Promise<void> {
  await beginSteerTurn(store, agentId, messageId, turn);
  try {
    await send();
  } catch (error) {
    // Left uncounted, the record only keeps its turn, which is the safe side.
    await settleSteerTurn(store, agentId, messageId, turn, error).catch(() => undefined);
    throw error;
  }
}

/**
 * For a connection with no Hub database (a test, a CLI): survives neither a
 * restart nor another process. The supervisor passes the durable store.
 */
export function createMemorySteerTargets(): SteerTargetStore {
  const records = new Map<string, { turn: SteerTurn; dispatches: number; undelivered: number }>();
  const key = (agentId: string, messageId: string) => JSON.stringify([agentId, messageId]);
  return {
    find: async (agentId, messageId) => records.get(key(agentId, messageId))?.turn,
    claim: async (agentId, messageId, turn) => {
      const k = key(agentId, messageId);
      if (records.has(k)) return;
      records.set(k, { turn, dispatches: 0, undelivered: 0 });
      if (records.size > REMEMBERED_LIMIT) records.delete(records.keys().next().value!);
    },
    begin: async (agentId, messageId) => {
      const record = records.get(key(agentId, messageId));
      if (record === undefined) return undefined;
      record.dispatches += 1;
      return record.turn;
    },
    undelivered: async (agentId, messageId, turn) => {
      const k = key(agentId, messageId);
      const record = records.get(k);
      if (record === undefined || record.turn !== turn) return;
      record.undelivered += 1;
      if (record.undelivered >= record.dispatches) records.delete(k);
    },
  };
}
