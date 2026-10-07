import { createHash } from "node:crypto";
import type { Logger } from "pino";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { stdioServerEnv } from "./connector-env.js";
import type { JsonRpcFrame, UpstreamTarget } from "./connector-upstream.js";
import {
  CLISBOT_MCP_IMPLEMENTATION,
  DEFAULT_PROTOCOL_VERSION,
  isRecord,
} from "./connector-json.js";
import { withTimeout } from "../../utils/promise-timeout.js";

/**
 * The person's local (stdio) MCP servers, run by the daemon (docs/features/connectors/README.md,
 * "Runtime"). The agent reaches them through the relay like a remote server, so each call is
 * checked against the session's grant, a paused server stops at once, sends wait for approval, and
 * the server's variables stay out of the agent's config. Its environment is `connector-env.ts`. One process per server and Project, started
 * on first use in the Project's folder, stopped after ten idle minutes or when its settings change.
 */

const IDLE_MS = 10 * 60_000;
const START_TIMEOUT_MS = 60_000;
const STDERR_TAIL_LINES = 20;
/** How long a server gets to exit after its stdin closes (the SDK sends SIGTERM after 2 s). */
const CLOSE_WAIT_MS = 3_000;

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface StdioServerSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

interface Pending {
  resolve(frame: JsonRpcFrame): void;
  reject(error: Error): void;
}

class StdioServerProcess {
  private readonly transport: StdioClientTransport;
  private readonly pending = new Map<number, Pending>();
  private readonly stderrTail: string[] = [];
  private nextId = 1;
  private closed = false;
  readonly ready: Promise<JsonRpcFrame>;

  constructor(
    spec: StdioServerSpec,
    private readonly label: string,
  ) {
    this.transport = new StdioClientTransport({
      command: spec.command,
      args: spec.args,
      env: stdioServerEnv(spec.env),
      ...(spec.cwd ? { cwd: spec.cwd } : {}),
      stderr: "pipe",
    });
    this.transport.stderr?.on("data", (chunk: Buffer) => this.keepStderr(chunk));
    // The MCP SDK transport takes callback properties; it has no event API.
    // eslint-disable-next-line unicorn/prefer-add-event-listener
    this.transport.onmessage = (message) => this.settle(message);
    // eslint-disable-next-line unicorn/prefer-add-event-listener
    this.transport.onclose = () => this.fail(`${label} stopped${this.stderrSummary()}.`);
    // A line that is not JSON-RPC (a banner or log on stdout) reaches `onerror` and the SDK reads
    // on; the process ending reaches `onclose`. So an error is kept for the summary, never fatal.
    // eslint-disable-next-line unicorn/prefer-add-event-listener
    this.transport.onerror = (error) => this.keepStderr(Buffer.from(error.message));
    this.ready = this.start();
    this.ready.catch(() => {
      this.closed = true;
      void this.transport.close().catch(() => undefined);
    });
  }

  get alive(): boolean {
    return !this.closed;
  }

  private async start(): Promise<JsonRpcFrame> {
    await this.transport.start();
    const answer = await this.request(
      "initialize",
      {
        protocolVersion: DEFAULT_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLISBOT_MCP_IMPLEMENTATION,
      },
      AbortSignal.timeout(START_TIMEOUT_MS),
    );
    if (!isRecord(answer.result)) throw new Error(`${this.label} did not start an MCP session.`);
    await this.transport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return answer.result;
  }

