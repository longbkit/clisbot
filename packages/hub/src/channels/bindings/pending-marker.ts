// The pre-create pending marker's two recovery rules. A marker exists because
// the trusted create has no dedup: it names the execution whose Agent may or may
// not exist on the daemon. It is resolved by finding that Agent, and it is given
// up only when the daemon has had long enough to show one.
import type { ChannelStore } from "../../db/channels.js";
import type { ThreadBindingRecord } from "../../db/types.js";
import type { DaemonConnection } from "../daemon/client.js";
import type { PlaneLogger, SupportedChannelName } from "../plane/types.js";
import { findChannelExecutionAgent } from "./session-create.js";

/**
 * How long a marker may wait for its Agent to appear, counted from the marker.
 * The create RPC gives up at 90 s while the daemon may still finish it, so the
 * wait outlasts that by a margin; past it the marker is released and the thread
 * starts over.
 */
export const PENDING_MARKER_TTL_MS = 180_000;

/**
 * A create is still unresolved for this thread. Thrown rather than returned so
 * the durable ingress retries the message instead of completing it unanswered.
 */
export class ChannelAgentCreatePendingError extends Error {
  constructor() {
    super("agent create in progress; the message is retried");
    this.name = "ChannelAgentCreatePendingError";
  }
}

/** How often a create that is still running renews the thread's typing surface. */
const SLOW_CREATE_TICK_MS = 20_000;

/**
 * A session that takes long to start must not look dead: the typing surface
 * expires on its own, and the sender has no other sign that anything is
 * happening. Each tick keeps the surface; the first one also tells the sender.
 * Returns the stop.
 */
export function watchSlowCreate(watch: {
  keepSurface: () => void;
  tellSender: () => void;
}): () => void {
  let told = false;
  const timer = setInterval(() => {
    watch.keepSurface();
    if (!told) watch.tellSender();
    told = true;
  }, SLOW_CREATE_TICK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * How soon a message comes back when its Host is busy starting other sessions.
 * The queue ends a row after 50 releases (`CHANNEL_INGRESS_RELEASE_BUDGET`), so
 * this is also how long a message may wait for a slot: about four minutes.
 */
export const HOST_BUSY_RETRY_AFTER_MS = 5_000;

export function pendingMarkerExpired(binding: ThreadBindingRecord, now: number): boolean {
  return now - binding.createdAt.getTime() >= PENDING_MARKER_TTL_MS;
}

interface OrphanRecoveryContext {
  organizationId: string;
  store: ChannelStore;
  daemon: DaemonConnection;
  logger: PlaneLogger;
}

/**
 * Orphan recovery (plan §10): scan the org's pending markers against
 * `fetch_agents`; a marker whose agent survived (matched by its execution-id
 * label) is re-bound instead of re-created. A marker with no surviving agent is
 * left pending — the next inbound re-checks it and releases it once expired.
 */
export async function recoverOrphanMarkers(
  context: OrphanRecoveryContext,
  scope?: { channel: SupportedChannelName; accountId: string },
): Promise<{ rebound: number; leftPending: number }> {
  const pending = await context.store.listPendingThreadBindings(context.organizationId, scope);
  if (pending.length === 0) return { rebound: 0, leftPending: 0 };
  const agents = await context.daemon.listAgents();
  let rebound = 0;
  for (const marker of pending) {
    const agent = findChannelExecutionAgent(agents, marker.pendingExecutionId ?? "");
    if (agent === undefined) continue;
    await context.store.resolvePendingThreadBinding({
      organizationId: marker.organizationId,
      accountId: marker.accountId,
      externalConversationId: marker.externalConversationId,
      externalThreadId: marker.externalThreadId,
      agentId: agent.id,
      resolvedAt: new Date(),
    });
    context.logger.info?.("orphan recovery re-bound a pending marker", {
      accountId: marker.accountId,
      agentId: agent.id,
    });
    rebound += 1;
  }
  return { rebound, leftPending: pending.length - rebound };
}
