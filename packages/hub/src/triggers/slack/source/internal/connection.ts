import { WebSocket, type RawData } from "ws";
import {
  parseSlackSocketFrame,
  SlackSocketHelloSchema,
  SlackSocketOpenResponseSchema,
} from "./socket-protocol.js";

const DEFAULT_TIMEOUT_MS = 10_000;

export class SlackSocketConnectionError extends Error {
  constructor(
    readonly reason: "appTokenRejected" | "socketModeOff" | "appIdentityMismatch" | "transient",
    readonly code: string,
    readonly retryAfterMs = 0,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "SlackSocketConnectionError";
  }
}

export interface OpenSlackSocketResult {
  appId: string;
  socket: WebSocket;
  closed: Promise<number>;
  close(timeoutMs: number, reason: string): Promise<void>;
}

// eslint-disable-next-line complexity -- one bounded transaction owns every response/socket exit.
export async function openSlackSocket(options: {
  appToken: string;
  appId?: string;
  apiUrl?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<OpenSlackSocketResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Slack connection timed out")),
    timeoutMs,
  );
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  let response: Response | undefined;
  try {
    response = await fetch(options.apiUrl ?? "https://slack.com/api/apps.connections.open", {
      method: "POST",
      headers: { authorization: `Bearer ${options.appToken}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      const retryAfter = Number(response.headers.get("retry-after"));
      controller.abort(new Error("Slack response discarded"));
      await response.body?.cancel().catch(() => undefined);
      throw new SlackSocketConnectionError(
        "transient",
        response.status === 429 ? "rate_limited" : `http_${response.status}`,
        response.status === 429 && Number.isFinite(retryAfter) ? retryAfter * 1_000 : 0,
      );
    }
    const opened = SlackSocketOpenResponseSchema.safeParse(await response.json());
    if (!opened.success) {
      throw new SlackSocketConnectionError("transient", "invalid_response");
    }
    if (!opened.data.ok || opened.data.url === undefined) {
      throw classifySlackError(opened.data.error);
    }
    const url = new URL(opened.data.url);
    if (url.protocol !== "wss:" && url.protocol !== "ws:") {
      throw new SlackSocketConnectionError("transient", "invalid_url");
    }
    const socket = new WebSocket(url);
    return await waitForHello(socket, options.appId, controller.signal);
  } catch (error) {
    if (error instanceof SlackSocketConnectionError) throw error;
    throw new SlackSocketConnectionError("transient", "connection_failed", 0, { cause: error });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
    if (response?.body !== null && response?.bodyUsed === false) {
      await response.body.cancel().catch(() => undefined);
    }
  }
}

async function closeSlackSocket(
  connection: Pick<OpenSlackSocketResult, "socket" | "closed">,
  timeoutMs: number,
  reason: string,
): Promise<void> {
  if (connection.socket.readyState === WebSocket.CLOSED) return;
  connection.socket.close(1000, reason);
  let timer: NodeJS.Timeout | undefined;
  const closed = await Promise.race([
    connection.closed.then(() => true),
    new Promise<false>((resolve) => {
      timer = setTimeout(resolve, timeoutMs, false);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  if (!closed) connection.socket.terminate();
  await connection.closed;
}

function waitForHello(
  socket: WebSocket,
  expectedAppId: string | undefined,
  signal: AbortSignal,
): Promise<OpenSlackSocketResult> {
  socket.on("error", () => undefined);
  const closed = new Promise<number>((resolve) => socket.once("close", resolve));
  return new Promise((resolve, reject) => {
    const fail = (error: Error) => {
      cleanup();
      if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
      reject(error);
    };
    const onAbort = () => fail(new SlackSocketConnectionError("transient", "aborted"));
    const onClose = () => fail(new SlackSocketConnectionError("transient", "closed_before_hello"));
    const onMessage = (data: RawData, binary: boolean) => {
      if (binary) {
        fail(new SlackSocketConnectionError("transient", "invalid_hello"));
        return;
      }
      const hello = SlackSocketHelloSchema.safeParse(parseSlackSocketFrame(data));
      if (!hello.success) {
        fail(new SlackSocketConnectionError("transient", "invalid_hello"));
        return;
      }
      if (expectedAppId !== undefined && hello.data.connection_info.app_id !== expectedAppId) {
        fail(new SlackSocketConnectionError("appIdentityMismatch", "wrong_app"));
        return;
      }
      cleanup();
      const connection = { appId: hello.data.connection_info.app_id, socket, closed };
      resolve({
        ...connection,
        close: (timeout, reason) => closeSlackSocket(connection, timeout, reason),
      });
    };
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      socket.off("close", onClose);
      socket.off("message", onMessage);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    socket.once("close", onClose);
    socket.once("message", onMessage);
    if (signal.aborted) onAbort();
  });
}

function classifySlackError(code = "unknown_error"): SlackSocketConnectionError {
  if (
    [
      "invalid_auth",
      "not_authed",
      "not_allowed_token_type",
      "missing_scope",
      "token_expired",
      "token_revoked",
    ].includes(code)
  ) {
    return new SlackSocketConnectionError("appTokenRejected", code);
  }
  if (["socket_mode_not_enabled", "method_not_supported_for_channel_type"].includes(code)) {
    return new SlackSocketConnectionError("socketModeOff", code);
  }
  return new SlackSocketConnectionError("transient", "slack_error");
}
