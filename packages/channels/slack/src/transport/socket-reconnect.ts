// L2 reconnect loop (blueprint §6.5): the socket session loop — start the
// Socket Mode client, wait for its disconnect, back off, retry; a
// non-recoverable auth error stops the loop. Sync reference:
// @openclaw/slack@2026.7.1 dist/provider-C1-DFSpw.js
// [extensions/slack/src/monitor/reconnect-policy.ts,
//  extensions/slack/src/monitor/provider.ts (socket loop)].
//
// Split out of socket-mode.ts so the loop's backoff/abort handling is testable
// without the event handlers. No OpenClaw imports.
//
// Reconnect/redelivery semantics (blueprint §1 table): the @slack/socket-mode
// client auto-reconnects on socket close; Slack RE-DELIVERS unacked events on
// reconnect. The ack-first dispatch in socket-mode.ts + the L3 in-flight
// event-id set + the durable inbound ledger row are the dedupe.

import type { HostChildLogger } from "@getpaseo/channels-shared";

/** Pinned reconnect policy (reconnect-policy.ts SLACK_SOCKET_RECONNECT_POLICY):
 * initialMs 2000, maxMs 30000, factor 1.8, jitter 0.25. */
export const SLACK_SOCKET_RECONNECT_POLICY = {
  initialMs: 2000,
  maxMs: 30000,
  factor: 1.8,
  jitter: 0.25,
} as const;

/** Permanent Slack account/credential failures (pinned SLACK_AUTH_ERROR_RE):
 * the transport stops reconnecting when a start/disconnect reports one of
 * these — retrying is pointless. */
const SLACK_AUTH_ERROR_RE =
  /account_inactive|invalid_auth|token_revoked|token_expired|not_authed|org_login_required|team_access_not_granted|user_removed_from_team|team_disabled|missing_scope|cannot_find_service|invalid_token/i;

export function isNonRecoverableSlackAuthError(error: unknown): boolean {
  return SLACK_AUTH_ERROR_RE.test(formatSlackTransportError(error, ""));
}

/** One-line error text for reconnect diagnostics. */
export function formatSlackTransportError(error: unknown, fallback = "no error detail"): string {
  if (error === undefined || error === null || error === "") return fallback;
  if (error instanceof Error) return error.message === "" ? fallback : error.message;
  return String(error);
}

/** Exponential backoff with jitter (the pinned `computeBackoff` from
 * openclaw/plugin-sdk/runtime-env, ported): delay = min(initial *
 * factor^attempt, max) ± jitter*delay/2, floored at 0. */
export function computeSlackSocketBackoff(
  policy: { initialMs: number; maxMs: number; factor: number; jitter: number },
  attempt: number,
): number {
  const base = Math.min(policy.initialMs * Math.pow(policy.factor, attempt), policy.maxMs);
  const spread = base * policy.jitter;
  return Math.max(0, Math.round(base - spread / 2 + Math.random() * spread));
}

/** Wait for the socket client to fire `disconnected`, or for the abort signal
 * to fire — whichever comes first. */
