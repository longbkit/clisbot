// In-process simulated chat platforms: the machinery every family shares.
//
// The verticals talk to their platform over HTTP (and, for Slack/Discord, a
// WebSocket). A sim boots a real loopback `node:http` server and points the
// vertical at it, so the SDK's own transport, retry and rate-limit handling run
// for real. That is the tier the 2026-08-26 lesson calls "real both sides":
// unit tests with a fake on each side of a seam never exercise the seam.
//
// Two things every family needs and no unit fake has:
//   - a request log, so a test asserts what the vertical actually sent;
//   - fault injection, so 429 / 401 / 5xx / socket drop are reachable without
//     a live account.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";

/** One recorded inbound call to the sim, in arrival order. */
export interface SimRequest {
  /** Milliseconds since the sim started, so ordering and backoff are legible. */
  readonly at: number;
  readonly method: string;
  /** Pathname only; the query is parsed out. */
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  /** Parsed JSON or form body when the content type says so, else undefined. */
  readonly body: unknown;
  readonly rawBody: string;
}

/** A platform-independent failure. Each family renders it in its own wire shape. */
export type SimFault =
  | { readonly kind: "rate-limit"; readonly retryAfterSeconds: number }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "server-error"; readonly status?: number }
  /** Closes the HTTP socket without a response (or drops the live WebSocket). */
  | { readonly kind: "socket-drop" };

/** Faults a family router must render into its own wire shape. `socket-drop`
 * is handled centrally by the HTTP server, so it never reaches a router. */
export type SimResponseFault = Exclude<SimFault, { kind: "socket-drop" }>;

export interface SimFaultRule {
  /** Substring of the path, a regexp over it, or a full predicate. */
  readonly match: string | RegExp | ((request: SimRequest) => boolean);
  readonly fault: SimFault;
  /** How many matching requests the fault applies to. Default 1. */
  readonly times?: number;
}

function matchesRule(rule: SimFaultRule, request: SimRequest): boolean {
  if (typeof rule.match === "function") return rule.match(request);
  if (rule.match instanceof RegExp) return rule.match.test(request.path);
  return request.path.includes(rule.match);
}

/**
 * The request log plus the fault queue. Shared by every family so a test reads
 * the same way whichever platform it drives.
 */
export class SimRecorder {
  private readonly startedAt = Date.now();
  private readonly log: SimRequest[] = [];
  private readonly faults: Array<{ rule: SimFaultRule; remaining: number }> = [];

  record(request: Omit<SimRequest, "at">): SimRequest {
    const entry: SimRequest = { ...request, at: Date.now() - this.startedAt };
    this.log.push(entry);
    return entry;
  }

  /** Every recorded request, optionally narrowed the same way a rule matches. */
  requests(filter?: string | RegExp | ((request: SimRequest) => boolean)): readonly SimRequest[] {
    if (filter === undefined) return [...this.log];
    return this.log.filter((request) =>
      matchesRule({ match: filter, fault: { kind: "unauthorized" } }, request),
    );
  }

  count(filter: string | RegExp | ((request: SimRequest) => boolean)): number {
    return this.requests(filter).length;
  }

  /** Queues a fault. Rules are consumed in insertion order, first match wins. */
  injectFault(rule: SimFaultRule): void {
    this.faults.push({ rule, remaining: rule.times ?? 1 });
  }

  /** Pops the fault owed to this request, if any. */
  takeFault(request: SimRequest): SimFault | undefined {
    for (let index = 0; index < this.faults.length; index += 1) {
      const entry = this.faults[index];
      if (entry === undefined || !matchesRule(entry.rule, request)) continue;
      entry.remaining -= 1;
      if (entry.remaining <= 0) this.faults.splice(index, 1);
      return entry.rule.fault;
    }
    return undefined;
  }

  /** Faults queued but never triggered — an assertion a test should make. */
  pendingFaults(): number {
    return this.faults.length;
  }

  clear(): void {
    this.log.length = 0;
    this.faults.length = 0;
  }
}

export type SimHandler = (
  request: SimRequest,
  raw: { readonly request: IncomingMessage; readonly response: ServerResponse },
) => void | Promise<void>;

export interface SimHttpServer {
  readonly server: Server;
  readonly baseUrl: string;
  readonly port: number;
  /** `ws://…` form of `baseUrl`, for the families that upgrade. */
  readonly wsBaseUrl: string;
  close(): Promise<void>;
}

const JSON_TYPES = ["application/json", "text/json"];

function parseBody(rawBody: string, contentType: string): unknown {
  if (rawBody.length === 0) return undefined;
  if (JSON_TYPES.some((type) => contentType.includes(type))) {
    try {
      return JSON.parse(rawBody) as unknown;
    } catch {
      return undefined;
    }
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(rawBody));
  }
  return undefined;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

/**
 * Boots a loopback HTTP server and hands every request to `handler` already
 * parsed and recorded. `socket-drop` is applied here because it is the one
 * fault that has no response body.
 */
export async function startSimHttpServer(params: {
  readonly recorder: SimRecorder;
  readonly handler: SimHandler;
  /** Called for `upgrade`, so a family can attach its own WebSocket server. */
  readonly onUpgrade?: (request: IncomingMessage, socket: Socket, head: Buffer) => void;
}): Promise<SimHttpServer> {
  const transports = new Set<Socket>();
  const server = createServer((request, response) => {
    void (async () => {
      const rawBody = await readBody(request);
      const url = new URL(request.url ?? "/", "http://sim.local");
      const recorded = params.recorder.record({
        method: request.method ?? "GET",
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([key, value]) => [
            key,
            Array.isArray(value) ? value.join(",") : (value ?? ""),
          ]),
        ),
        body: parseBody(rawBody, String(request.headers["content-type"] ?? "")),
        rawBody,
      });
      // Handled centrally: a dropped socket never reaches a family router.
      const fault = params.recorder.takeFault(recorded);
      if (fault?.kind === "socket-drop") {
        request.socket.destroy();
        return;
      }
      await params.handler(withFault(recorded, fault), { request, response });
    })().catch((error: unknown) => {
      if (response.writableEnded) return;
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: String(error) }));
    });
  });
  server.on("connection", (socket) => {
    transports.add(socket);
    socket.once("close", () => transports.delete(socket));
  });
  if (params.onUpgrade) server.on("upgrade", params.onUpgrade);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    wsBaseUrl: `ws://127.0.0.1:${port}`,
    async close() {
      for (const socket of transports) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** The fault a family router must render, carried alongside the request. */
const FAULT = Symbol.for("@getpaseo/channels-shared/sim-fault");

function withFault(request: SimRequest, fault: SimFault | undefined): SimRequest {
  if (fault === undefined) return request;
  return Object.assign(
    Object.create(Object.getPrototypeOf(request) as object) as SimRequest,
    request,
    {
      [FAULT]: fault,
    },
  );
}

export function pendingFault(request: SimRequest): SimFault | undefined {
  return (request as unknown as Record<symbol, SimFault | undefined>)[FAULT];
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

/**
 * Polls `condition` until it holds. Sims are real servers, so a test must wait
 * on an observable effect rather than a fixed sleep, which is the flake source
 * `docs/testing.md` bans.
 */
export async function waitFor(
  condition: () => boolean,
  params: { readonly timeoutMs?: number; readonly what: string },
): Promise<void> {
  const deadline = Date.now() + (params.timeoutMs ?? 5_000);
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`sim timed out waiting for ${params.what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
