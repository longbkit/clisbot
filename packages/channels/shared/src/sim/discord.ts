// Simulated Discord: REST over loopback HTTP + the gateway over loopback ws.
//
// The vertical reaches REST through `RequestClientOptions.baseUrl`
// (`internal/rest.ts:76`, default `https://discord.com/api`), which the client
// joins with `/v{apiVersion}` before every route — so `restUrl` here is the
// bare origin and paths arrive as `/v10/channels/…`. It reaches the gateway
// through `GatewayPluginOptions.url` (`internal/gateway.ts:52`), which
// `ensureGatewayParams` rewrites to carry `?v=10&encoding=json`.
//
// `probe.ts` is NOT reachable this way: `api.ts` hardcodes
// `DISCORD_API_BASE = "https://discord.com/api/v10"` and only takes an injected
// `fetcher`. A test that wants the probe against this sim must pass a fetcher
// that rewrites the origin; the sim serves `/oauth2/applications/@me` so that
// rewrite has something to answer it.
//
// Rate limiting is the part a hand-rolled fake gets wrong. Discord answers 429
// with `{message, retry_after, global}` AND a `retry-after` header, and the
// vertical's scheduler reads `x-ratelimit-bucket` / `-remaining` / `-reset-after`
// off every response to decide when the retry may run
// (`internal/rest-scheduler.ts`). All of them are emitted here.

import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";
import {
  pendingFault,
  sendJson,
  SimRecorder,
  startSimHttpServer,
  waitFor,
  type SimFaultRule,
  type SimHttpServer,
  type SimRequest,
  type SimResponseFault,
} from "./server.js";

export interface SimDiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  content: string;
  author: { id: string; username: string; bot: boolean };
  /** Emoji name → reacting user ids, in the order the reaction route arrived. */
  reactions: Record<string, string[]>;
  pinned: boolean;
  deleted: boolean;
  /** Every previous `content` this id has carried, oldest first. */
  edits: string[];
}

/** One frame the connected gateway client sent, parsed, in arrival order. */
export interface SimDiscordFrame {
  op: number;
  d?: unknown;
  t?: string;
  s?: number;
}

export interface SimDiscordOptions {
  readonly token?: string;
  readonly applicationId?: string;
  readonly botUserId?: string;
  readonly botUsername?: string;
  readonly guildId?: string;
  /** op 10 HELLO `heartbeat_interval`. Short in a test that drives heartbeats. */
  readonly heartbeatIntervalMs?: number;
}

export interface SimDiscord {
  /** Point the vertical here: `requestOptions: { baseUrl: sim.restUrl }`. */
  readonly restUrl: string;
  /** Point the gateway plugin here: `new GatewayPlugin({ url: sim.gatewayUrl })`. */
  readonly gatewayUrl: string;
  readonly token: string;
  readonly applicationId: string;
  readonly botUserId: string;
  readonly recorder: SimRecorder;
  /** Pushes an op 0 dispatch down the newest socket; returns its sequence. */
  deliverDispatch(t: string, d: unknown): number;
  /** Convenience for the commonest inbound: a MESSAGE_CREATE from a human. */
  deliverMessage(params: {
    channelId: string;
    content: string;
    authorId: string;
    guildId?: string;
    messageId?: string;
    authorUsername?: string;
    mentions?: readonly string[];
  }): string;
  /** The `d` of every op 2 IDENTIFY received, oldest first. */
  identifies(): readonly Record<string, unknown>[];
  /** Every gateway frame the client sent — IDENTIFY, RESUME, heartbeats. */
  gatewaySends(): readonly SimDiscordFrame[];
  /** Every REST call, newest last. */
  requests(filter?: string | RegExp | ((request: SimRequest) => boolean)): readonly SimRequest[];
  /** Parsed JSON bodies for one route, e.g. `"/channels/C_SIM/messages"`. */
  calls(path: string | RegExp): readonly Record<string, unknown>[];
  /** Read-back: the transcript of one channel, oldest first. */
  transcript(channelId: string): readonly SimDiscordMessage[];
  /** Read-back: every stored message across every channel, oldest first. */
  messages(): readonly SimDiscordMessage[];
  injectFault(rule: SimFaultRule): void;
  /** Terminates the live gateway connection without a close frame (1006). */
  dropSocket(): void;
  readonly socketCount: number;
  waitForIdentify(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

/** Discord's 429 body, plus every rate-limit header the scheduler reads. */
function discordFaultResponse(fault: SimResponseFault): {
  status: number;
  body: unknown;
  headers: Record<string, string>;
} {
  if (fault.kind === "rate-limit") {
    return {
      status: 429,
      body: {
        message: "You are being rate limited.",
        retry_after: fault.retryAfterSeconds,
        global: false,
        code: 0,
      },
      headers: {
        "retry-after": String(fault.retryAfterSeconds),
        "x-ratelimit-limit": "5",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset-after": String(fault.retryAfterSeconds),
        "x-ratelimit-reset": String(Date.now() / 1_000 + fault.retryAfterSeconds),
        "x-ratelimit-bucket": "sim-bucket",
        "x-ratelimit-scope": "user",
      },
    };
  }
  if (fault.kind === "unauthorized") {
    return { status: 401, body: { message: "401: Unauthorized", code: 0 }, headers: {} };
  }
  const status = fault.status ?? 500;
  return { status, body: { message: `${status}: Server Error`, code: 0 }, headers: {} };
}

/** Headers a healthy response carries, so the scheduler's bucket state is real. */
function rateLimitHeaders(remaining: number): Record<string, string> {
  return {
    "x-ratelimit-limit": "5",
    "x-ratelimit-remaining": String(remaining),
    "x-ratelimit-reset-after": "1",
    "x-ratelimit-bucket": "sim-bucket",
  };
}

/** `/v10/channels/x` → `["channels","x"]`; the emoji segment is percent-encoded. */
function routeSegments(path: string): string[] {
  return path
    .replace(/^\/v\d+/u, "")
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));
}

