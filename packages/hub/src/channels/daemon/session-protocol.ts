// The Hub's half of the daemon session wire, with no transport in it: one map of
// in-flight RPCs and the frame rules that settle them.
//
// Two transports carry the same frames. `ws-client.ts` dials the daemon and
// speaks them over that socket. `enrolled-client.ts` speaks them over the socket the
// Host itself opened to the Hub — the connection a private Host can always
// make, and the one automations already use. Keeping the frame rules here is
// what lets the channel plane above the transport stay identical on both.

import { randomUUID } from "node:crypto";

export interface DaemonSessionFrame {
  type: string;
  [key: string]: unknown;
}

interface PendingRpc {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export interface DaemonSessionProtocolOptions {
  /** Write one serialized frame. Rejecting fails the RPC that wrote it. */
  write(frame: string): Promise<void>;
  rpcTimeoutMs?: number;
  /** The daemon's `server_info` payload: the transport turns this into "connected". */
  onServerInfo?: (payload: Record<string, unknown>) => void;
  onStream?: (payload: { agentId: string; event: unknown; seq?: number }) => void;
  onAgentUpdate?: (agent: unknown) => void;
  /** One `agent.provider_subagents.update` frame, delivered untyped. */
  onSubagentUpdate?: (frame: unknown) => void;
}

const DEFAULT_RPC_TIMEOUT_MS = 30_000;

/** Wrap one session message in the envelope both transports carry. */
export function sessionFrame(message: Record<string, unknown>): string {
  return JSON.stringify({ type: "session", message });
}

export class DaemonSessionProtocol {
  private readonly pending = new Map<string, PendingRpc>();

  constructor(private readonly options: DaemonSessionProtocolOptions) {}

  /**
   * Call a session RPC. Resolves with the matched response payload: a
   * `*_response` frame resolves with its `payload`, a `status` frame (how
   * `create_agent_request` answers) resolves with its `payload`, anything else
   * with the raw frame. Rejects on `rpc_error`, timeout, or a closed transport.
   */
  call(requestType: string, fields: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    const requestId = randomUUID();
    const limit = timeoutMs ?? this.options.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
    const timer = setTimeout(() => {
      this.reject(requestId, new Error(`RPC ${requestType} timed out after ${limit}ms`));
    }, limit);
    timer.unref?.();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, timer });
      void this.options
        .write(sessionFrame({ type: requestType, requestId, ...fields }))
        .catch((error: unknown) => {
          this.reject(requestId, error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  /** Fire-and-forget session message: no daemon reply is correlated. */
  send(message: Record<string, unknown>): Promise<void> {
    return this.options.write(sessionFrame(message));
  }

  /** One inbound session message, already unwrapped from its envelope. */
  receive(message: DaemonSessionFrame): void {
    const type = typeof message["type"] === "string" ? message["type"] : "";
    const payload = message["payload"];
    if (type === "status" && isRecord(payload) && payload["status"] === "server_info") {
      this.options.onServerInfo?.(payload);
      return;
    }
    if (type === "agent_stream") {
      if (isRecord(payload) && typeof payload["agentId"] === "string") {
        this.options.onStream?.({
          agentId: payload["agentId"],
          event: payload["event"],
          ...(typeof payload["seq"] === "number" ? { seq: payload["seq"] } : {}),
        });
      }
      return;
    }
    if (type === "agent_update") {
      if (isRecord(payload) && payload["agent"] !== undefined) {
        this.options.onAgentUpdate?.(payload["agent"]);
      }
      return;
    }
    if (type === "agent.provider_subagents.update") {
      this.options.onSubagentUpdate?.(message);
      return;
    }
    // Response frames carry the correlation id in the payload (stock wire:
    // { type, payload: { requestId, ... } }) — request frames carry it top-level.
    const requestId = isRecord(payload) ? payload["requestId"] : undefined;
    if (typeof requestId !== "string") return;
    this.settle(requestId, message);
  }

  /** Fail every in-flight RPC: a closed transport settles nothing later. */
  rejectAll(error: Error): void {
    const outstanding = Array.from(this.pending.values());
    this.pending.clear();
    for (const entry of outstanding) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  }

  private reject(requestId: string, error: Error): void {
    const entry = this.take(requestId);
    entry?.reject(error);
  }

  private settle(requestId: string, frame: DaemonSessionFrame): void {
    const entry = this.take(requestId);
    if (entry === undefined) return;
    const type = typeof frame["type"] === "string" ? frame["type"] : "";
    if (type === "rpc_error") {
      const payload = isRecord(frame["payload"]) ? frame["payload"] : {};
      entry.reject(new Error(stringOrUndefined(payload["error"]) ?? "daemon RPC error"));
      return;
    }
    const payload = frame["payload"] ?? frame;
    if (type === "status" && isRecord(payload) && payload["status"] === "agent_create_failed") {
      entry.reject(new Error(stringOrUndefined(payload["error"]) ?? "agent create failed"));
      return;
    }
    entry.resolve(payload);
  }

  private take(requestId: string): PendingRpc | undefined {
    const entry = this.pending.get(requestId);
    if (entry === undefined) return undefined;
    this.pending.delete(requestId);
    clearTimeout(entry.timer);
    return entry;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
