// A loopback Paseo daemon for channel integration tests.
//
// The daemon leg is the one thing a channel sim-boot cannot run in process, so
// it gets the same treatment the platforms do: a real WebSocket server speaking
// the real frame shapes, with every received message recorded for assertions.
//
// Extracted from `channels/supervisor/boot.integration.native.ts`, which grew
// the original inline copy; both suites now share this one.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocketServer, type WebSocket } from "ws";

export type RecordedDaemonMessage = Record<string, unknown> & { type?: string };

export interface FakeDaemonOptions {
  readonly serverId?: string;
  /** The id of the FIRST created agent; later ones get `-2`, `-3`, … */
  readonly agentId?: string;
  readonly provider?: string;
}

/** One assistant turn to play onto an agent's timeline. Deltas are what the
 * daemon actually sends: coalesced `assistant_message` items of ONE message
 * (same `messageId`), each carrying the next slice of text, not the whole
 * answer. `gapMs` is the wait between them — a channel paces its draft edits
 * on a real clock, so a turn that streams faster than the pacing window shows
 * one edit, not three. */
export interface FakeAgentTurn {
  readonly agentId: string;
  readonly turnId?: string;
  readonly messageId?: string;
  readonly deltas: readonly string[];
  readonly gapMs?: number;
  /** A tool event played before the text: `running` then `completed`. */
  readonly toolName?: string;
}

/**
 * Records every session frame and answers the RPCs the channel plane makes:
 * create → `status/agent_created`, send → `send_agent_message_response`,
 * fetch → `fetch_agents_response`, timeline subscribe → its response. Anything
 * else answers `rpc_error`, so an unhandled RPC fails loudly instead of hanging.
 */
export class FakeDaemon {
  readonly messages: RecordedDaemonMessage[] = [];
  /** Every agent id this daemon minted, oldest first. */
  readonly createdAgentIds: string[] = [];
  private readonly server: Server;
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private readonly options: Required<FakeDaemonOptions>;
  private streamSeq = 0;
  port = 0;

  constructor(options: FakeDaemonOptions = {}) {
    this.options = {
      serverId: options.serverId ?? "sim-fake-daemon",
      agentId: options.agentId ?? "agent-sim-1",
      provider: options.provider ?? "codex",
    };
    this.wss = new WebSocketServer({ noServer: true });
    this.server = createServer();
    this.server.on("upgrade", (request, socket, head) => {
      this.wss.handleUpgrade(request, socket, head, (client) => {
        this.clients.add(client);
        client.on("close", () => this.clients.delete(client));
        client.on("error", () => this.clients.delete(client));
        client.on("message", (data) => this.onMessage(client, data.toString()));
      });
    });
  }

  get host(): string {
    return `127.0.0.1:${this.port}`;
  }

  /** The id the next `create_agent_request` will report. A real daemon never
   * hands out the same agent twice, and the relay keys a conversation's stream
   * context by agent id, so two conversations must not share one. */
  private mintAgentId(): string {
    const index = this.createdAgentIds.length + 1;
    const id = index === 1 ? this.options.agentId : `${this.options.agentId}-${index}`;
    this.createdAgentIds.push(id);
    return id;
  }

  /** Push one `agent_stream` event, the way the daemon pushes a subscribed
   * agent's timeline (`daemon/ws-client.ts` `agent_stream`). */
  emitStream(agentId: string, event: Record<string, unknown>): void {
    this.streamSeq += 1;
    for (const client of this.clients) {
      this.send(client, {
        type: "agent_stream",
        payload: { agentId, event, seq: this.streamSeq },
      });
    }
  }

  /**
   * Play one assistant turn: `turn_started`, an optional tool call
   * (running → completed), the assistant text deltas, then `turn_completed`.
   * Resolves once the last frame is written, so a test can then poll the
   * platform transcript.
   */
  async streamTurn(turn: FakeAgentTurn): Promise<void> {
    const turnId = turn.turnId ?? `turn-${this.streamSeq + 1}`;
    const messageId = turn.messageId ?? `${turnId}-m1`;
    const emit = (event: Record<string, unknown>) =>
      this.emitStream(turn.agentId, { ...event, turnId });
    emit({ type: "turn_started" });
    if (turn.toolName !== undefined) {
      emit({
        type: "timeline",
        item: { type: "tool_call", name: turn.toolName, status: "running" },
      });
      emit({
        type: "timeline",
        item: { type: "tool_call", name: turn.toolName, status: "completed" },
      });
    }
    for (const [index, text] of turn.deltas.entries()) {
      if (index > 0 && turn.gapMs !== undefined) await delay(turn.gapMs);
      emit({ type: "timeline", item: { type: "assistant_message", messageId, text } });
    }
    emit({ type: "turn_completed" });
  }

  /** Frames of one type, oldest first — the assertion surface tests use. */
  received(type: string): readonly RecordedDaemonMessage[] {
    return this.messages.filter((message) => message["type"] === type);
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", () => resolve()));
    this.port = (this.server.address() as AddressInfo).port;
  }

  close(): Promise<void> {
    for (const client of this.clients) client.terminate();
    return new Promise((resolve) => {
      this.wss.close(() => this.server.close(() => resolve()));
    });
  }

  private onMessage(client: WebSocket, raw: string): void {
    const frame = JSON.parse(raw) as { type: string; [key: string]: unknown };
    if (frame.type === "hello") {
      this.send(client, {
        type: "status",
        payload: { status: "server_info", serverId: this.options.serverId },
      });
      return;
    }
    if (frame.type === "ping") {
      client.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (frame.type !== "session" || typeof frame["message"] !== "object") return;
    const message = frame["message"] as RecordedDaemonMessage;
    this.messages.push(message);
    this.respond(client, message);
  }

  private send(client: WebSocket, message: unknown): void {
    client.send(JSON.stringify({ type: "session", message }));
  }

  private respond(client: WebSocket, message: RecordedDaemonMessage): void {
    const requestId = message["requestId"];
    const { provider } = this.options;
    switch (message["type"]) {
      case "create_agent_request": {
        const agentId = this.mintAgentId();
        this.send(client, {
          type: "status",
          payload: {
            status: "agent_created",
            requestId,
            agentId,
            agent: { id: agentId, provider, status: "initializing" },
          },
        });
        return;
      }
      case "send_agent_message_request":
        this.send(client, {
          type: "send_agent_message_response",
          payload: { requestId, agentId: message["agentId"], accepted: true },
        });
        return;
      case "fetch_agents_request":
        this.send(client, {
          type: "fetch_agents_response",
          payload: {
            requestId,
            entries: this.createdAgentIds.map((id) => ({
              agent: { id, provider, status: "idle" },
            })),
            pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
          },
        });
        return;
      case "agent.timeline.set_subscription.request":
        this.send(client, {
          type: "agent.timeline.set_subscription.response",
          payload: { agentIds: message["agentIds"], requestId },
        });
        return;
      default:
        this.send(client, {
          type: "rpc_error",
          payload: { requestId, error: `fake daemon: unhandled ${String(message["type"])}` },
        });
    }
  }
}
