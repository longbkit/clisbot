// Simulated Slack: Web API over loopback HTTP + Socket Mode over loopback ws.
//
// The vertical reaches it through `SLACK_API_URL` (`client-options.ts:100`),
// which `@slack/web-api` and `@slack/socket-mode` both honour, so the real SDK
// transports run against this server.
//
// It keeps a per-conversation transcript so a test reads a reply back the way
// the live scenarios do (`conversations.history` / `conversations.replies`),
// instead of asserting on the request it just made.

import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";
import {
  pendingFault,
  sendJson,
  SimRecorder,
  startSimHttpServer,
  waitFor,
  type SimResponseFault,
  type SimFaultRule,
  type SimHttpServer,
  type SimRequest,
} from "./server.js";

export interface SimSlackMessage {
  ts: string;
  thread_ts?: string;
  channel: string;
  text: string;
  user: string;
  bot_id?: string;
  blocks?: unknown;
  /** Reaction name → reacting user ids, in the order `reactions.add` arrived. */
  reactions: Record<string, string[]>;
  pinned: boolean;
  deleted: boolean;
  /** Every `chat.update` text this ts has carried, oldest first. */
  edits: string[];
}

export interface SimSlackOptions {
  readonly botToken?: string;
  readonly appToken?: string;
  readonly botUserId?: string;
  readonly botId?: string;
  readonly teamId?: string;
  readonly appId?: string;
  readonly scopes?: readonly string[];
}

export interface SimSlack {
  /** Point the vertical here: `process.env.SLACK_API_URL = sim.apiUrl`. */
  readonly apiUrl: string;
  readonly botToken: string;
  readonly appToken: string;
  readonly botUserId: string;
  readonly botId: string;
  readonly teamId: string;
  readonly appId: string;
  readonly recorder: SimRecorder;
  /** Pushes an `events_api` envelope down the newest socket; returns its id. */
  deliverEvent(event: Record<string, unknown>): string;
  /** Convenience for the commonest inbound: a channel message mentioning the bot. */
  deliverMention(params: {
    channel: string;
    text: string;
    user: string;
    threadTs?: string;
    ts?: string;
  }): string;
  deliverSlashCommand(payload: Record<string, unknown>): string;
  deliverInteraction(payload: Record<string, unknown>): string;
  /** Envelope acks the vertical sent back, in order. */
  acks(): readonly Record<string, unknown>[];
  /** Every Web API call, newest last. */
  requests(filter?: string | RegExp | ((request: SimRequest) => boolean)): readonly SimRequest[];
  /** Parsed argument objects for one Web API method, e.g. `"chat.postMessage"`. */
  calls(method: string): readonly Record<string, unknown>[];
  /** Read-back: the transcript of a conversation, oldest first. */
  transcript(channel: string): readonly SimSlackMessage[];
  /** Read-back: one thread, root first. */
  thread(channel: string, threadTs: string): readonly SimSlackMessage[];
  injectFault(rule: SimFaultRule): void;
  /** Terminates the live Socket Mode connection without a close frame. */
  dropSocket(): void;
  readonly socketCount: number;
  readonly openCount: number;
  waitForSocket(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

const DEFAULT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "chat:write",
  "files:write",
  "groups:history",
  "im:history",
  "pins:write",
  "reactions:write",
  "users:read",
];

/** Slack renders every failure as HTTP 200 `{ok:false}` except 429 and 5xx. */
function slackFaultResponse(fault: SimResponseFault): {
  status: number;
  body: unknown;
  headers: Record<string, string>;
} {
  if (fault.kind === "rate-limit") {
    return {
      status: 429,
      body: { ok: false, error: "ratelimited" },
      headers: { "retry-after": String(fault.retryAfterSeconds) },
    };
  }
  if (fault.kind === "unauthorized")
    return { status: 200, body: { ok: false, error: "invalid_auth" }, headers: {} };
  return { status: fault.status ?? 500, body: { ok: false, error: "internal_error" }, headers: {} };
}

/** Form-encoded Slack args carry `blocks`/`attachments` as JSON strings. */
function slackArgs(request: SimRequest): Record<string, unknown> {
  const body = request.body;
  if (body === null || typeof body !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (typeof value === "string" && (value.startsWith("[") || value.startsWith("{"))) {
      try {
        out[key] = JSON.parse(value) as unknown;
        continue;
      } catch {
        /* not JSON after all */
      }
    }
    out[key] = value;
  }
  return out;
}

export async function startSlackSim(options: SimSlackOptions = {}): Promise<SimSlack> {
  const identity = {
    botToken: options.botToken ?? "xoxb-sim-000000000000",
    appToken: options.appToken ?? "xapp-sim-000000000000",
    botUserId: options.botUserId ?? "U_SIM_BOT",
    botId: options.botId ?? "B_SIM_BOT",
    teamId: options.teamId ?? "T_SIM",
    appId: options.appId ?? "A_SIM",
    scopes: options.scopes ?? DEFAULT_SCOPES,
  };
  const recorder = new SimRecorder();
  const conversations = new Map<string, SimSlackMessage[]>();
  const sockets: WebSocket[] = [];
  const acks: Record<string, unknown>[] = [];
  let openCount = 0;
  let tsCounter = 1_788_000_000;
  let envelopeCounter = 0;

  const nextTs = (): string => `${(tsCounter += 1)}.${String(openCount).padStart(6, "0")}`;
  const conversation = (channel: string): SimSlackMessage[] => {
    const existing = conversations.get(channel);
    if (existing) return existing;
    const created: SimSlackMessage[] = [];
    conversations.set(channel, created);
    return created;
  };
  const findMessage = (channel: string, ts: string): SimSlackMessage | undefined =>
    conversation(channel).find((message) => message.ts === ts);

  const http: SimHttpServer = await startSimHttpServer({
    recorder,
    handler: (request, { response }) => {
      const fault = pendingFault(request);
      if (fault !== undefined && fault.kind !== "socket-drop") {
        const rendered = slackFaultResponse(fault);
        sendJson(response, rendered.status, rendered.body, rendered.headers);
        return;
      }
      const method = request.path.replace(/^.*\/api\//u, "");
      const args = slackArgs(request);
      sendJson(response, 200, route(method, args));
    },
    onUpgrade: (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (client) => wss.emit("connection", client, request));
    },
  });

  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (socket: WebSocket) => {
    sockets.push(socket);
    socket.on("message", (data) => {
      acks.push(JSON.parse(String(data)) as Record<string, unknown>);
    });
    socket.once("close", () => {
      const index = sockets.indexOf(socket);
      if (index >= 0) sockets.splice(index, 1);
    });
    socket.send(
      JSON.stringify({
        type: "hello",
        num_connections: 1,
        connection_info: { app_id: identity.appId },
      }),
    );
  });

