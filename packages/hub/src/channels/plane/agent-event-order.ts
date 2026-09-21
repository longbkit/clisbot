// One agent's stream events are handled in the order they arrived. The socket
// callback hands each frame over without waiting, and a handler awaits a
// platform post, so two frames of one turn used to run side by side: a tool
// line could land after the final answer, an approval card before the text
// that led to it, and `turn_completed` could flush while an earlier post was
// still in flight. Agents stay independent — one conversation's slow post never
// holds another's output.

/**
 * How long the next event waits for the one before it. A platform post that
 * never settles must not hold the agent's later events: `turn_completed` is
 * what releases its run slot and its typing surface.
 */
export const AGENT_EVENT_WAIT_MS = 60_000;

function settledOrOverdue(event: Promise<void>, waitMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const overdue = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs);
    timer.unref?.();
  });
  const settled = event.catch(() => undefined);
  return Promise.race([settled, overdue]).finally(() => clearTimeout(timer));
}

export class AgentEventOrder {
  private readonly tails = new Map<string, Promise<void>>();

  constructor(private readonly waitMs = AGENT_EVENT_WAIT_MS) {}

  /** Run `handle` after every earlier event of this agent has settled. */
  run(agentId: string, handle: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(agentId) ?? Promise.resolve();
    // A failed event is its caller's to report, and an overdue one keeps
    // running; neither stops the next.
    const current = previous.then(handle);
    const tail = settledOrOverdue(current, this.waitMs);
    this.tails.set(agentId, tail);
    void tail.then(() => {
      if (this.tails.get(agentId) === tail) this.tails.delete(agentId);
      return undefined;
    });
    return current;
  }
}
