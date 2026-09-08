import type { DaemonConnection } from "./daemon/client.js";

interface QueuedMessage {
  text: string;
  post(text: string): Promise<boolean>;
  authorize(): Promise<boolean>;
}

/** Client-side hold: each terminal event releases one message after rechecking current access. */
export class ChannelCommandTurnQueue {
  private readonly entries = new Map<string, QueuedMessage[]>();
  private readonly terminalTurns = new Map<string, Set<string>>();
  private readonly sending = new Set<string>();
  private readonly awaitingStart = new Set<string>();

  constructor(
    private readonly daemon: Pick<DaemonConnection, "sendAgentMessage"> &
      Partial<Pick<DaemonConnection, "listAgents">>,
  ) {}

  async enqueue(
    agentId: string,
    text: string,
    running: boolean,
    post: QueuedMessage["post"],
    authorize: QueuedMessage["authorize"] = async () => true,
  ): Promise<void> {
    const queue = this.entries.get(agentId) ?? [];
    queue.push({ text, post, authorize });
    this.entries.set(agentId, queue);
    if (!running && !this.awaitingStart.has(agentId)) await this.release(agentId);
  }

  async onStream(agentId: string, event: unknown): Promise<void> {
    if (typeof event !== "object" || event === null) return;
    const frame = event as { type?: string; kind?: string; turnId?: string };
    const kind = frame.type ?? frame.kind;
    if (kind === "turn_started") {
      this.awaitingStart.delete(agentId);
      return;
    }
    if (!kind || !["turn_completed", "turn_failed", "turn_canceled", "turn_closed"].includes(kind))
      return;
    if (frame.turnId) {
      const seen = this.terminalTurns.get(agentId) ?? new Set<string>();
      if (seen.has(frame.turnId)) return;
      seen.add(frame.turnId);
      if (seen.size > 100) seen.delete(seen.values().next().value!);
      this.terminalTurns.set(agentId, seen);
    } else if (this.awaitingStart.has(agentId)) return;
    await this.release(agentId);
  }

  private async release(agentId: string): Promise<void> {
    if (this.sending.has(agentId)) return;
    const queue = this.entries.get(agentId);
    const entry = queue?.shift();
    if (entry === undefined) return;
    this.sending.add(agentId);
    this.awaitingStart.add(agentId);
    try {
      if (!(await entry.authorize()))
        throw new Error("Your access no longer allows this queued message.");
      if (this.entries.get(agentId) !== queue) return;
      const agents = await this.daemon.listAgents?.();
      if (agents?.some((agent) => agent.id === agentId && agent.status === "running")) {
        queue?.unshift(entry);
        this.awaitingStart.delete(agentId);
        return;
      }
      if (this.entries.get(agentId) !== queue) return;
      // The wire offers only interrupt/steer; steer avoids canceling a separately started turn.
      // The idle check above narrows that unavoidable cross-client race.
      await this.daemon.sendAgentMessage(agentId, entry.text, { steer: true });
    } catch (error) {
      this.awaitingStart.delete(agentId);
      const detail = error instanceof Error ? error.message : String(error);
      await entry.post(`Queued message could not be delivered: ${detail}`).catch(() => false);
      this.entries.delete(agentId);
    } finally {
      this.sending.delete(agentId);
    }
  }

  clear(agentId: string): void {
    this.entries.delete(agentId);
    this.terminalTurns.delete(agentId);
    this.awaitingStart.delete(agentId);
  }

  stop(): void {
    this.entries.clear();
    this.terminalTurns.clear();
    this.awaitingStart.clear();
  }
}