  // One faithful Web API router: splitting it by method family would hide the
  // wire surface this file exists to state.
  // eslint-disable-next-line complexity
  function route(method: string, args: Record<string, unknown>): unknown {
    switch (method) {
      case "apps.connections.open":
        openCount += 1;
        return { ok: true, url: `${http.wsBaseUrl}/socket?app=${identity.appId}` };
      case "auth.test":
        return {
          ok: true,
          url: `${http.baseUrl}/`,
          team: "Sim Workspace",
          team_id: identity.teamId,
          user: "sim-bot",
          user_id: identity.botUserId,
          bot_id: identity.botId,
        };
      case "bots.info":
        return {
          ok: true,
          bot: { id: identity.botId, app_id: identity.appId, user_id: identity.botUserId },
        };
      case "auth.teams.list":
        return { ok: true, teams: [{ id: identity.teamId, name: "Sim Workspace" }] };
      case "chat.postMessage":
      case "chat.postEphemeral":
        return postMessage(args);
      case "chat.update":
        return updateMessage(args);
      case "chat.delete":
        return deleteMessage(args);
      case "reactions.add":
        return addReaction(args);
      case "reactions.remove":
        return removeReaction(args);
      case "reactions.get":
        return getReactions(args);
      case "pins.add":
        return setPinned(args, true);
      case "pins.remove":
        return setPinned(args, false);
      case "pins.list":
        return listPins(args);
      case "conversations.history":
        return historyResponse(args, (message) => message.thread_ts === undefined);
      case "conversations.replies":
        return historyResponse(
          args,
          (message) => message.thread_ts === args["ts"] || message.ts === args["ts"],
        );
      case "conversations.info":
        return {
          ok: true,
          channel: { id: String(args["channel"] ?? ""), name: "sim-channel", is_im: false },
        };
      case "conversations.open":
        return { ok: true, channel: { id: `D_${String(args["users"] ?? "SIM")}` } };
      case "users.info":
        return {
          ok: true,
          user: {
            id: String(args["user"] ?? ""),
            name: "sim-user",
            real_name: "Sim User",
            is_bot: false,
          },
        };
      case "emoji.list":
        return { ok: true, emoji: { sim_wave: "https://sim.local/wave.png" } };
      case "files.getUploadURLExternal":
        return {
          ok: true,
          upload_url: `${http.baseUrl}/upload/sim`,
          file_id: `F_SIM_${openCount}`,
        };
      case "files.completeUploadExternal":
        return {
          ok: true,
          files: [{ id: `F_SIM_${openCount}`, title: String(args["title"] ?? "sim") }],
        };
      default:
        return { ok: false, error: "unknown_method" };
    }
  }

