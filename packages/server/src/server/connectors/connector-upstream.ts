import {
  CLISBOT_MCP_IMPLEMENTATION,
  DEFAULT_PROTOCOL_VERSION,
  errorTextOf,
  isRecord,
} from "./connector-json.js";

export { DEFAULT_PROTOCOL_VERSION };

/**
 * The relay's own MCP sessions with Composio and the user's remote servers
 * (docs/features/connectors/README.md, "Runtime"). The agent's MCP client never talks to an
 * upstream directly, so its handshake never depends on one: the relay answers `initialize` and
 * `ping` itself, opens the upstream session in the background, and reopens it when the upstream
 * forgets it. An MCP client marks a server failed for the rest of the session when its
 * handshake times out or errors, and Composio's first session call can take seconds.
 */

export interface UpstreamTarget {
  /** One upstream endpoint; a changed URL is a different key and gets its own session. */
  key: string;
  label: string;
  post(init: {
    body: string;
    headers: Record<string, string>;
    signal: AbortSignal;
  }): Promise<Response>;
}

export type JsonRpcFrame = Record<string, unknown>;

export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamError";
  }
}

interface UpstreamSession {
  id: string | null;
  protocolVersion: string;
}

const OPEN_TIMEOUT_MS = 60_000;
const CALL_TIMEOUT_MS = 10 * 60_000;
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
const MAX_SESSIONS = 512;

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  const tooLarge = `The connector's answer was larger than 20 MB.`;
  if (declared > MAX_RESPONSE_BYTES) throw new UpstreamError(tooLarge);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new UpstreamError(tooLarge);
  return bytes.toString("utf8");
}

/** The answer to `id` in a JSON body or a server-sent event stream. */
function parseUpstreamAnswer(text: string, id: unknown): JsonRpcFrame | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    const frame: unknown = JSON.parse(trimmed);
    return isRecord(frame) ? frame : null;
  }
  const frames: JsonRpcFrame[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    try {
      const frame: unknown = JSON.parse(line.slice(5).trim());
      if (isRecord(frame)) frames.push(frame);
    } catch {
      // A keep-alive or partial event; the answer is another line.
    }
  }
  return frames.findLast((frame) => frame.id === id) ?? frames.at(-1) ?? null;
}

/** A short reason from an upstream's error body, never the body itself. */
function statusMessage(label: string, status: number, text: string): string {
  let reason: string | undefined;
  try {
    reason = errorTextOf(JSON.parse(text));
  } catch {
    // Not JSON; the status alone says enough.
  }
  return `${label} answered HTTP ${status}${reason ? `: ${reason.slice(0, 200)}` : ""}.`;
}

interface PostResult {
  status: number;
  sessionId: string | null;
  frame: JsonRpcFrame | null;
}

async function post(params: {
  target: UpstreamTarget;
  frame: JsonRpcFrame;
  session: UpstreamSession | null;
  timeoutMs: number;
}): Promise<PostResult> {
  const { target, frame, session } = params;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (session?.id) headers["mcp-session-id"] = session.id;
  if (session) headers["mcp-protocol-version"] = session.protocolVersion;
  const response = await target.post({
    body: JSON.stringify(frame),
    headers,
    signal: AbortSignal.timeout(params.timeoutMs),
  });
  const text = await readCapped(response);
  const sessionId = response.headers.get("mcp-session-id");
  if (!response.ok) {
    if (response.status === 404 && session?.id) return { status: 404, sessionId, frame: null };
    throw new UpstreamError(statusMessage(target.label, response.status, text));
  }
  return { status: response.status, sessionId, frame: parseUpstreamAnswer(text, frame.id) };
}

async function openSession(
  target: UpstreamTarget,
  protocolVersion: string,
): Promise<UpstreamSession> {
  const answer = await post({
    target,
    frame: {
      jsonrpc: "2.0",
      id: "clisbot-initialize",
      method: "initialize",
      params: {
        protocolVersion,
        capabilities: {},
        clientInfo: CLISBOT_MCP_IMPLEMENTATION,
      },
    },
    session: null,
    timeoutMs: OPEN_TIMEOUT_MS,
  });
  if (!answer.frame || !isRecord(answer.frame.result)) {
    const error = isRecord(answer.frame?.error) ? answer.frame.error.message : undefined;
    throw new UpstreamError(
      `${target.label} did not start an MCP session${typeof error === "string" ? `: ${error}` : ""}.`,
    );
  }
  const negotiated = answer.frame.result.protocolVersion;
  const session: UpstreamSession = {
    id: answer.sessionId,
    protocolVersion: typeof negotiated === "string" && negotiated ? negotiated : protocolVersion,
  };
  await post({
    target,
    frame: { jsonrpc: "2.0", method: "notifications/initialized" },
    session,
    timeoutMs: OPEN_TIMEOUT_MS,
  }).catch(() => undefined);
  return session;
}

/** Upstream sessions per agent ticket and endpoint. */
export function createUpstreamSessions() {
  const sessions = new Map<string, Promise<UpstreamSession>>();

  function sessionFor(owner: string, target: UpstreamTarget, protocolVersion: string) {
    const key = `${owner}\u0000${target.key}`;
    const existing = sessions.get(key);
    if (existing) return existing;
    const opening = openSession(target, protocolVersion);
    sessions.set(key, opening);
    opening.catch(() => {
      if (sessions.get(key) === opening) sessions.delete(key);
    });
    while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
    return opening;
  }

  function forget(owner: string, target: UpstreamTarget): void {
    sessions.delete(`${owner}\u0000${target.key}`);
  }

  return {
    /** Starts the upstream session; settles when it is open or has failed, never throws. */
    async open(owner: string, target: UpstreamTarget, protocolVersion: string): Promise<void> {
      await sessionFor(owner, target, protocolVersion).catch(() => undefined);
    },

    /** Sends one request, opening or reopening the session as needed. */
    async request(
      owner: string,
      target: UpstreamTarget,
      frame: JsonRpcFrame,
    ): Promise<JsonRpcFrame> {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const session = await sessionFor(owner, target, DEFAULT_PROTOCOL_VERSION);
        const answer = await post({ target, frame, session, timeoutMs: CALL_TIMEOUT_MS });
        if (answer.status === 404) {
          forget(owner, target);
          continue;
        }
        if (!answer.frame) throw new UpstreamError(`${target.label} sent no answer.`);
        return answer.frame;
      }
      throw new UpstreamError(`${target.label} keeps forgetting its MCP session.`);
    },

    /** Passes a notification along when a session is open; a notification has no answer to wait for. */
    notify(owner: string, target: UpstreamTarget, frame: JsonRpcFrame): void {
      const open = sessions.get(`${owner}\u0000${target.key}`);
      if (!open) return;
      void open
        .then((session) => post({ target, frame, session, timeoutMs: OPEN_TIMEOUT_MS }))
        .catch(() => undefined);
    },
  };
}

export type UpstreamSessions = ReturnType<typeof createUpstreamSessions>;