export function waitSlackSocketDisconnect(
  client: {
    on: (event: string, fn: () => void) => unknown;
    off: (event: string, fn: () => void) => unknown;
  },
  abortSignal: AbortSignal,
): Promise<{ event: "disconnect" | "abort" }> {
  return new Promise((resolve) => {
    const onDisconnected = (): void => {
      cleanup();
      resolve({ event: "disconnect" });
    };
    const onAbort = (): void => {
      cleanup();
      resolve({ event: "abort" });
    };
    const cleanup = (): void => {
      client.off("disconnected", onDisconnected);
      abortSignal.removeEventListener("abort", onAbort);
    };
    client.on("disconnected", onDisconnected);
    abortSignal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Sleep, rejecting as soon as the abort signal fires. */
export function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("aborted"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      cleanup();
      reject(new Error("aborted"));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** The bound for the abort-time socket teardown: `disconnect()` settles when
 * the library's socket close event lands; a hung handshake must not hold the
 * account's abort (and therefore the host process) hostage. */
export const SLACK_SOCKET_TEARDOWN_TIMEOUT_MS = 5000;

/**
 * Tear down the Socket Mode client when the account stops. The library's
 * auto-reconnect keeps the socket alive across socket closes unless the
 * client is stopped; `disconnect()` is the @slack/socket-mode 2.0.7
 * SocketModeClient teardown method (its shuttingDown sentinel stands the
 * internal reconnect loop down; it resolves on the socket's close event).
 * Bounded + fault-tolerant: the abort resolution never blocks on a hung
 * socket or a teardown fault — both are logged and released.
 */
export function stopSlackSocketClient(
  client: { disconnect: () => Promise<void> },
  logger?: HostChildLogger,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      logger?.warn?.(
        `slack socket teardown unsettled after ${SLACK_SOCKET_TEARDOWN_TIMEOUT_MS}ms; releasing abort`,
      );
      resolve();
    }, SLACK_SOCKET_TEARDOWN_TIMEOUT_MS);
    client
      .disconnect()
      .then(() => {
        clearTimeout(timer);
        resolve();
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        logger?.warn?.("slack socket teardown fault (releasing abort)", {
          error: error instanceof Error ? error.message : String(error),
        });
        resolve();
      });
  });
}

/** The session facts one reconnect cycle reports. */
export interface SlackSocketSession {
  /** Start the socket session (client.start()). */
  startSession: () => Promise<void>;
  /** Wait for this session's disconnect or abort. */
  waitDisconnect: () => Promise<{ event: "disconnect" | "abort" }>;
  /** The account's abort signal. */
  signal: AbortSignal;
  logger?: HostChildLogger;
}

/**
 * The pinned socket reconnect loop (provider.ts socket branch): start the
 * session → wait for disconnect → backoff → retry; a non-recoverable auth
 * error (or a mid-flight abort) stops the loop. Resolves when the signal
 * aborts or the socket is lost to a permanent auth failure.
 */
export async function runSlackSocketReconnectLoop(session: SlackSocketSession): Promise<void> {
  let reconnectAttempts = 0;
  let hasLoggedSocketConnected = false;
  session.logger?.info?.("slack socket mode starting");
  while (!session.signal.aborted) {
    try {
      await session.startSession();
      if (session.signal.aborted) return;
      reconnectAttempts = 0;
      if (!hasLoggedSocketConnected) {
        hasLoggedSocketConnected = true;
        session.logger?.info?.("slack socket mode connected");
      }
      const disconnect = await session.waitDisconnect();
      if (disconnect.event === "abort" || session.signal.aborted) return;
      reconnectAttempts += 1;
      const delayMs = computeSlackSocketBackoff(SLACK_SOCKET_RECONNECT_POLICY, reconnectAttempts);
      session.logger?.warn?.(
        `slack socket disconnected; reconnecting in ${Math.round(delayMs / 1000)}s (attempt ${reconnectAttempts}/∞)`,
      );
      await sleepWithAbort(delayMs, session.signal);
    } catch (error) {
      if (session.signal.aborted) return;
      if (isNonRecoverableSlackAuthError(error)) {
        session.logger?.error?.(
          `slack socket mode stopped (non-recoverable auth error): ${formatSlackTransportError(error)}`,
        );
        throw error instanceof Error ? error : new Error(formatSlackTransportError(error));
      }
      reconnectAttempts += 1;
      const delayMs = computeSlackSocketBackoff(SLACK_SOCKET_RECONNECT_POLICY, reconnectAttempts);
      session.logger?.error?.(
        `slack socket mode failed to start; retry ${reconnectAttempts}/∞ in ${Math.round(delayMs / 1000)}s reason="${formatSlackTransportError(error)}"`,
      );
      await sleepWithAbort(delayMs, session.signal);
    }
  }
}