export async function startDiscordSim(options: SimDiscordOptions = {}): Promise<SimDiscord> {
  const identity = {
    token: options.token ?? "sim.discord.token",
    applicationId: options.applicationId ?? "900000000000000001",
    botUserId: options.botUserId ?? "900000000000000001",
    botUsername: options.botUsername ?? "sim-bot",
    guildId: options.guildId ?? "500000000000000005",
  };
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 41_250;
  const recorder = new SimRecorder();
  const channels = new Map<string, SimDiscordMessage[]>();
  const sockets: WebSocket[] = [];
  const frames: SimDiscordFrame[] = [];
  let snowflake = 300_000_000_000_000_000n;
  let sequence = 0;
  let sessionCounter = 0;

  const nextId = (): string => String((snowflake += 1n));
  const channel = (channelId: string): SimDiscordMessage[] => {
    const existing = channels.get(channelId);
    if (existing) return existing;
    const created: SimDiscordMessage[] = [];
    channels.set(channelId, created);
    return created;
  };
  const findMessage = (channelId: string, id: string): SimDiscordMessage | undefined =>
    channel(channelId).find((message) => message.id === id);

  function apiMessage(message: SimDiscordMessage): unknown {
    return {
      id: message.id,
      type: 0,
      channel_id: message.channel_id,
      ...(message.guild_id === undefined ? {} : { guild_id: message.guild_id }),
      author: {
        id: message.author.id,
        username: message.author.username,
        discriminator: "0",
        global_name: message.author.username,
        avatar: null,
        bot: message.author.bot,
      },
      content: message.content,
      timestamp: new Date().toISOString(),
      edited_timestamp: message.edits.length > 0 ? new Date().toISOString() : null,
      tts: false,
      pinned: message.pinned,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: [],
    };
  }

  function createMessage(channelId: string, body: Record<string, unknown>): SimDiscordMessage {
    const message: SimDiscordMessage = {
      id: nextId(),
      channel_id: channelId,
      content: String(body["content"] ?? ""),
      author: { id: identity.botUserId, username: identity.botUsername, bot: true },
      reactions: {},
      pinned: false,
      deleted: false,
      edits: [],
    };
    channel(channelId).push(message);
    return message;
  }

  /** The whole REST surface, keyed on the version-stripped path segments. */
  function route(
    method: string,
    segments: string[],
    body: Record<string, unknown>,
  ): { status: number; body: unknown } {
    const [root, first, second] = segments;
    if (root === "users" && first === "@me" && second === undefined) {
      return { status: 200, body: botUser() };
    }
    if (root === "users" && first === "@me" && second === "channels") {
      return { status: 200, body: { id: `D_${String(body["recipient_id"] ?? "SIM")}`, type: 1 } };
    }
    if (root === "users" && first !== undefined) {
      return { status: 200, body: { id: first, username: "sim-user", discriminator: "0" } };
    }
    if ((root === "oauth2" && first === "applications") || root === "applications") {
      return { status: 200, body: { id: identity.applicationId, flags: 0, name: "Sim App" } };
    }
    if (root === "gateway") {
      return {
        status: 200,
        body: {
          url: gatewayUrl(),
          shards: 1,
          session_start_limit: { total: 1_000, remaining: 999, reset_after: 0, max_concurrency: 1 },
        },
      };
    }
    if (root === "guilds" && first !== undefined) {
      return { status: 200, body: { id: first, name: "Sim Guild", owner_id: identity.botUserId } };
    }
    if (root === "webhooks") {
      return { status: 200, body: apiMessage(createMessage(`W_${String(first)}`, body)) };
    }
    if (root === "channels" && first !== undefined) {
      return channelRoute(method, first, segments.slice(2), body);
    }
    return { status: 404, body: { message: "404: Not Found", code: 0 } };
  }

  function channelRoute(
    method: string,
    channelId: string,
    rest: readonly string[],
    body: Record<string, unknown>,
  ): { status: number; body: unknown } {
    const [kind, id, sub, emoji, owner] = rest;
    if (kind === undefined) {
      return {
        status: 200,
        body: { id: channelId, type: 0, name: "sim-channel", guild_id: identity.guildId },
      };
    }
    if (kind === "typing") return { status: 204, body: undefined };
    if (kind === "threads") {
      return {
        status: 200,
        body: {
          id: nextId(),
          type: 11,
          parent_id: channelId,
          name: String(body["name"] ?? "sim-thread"),
        },
      };
    }
    if (kind === "webhooks") {
      return {
        status: 200,
        body: { id: nextId(), token: "sim-webhook-token", channel_id: channelId },
      };
    }
    if (kind === "pins") return pinRoute(method, channelId, id);
    if (kind !== "messages") return { status: 404, body: { message: "404: Not Found", code: 0 } };
    if (id === undefined) {
      if (method === "POST")
        return { status: 200, body: apiMessage(createMessage(channelId, body)) };
      // Discord lists a channel newest-first.
      return {
        status: 200,
        body: channel(channelId)
          .filter((message) => !message.deleted)
          .map((message) => apiMessage(message))
          .toReversed(),
      };
    }
    if (sub === "threads") {
      return {
        status: 200,
        body: {
          id: nextId(),
          type: 11,
          parent_id: channelId,
          name: String(body["name"] ?? "sim-thread"),
        },
      };
    }
    if (sub === "reactions") return reactionRoute(method, channelId, id, emoji, owner);
    return messageRoute(method, channelId, id, body);
  }

  function messageRoute(
    method: string,
    channelId: string,
    messageId: string,
    body: Record<string, unknown>,
  ): { status: number; body: unknown } {
    const target = findMessage(channelId, messageId);
    if (target === undefined)
      return { status: 404, body: { message: "Unknown Message", code: 10008 } };
    if (method === "PATCH") {
      target.edits.push(target.content);
      target.content = String(body["content"] ?? target.content);
      return { status: 200, body: apiMessage(target) };
    }
    if (method === "DELETE") {
      target.deleted = true;
      return { status: 204, body: undefined };
    }
    return { status: 200, body: apiMessage(target) };
  }

  function reactionRoute(
    method: string,
    channelId: string,
    messageId: string,
    emoji: string | undefined,
    owner: string | undefined,
  ): { status: number; body: unknown } {
    const target = findMessage(channelId, messageId);
    if (target === undefined)
      return { status: 404, body: { message: "Unknown Message", code: 10008 } };
    const name = emoji ?? "";
    if (method === "GET") {
      return {
        status: 200,
        body: (target.reactions[name] ?? []).map((id) => ({ id, username: "sim-user" })),
      };
    }
    const users = target.reactions[name] ?? [];
    const reactor = owner === "@me" ? identity.botUserId : (owner ?? identity.botUserId);
    if (method === "PUT") {
      if (!users.includes(reactor)) users.push(reactor);
      target.reactions[name] = users;
    } else {
      target.reactions[name] = users.filter((id) => id !== reactor);
    }
    return { status: 204, body: undefined };
  }

  function pinRoute(
    method: string,
    channelId: string,
    messageId: string | undefined,
  ): { status: number; body: unknown } {
    if (messageId === undefined) {
      return {
        status: 200,
        body: channel(channelId)
          .filter((message) => message.pinned)
          .map((message) => apiMessage(message)),
      };
    }
    const target = findMessage(channelId, messageId);
    if (target === undefined)
      return { status: 404, body: { message: "Unknown Message", code: 10008 } };
    target.pinned = method === "PUT";
    return { status: 204, body: undefined };
  }

  function botUser(): unknown {
    return {
      id: identity.botUserId,
      username: identity.botUsername,
      discriminator: "0",
      global_name: identity.botUsername,
      bot: true,
      avatar: null,
    };
  }

  const http: SimHttpServer = await startSimHttpServer({
    recorder,
    handler: (request, { response }) => {
      const fault = pendingFault(request);
      if (fault !== undefined && fault.kind !== "socket-drop") {
        const rendered = discordFaultResponse(fault);
        sendJson(response, rendered.status, rendered.body, rendered.headers);
        return;
      }
      const result = route(
        request.method,
        routeSegments(request.path),
        (request.body ?? {}) as Record<string, unknown>,
      );
      if (result.status === 204) {
        response.writeHead(204, rateLimitHeaders(4));
        response.end();
        return;
      }
      sendJson(response, result.status, result.body, rateLimitHeaders(4));
    },
    onUpgrade: (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (client) => wss.emit("connection", client, request));
    },
  });

  const gatewayUrl = (): string => `${http.wsBaseUrl}/gateway`;

  function push(socket: WebSocket, payload: Record<string, unknown>): void {
    socket.send(JSON.stringify(payload));
  }

  /** op 0 READY: `session_id` and `resume_gateway_url` are what a RESUME needs. */
  function sendReady(socket: WebSocket): void {
    sessionCounter += 1;
    sequence += 1;
    push(socket, {
      op: 0,
      s: sequence,
      t: "READY",
      d: {
        v: 10,
        user: botUser(),
        guilds: [{ id: identity.guildId, unavailable: true }],
        session_id: `sim-session-${sessionCounter}`,
        resume_gateway_url: gatewayUrl(),
        application: { id: identity.applicationId, flags: 0 },
      },
    });
  }

  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (socket: WebSocket) => {
    sockets.push(socket);
    socket.on("message", (data) => {
      const frame = JSON.parse(String(data)) as SimDiscordFrame;
      frames.push(frame);
      // op 2 IDENTIFY → READY; op 6 RESUME → RESUMED; op 1 HEARTBEAT → op 11 ACK.
      if (frame.op === 2) sendReady(socket);
      if (frame.op === 6) {
        sequence += 1;
        push(socket, { op: 0, s: sequence, t: "RESUMED", d: {} });
      }
      if (frame.op === 1) push(socket, { op: 11 });
    });
    socket.once("close", () => {
      const index = sockets.indexOf(socket);
      if (index >= 0) sockets.splice(index, 1);
    });
    push(socket, { op: 10, d: { heartbeat_interval: heartbeatIntervalMs } });
  });

  function deliverDispatch(t: string, d: unknown): number {
    sequence += 1;
    const socket = sockets.at(-1);
    if (socket !== undefined) push(socket, { op: 0, s: sequence, t, d });
    return sequence;
  }

  return {
    restUrl: http.baseUrl,
    gatewayUrl: gatewayUrl(),
    token: identity.token,
    applicationId: identity.applicationId,
    botUserId: identity.botUserId,
    recorder,
    deliverDispatch,
    deliverMessage(params) {
      const id = params.messageId ?? nextId();
      deliverDispatch("MESSAGE_CREATE", {
        id,
        channel_id: params.channelId,
        ...(params.guildId === undefined ? {} : { guild_id: params.guildId }),
        author: {
          id: params.authorId,
          username: params.authorUsername ?? "sim-sender",
          discriminator: "0",
          global_name: params.authorUsername ?? "Sim Sender",
          avatar: null,
        },
        content: params.content,
        timestamp: new Date().toISOString(),
        edited_timestamp: null,
        mentions: (params.mentions ?? []).map((userId) => ({ id: userId })),
        mention_roles: [],
        mention_everyone: false,
        attachments: [],
        embeds: [],
        type: 0,
        pinned: false,
        tts: false,
      });
      return id;
    },
    identifies: () =>
      frames
        .filter((frame) => frame.op === 2)
        .map((frame) => (frame.d ?? {}) as Record<string, unknown>),
    gatewaySends: () => [...frames],
    requests: (filter) => recorder.requests(filter),
    calls: (path) =>
      recorder.requests(path).map((request) => (request.body ?? {}) as Record<string, unknown>),
    transcript: (channelId) => [...channel(channelId)],
    messages: () => [...channels.values()].flat(),
    injectFault: (rule) => recorder.injectFault(rule),
    dropSocket() {
      sockets.at(-1)?.terminate();
    },
    get socketCount() {
      return sockets.length;
    },
    waitForIdentify: (timeoutMs) =>
      waitFor(() => frames.some((frame) => frame.op === 2), {
        what: "the Discord gateway IDENTIFY",
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      }),
    async close() {
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await http.close();
    },
  };
}