  function postMessage(args: Record<string, unknown>): unknown {
    const channel = String(args["channel"] ?? "");
    const threadTs = args["thread_ts"] === undefined ? undefined : String(args["thread_ts"]);
    const message: SimSlackMessage = {
      ts: nextTs(),
      ...(threadTs === undefined ? {} : { thread_ts: threadTs }),
      channel,
      text: String(args["text"] ?? ""),
      user: identity.botUserId,
      bot_id: identity.botId,
      ...(args["blocks"] === undefined ? {} : { blocks: args["blocks"] }),
      reactions: {},
      pinned: false,
      deleted: false,
      edits: [],
    };
    conversation(channel).push(message);
    return { ok: true, channel, ts: message.ts, message: { text: message.text, ts: message.ts } };
  }

  function updateMessage(args: Record<string, unknown>): unknown {
    const channel = String(args["channel"] ?? "");
    const target = findMessage(channel, String(args["ts"] ?? ""));
    if (target === undefined) return { ok: false, error: "message_not_found" };
    target.edits.push(target.text);
    target.text = String(args["text"] ?? "");
    if (args["blocks"] !== undefined) target.blocks = args["blocks"];
    return { ok: true, channel, ts: target.ts, text: target.text };
  }

  function deleteMessage(args: Record<string, unknown>): unknown {
    const channel = String(args["channel"] ?? "");
    const target = findMessage(channel, String(args["ts"] ?? ""));
    if (target === undefined) return { ok: false, error: "message_not_found" };
    target.deleted = true;
    return { ok: true, channel, ts: target.ts };
  }

  function addReaction(args: Record<string, unknown>): unknown {
    const target = findMessage(String(args["channel"] ?? ""), String(args["timestamp"] ?? ""));
    if (target === undefined) return { ok: false, error: "message_not_found" };
    const name = String(args["name"] ?? "");
    const users = target.reactions[name] ?? [];
    if (users.includes(identity.botUserId)) return { ok: false, error: "already_reacted" };
    users.push(identity.botUserId);
    target.reactions[name] = users;
    return { ok: true };
  }

  function removeReaction(args: Record<string, unknown>): unknown {
    const target = findMessage(String(args["channel"] ?? ""), String(args["timestamp"] ?? ""));
    if (target === undefined) return { ok: false, error: "message_not_found" };
    delete target.reactions[String(args["name"] ?? "")];
    return { ok: true };
  }

  function getReactions(args: Record<string, unknown>): unknown {
    const target = findMessage(String(args["channel"] ?? ""), String(args["timestamp"] ?? ""));
    if (target === undefined) return { ok: false, error: "message_not_found" };
    return {
      ok: true,
      message: {
        ts: target.ts,
        reactions: Object.entries(target.reactions).map(([name, users]) => ({
          name,
          users,
          count: users.length,
        })),
      },
    };
  }

  function setPinned(args: Record<string, unknown>, pinned: boolean): unknown {
    const target = findMessage(String(args["channel"] ?? ""), String(args["timestamp"] ?? ""));
    if (target === undefined) return { ok: false, error: "message_not_found" };
    target.pinned = pinned;
    return { ok: true };
  }