  private keepStderr(chunk: Buffer): void {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      this.stderrTail.push(line.slice(0, 300));
      if (this.stderrTail.length > STDERR_TAIL_LINES) this.stderrTail.shift();
    }
  }

  private stderrSummary(): string {
    const last = this.stderrTail.at(-1);
    return last ? `: ${last}` : "";
  }

  /**
   * An answer settles the call with its id. A request the server sends (a `ping`, `roots/list`)
   * has its own ids, which can equal ours, so it is answered here and never taken for an answer.
   */
  private settle(message: JSONRPCMessage): void {
    const frame = message as unknown as JsonRpcFrame;
    if (typeof frame.method === "string") {
      if (frame.id !== undefined) void this.answerServerRequest(frame);
      return;
    }
    if (typeof frame.id !== "number") return;
    const waiting = this.pending.get(frame.id);
    if (!waiting) return;
    this.pending.delete(frame.id);
    waiting.resolve(frame);
  }

  private async answerServerRequest(frame: JsonRpcFrame): Promise<void> {
    const id = frame.id as string | number;
    const answer: JSONRPCMessage =
      frame.method === "ping"
        ? { jsonrpc: "2.0", id, result: {} }
        : {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `${frame.method} is not offered.` },
          };
    await this.transport.send(answer).catch(() => undefined);
  }

  private fail(reason: string): void {
    this.closed = true;
    for (const waiting of this.pending.values()) waiting.reject(new Error(reason));
    this.pending.clear();
  }

  /** One request; the answer frame carries the server's own id, which the caller replaces. */
  request(method: string, params: unknown, signal: AbortSignal): Promise<JsonRpcFrame> {
    if (this.closed) return Promise.reject(new Error(`${this.label} is not running.`));
    const id = this.nextId++;
    return new Promise<JsonRpcFrame>((resolve, reject) => {
      const onAbort = () => {
        this.pending.delete(id);
        reject(new Error(`${this.label} did not answer in time.`));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve: (frame) => {
          signal.removeEventListener("abort", onAbort);
          resolve(frame);
        },
        reject,
      });
      const frame = { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
      this.transport.send(frame as JSONRPCMessage).catch((error: unknown) => {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  notify(method: string, params: unknown): void {
    if (this.closed) return;
    const frame = { jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) };
    void this.transport.send(frame as JSONRPCMessage).catch(() => undefined);
  }

  /**
   * Closes stdin and waits a bounded time; a server still running after that is killed, so none
   * outlives the daemon holding its secrets.
   */
  async close(): Promise<void> {
    this.closed = true;
    const pid = this.transport.pid;
    const closing = this.transport.close().catch(() => undefined);
    await withTimeout(closing, CLOSE_WAIT_MS, "server still exiting").catch(() => undefined);
    if (pid !== null && isRunning(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // It exited between the check and the kill.
      }
    }
  }
}

function json(frame: unknown, status = 200): Response {
  return new Response(JSON.stringify(frame), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Running {
  process: StdioServerProcess;
  /** The settings it started with; changed settings start a new process. */
  digest: string;
  idle: NodeJS.Timeout;
}

export function createStdioServers(params: { logger: Logger }) {
  const logger = params.logger.child({ module: "connectors-stdio" });
  const running = new Map<string, Running>();

  function stop(key: string): Promise<void> {
    const current = running.get(key);
    if (!current) return Promise.resolve();
    running.delete(key);
    clearTimeout(current.idle);
    return current.process.close();
  }

  function processFor(input: {
    key: string;
    digest: string;
    spec: StdioServerSpec;
    label: string;
  }): StdioServerProcess {
    const current = running.get(input.key);
    if (current?.process.alive && current.digest === input.digest) {
      current.idle.refresh();
      return current.process;
    }
    void stop(input.key);
    const process = new StdioServerProcess(input.spec, input.label);
    const idle = setTimeout(() => void stop(input.key), IDLE_MS);
    idle.unref();
    running.set(input.key, { process, digest: input.digest, idle });
    logger.info({ label: input.label, command: input.spec.command }, "Started a local MCP server");
    return process;
  }

  async function answer(
    process: StdioServerProcess,
    frame: JsonRpcFrame,
    signal: AbortSignal,
  ): Promise<Response> {
    if (frame.method === "initialize") {
      return json({ jsonrpc: "2.0", id: frame.id, result: await process.ready });
    }
    await process.ready;
    if (frame.id === undefined) {
      if (frame.method !== "notifications/initialized") {
        process.notify(String(frame.method), frame.params);
      }
      return new Response(null, { status: 202 });
    }
    const reply = await process.request(String(frame.method), frame.params, signal);
    return json({ ...reply, id: frame.id });
  }

  return {
    /** An upstream that runs one stdio server for one owner (a Project), started on first use. */
    target(input: { name: string; owner: string; spec: StdioServerSpec }): UpstreamTarget {
      const digest = createHash("sha256").update(JSON.stringify(input.spec)).digest("hex");
      const key = `${input.name}\u0000${input.owner}`;
      const label = `The MCP server "${input.name}"`;
      return {
        key: `stdio:${key}:${digest.slice(0, 16)}`,
        label,
        post: async ({ body, signal }) => {
          const frame: unknown = JSON.parse(body);
          if (!isRecord(frame)) throw new Error("Send one JSON-RPC message.");
          return answer(processFor({ key, digest, spec: input.spec, label }), frame, signal);
        },
      };
    },

    /** Stops a server's processes in every Project, after its settings changed or it was removed. */
    async stopServer(name: string): Promise<void> {
      const keys = [...running.keys()].filter((key) => key.startsWith(`${name}\u0000`));
      await Promise.all(keys.map((key) => stop(key)));
    },

    /** Stops every local server and waits until each has exited or been killed. */
    async stopAll(): Promise<void> {
      await Promise.all([...running.keys()].map((key) => stop(key)));
    },
  };
}

export type StdioServers = ReturnType<typeof createStdioServers>;
