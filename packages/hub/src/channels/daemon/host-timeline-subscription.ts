// One Host's timeline subscription, shared by every channel account that rides
// the Host's own socket (`enrolled-client.ts`).
//
// That socket is one session source on the daemon, and the Hub does not
// declare `owned_subscriptions`, so the daemon keeps ONE timeline set for it:
// each `agent.timeline.set_subscription.request` replaces the last. When each
// account sent only its own agents, the last writer won. A Telegram account
// that failed and restarted every five minutes sent `[]` on every stop, and
// the Slack turns running on the same Host stopped streaming: their answers
// never reached the thread, the turn never ended for the plane, and the next
// Host disconnect told those threads, a day later, that the machine went away
// while it was working on them (2026-11-04).
//
// So every account's set is kept here and the Host always gets the union. The
// set also belongs to the socket: when the Host reconnects, the new socket has
// none, and it is sent again.

/** Writes one set to the Host: the facade's `agent.timeline.set_subscription.request`. */
export type TimelineSubscriptionWrite = (agentIds: readonly string[]) => Promise<void>;

export class HostTimelineSubscription {
  private readonly byClient = new Map<string, ReadonlySet<string>>();
  /** Writes go out in order, each with the union as it is when it runs. */
  private chain: Promise<void> = Promise.resolve();

  /** This account now follows `agentIds`; the Host gets everyone's. */
  set(clientKey: string, agentIds: readonly string[], write: TimelineSubscriptionWrite) {
    if (agentIds.length === 0) this.byClient.delete(clientKey);
    else this.byClient.set(clientKey, new Set(agentIds));
    return this.write(write);
  }

  /** The Host's socket came back without the set the old one held. */
  resend(write: TimelineSubscriptionWrite): Promise<void> {
    if (this.byClient.size === 0) return Promise.resolve();
    return this.write(write);
  }

  /** The account stopped: its agents leave the next write. Nothing is sent now,
   * since a stopping account has already sent its own empty set. */
  forget(clientKey: string): void {
    this.byClient.delete(clientKey);
  }

  /** What the Host should be sending, across accounts. */
  agentIds(): string[] {
    const union = new Set<string>();
    for (const ids of this.byClient.values()) for (const id of ids) union.add(id);
    return [...union].sort();
  }

  private write(write: TimelineSubscriptionWrite): Promise<void> {
    const run = () => write(this.agentIds());
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }
}