  function listPins(args: Record<string, unknown>): unknown {
    const channel = String(args["channel"] ?? "");
    return {
      ok: true,
      items: conversation(channel)
        .filter((message) => message.pinned)
        .map((message) => ({ type: "message", message: { ts: message.ts, text: message.text } })),
    };
  }

  /** One `conversations.history` row. Optional keys are assigned, not spread:
   * a spread per message allocates a new object on every iteration. */
  function historyRow(message: SimSlackMessage): Record<string, unknown> {
    const row: Record<string, unknown> = {
      type: "message",
      ts: message.ts,
      text: message.text,
      user: message.user,
    };
    if (message.bot_id !== undefined) row["bot_id"] = message.bot_id;
    if (message.thread_ts !== undefined) row["thread_ts"] = message.thread_ts;
    return row;
  }

  function historyResponse(
    args: Record<string, unknown>,
    keep: (message: SimSlackMessage) => boolean,
  ): unknown {
    const channel = String(args["channel"] ?? "");
    return {
      ok: true,
      has_more: false,
      messages: conversation(channel)
        .filter((message) => !message.deleted && keep(message))
        .map((message) => historyRow(message)),
    };
  }

  function pushEnvelope(type: string, payload: Record<string, unknown>): string {
    envelopeCounter += 1;
    const envelopeId = `env-${envelopeCounter}`;
    sockets.at(-1)?.send(
      JSON.stringify({
        envelope_id: envelopeId,
        type,
        accepts_response_payload: false,
        retry_attempt: 0,
        retry_reason: "",
        payload,
      }),
    );
    return envelopeId;
  }

  function deliverEvent(event: Record<string, unknown>): string {
    return pushEnvelope("events_api", {
      token: "sim",
      team_id: identity.teamId,
      api_app_id: identity.appId,
      type: "event_callback",
      event_id: `Ev${envelopeCounter + 1}`,
      event_time: Math.floor(Date.now() / 1000),
      authorizations: [
        {
          enterprise_id: null,
          team_id: identity.teamId,
          user_id: identity.botUserId,
          is_bot: true,
        },
      ],
      event,
    });
  }

  function deliverMention(params: {
    channel: string;
    text: string;
    user: string;
    threadTs?: string;
    ts?: string;
  }): string {
    return deliverEvent({
      type: "message",
      channel: params.channel,
      channel_type: "channel",
      user: params.user,
      text: params.text,
      ts: params.ts ?? nextTs(),
      ...(params.threadTs === undefined ? {} : { thread_ts: params.threadTs }),
      team: identity.teamId,
      blocks: [
        {
          type: "rich_text",
          elements: [
            { type: "rich_text_section", elements: [{ type: "text", text: params.text }] },
          ],
        },
      ],
    });
  }

  return {
    apiUrl: `${http.baseUrl}/api/`,
    botToken: identity.botToken,
    appToken: identity.appToken,
    botUserId: identity.botUserId,
    botId: identity.botId,
    teamId: identity.teamId,
    appId: identity.appId,
    recorder,
    deliverEvent,
    deliverMention,
    deliverSlashCommand: (payload) =>
      pushEnvelope("slash_commands", { team_id: identity.teamId, ...payload }),
    deliverInteraction: (payload) =>
      pushEnvelope("interactive", { team: { id: identity.teamId }, ...payload }),
    acks: () => [...acks],
    requests: (filter) => recorder.requests(filter),
    calls: (method) => recorder.requests(`/api/${method}`).map((request) => slackArgs(request)),
    transcript: (channel) => [...conversation(channel)],
    thread: (channel, threadTs) =>
      conversation(channel).filter(
        (message) => message.ts === threadTs || message.thread_ts === threadTs,
      ),
    injectFault: (rule) => recorder.injectFault(rule),
    dropSocket() {
      sockets.at(-1)?.terminate();
    },
    get socketCount() {
      return sockets.length;
    },
    get openCount() {
      return openCount;
    },
    waitForSocket: (timeoutMs) =>
      waitFor(() => sockets.length > 0, {
        what: "the Slack Socket Mode connection",
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      }),
    async close() {
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await http.close();
    },
  };
}
