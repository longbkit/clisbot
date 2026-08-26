// L2 — the Socket Mode transport (blueprint §6.5: a port of the pinned
// Socket Mode client handler, driven by the pinned npm dep @slack/socket-mode
// 2.0.7). Sync reference: @openclaw/slack@2026.7.1
// dist/provider-C1-DFSpw.js [extensions/slack/src/monitor/provider.ts,
// extensions/slack/src/monitor/provider-support.ts,
// extensions/slack/src/monitor/events/messages.ts].
//
// The transport acks each event envelope BEFORE it is handed to the L3
// processor and drops re-delivered envelope ids — Slack redelivers unacked
// events on reconnect, so this ack-first order + the L3 in-flight set + the
// durable ledger row is the redelivery semantic (blueprint §1 table).
//
// The reconnect loop (socket-reconnect.ts) and the event filter
// (socket-event-filter.ts) are sibling modules; this file owns only the
// SocketModeClient handler wiring.
//
// No OpenClaw imports: the pinned vertical rides on @slack/bolt's
// SocketModeReceiver + its native-reconnect failure observer; in-repo the
// transport talks to the SocketModeClient directly (DEVIATIONS D-003).

import type { SocketModeClient } from "@slack/socket-mode";
import type { ChannelInboundEvent, HostChildLogger } from "@getpaseo/channels-shared";
import {
  buildSlackInboundEvent,
  normalizeSlackChannelType,
  shouldDropMismatchedSlackEvent,
  type SocketEventEnvelope,
  type SlackInboundSource,
  type SlackTransportIdentity,
} from "./socket-event-filter.js";
import { runSlackSocketReconnectLoop, stopSlackSocketClient } from "./socket-reconnect.js";

export { SocketModeClient } from "@slack/socket-mode";
export type { SocketModeOptions } from "@slack/socket-mode";
export type {
  SocketEventEnvelope,
  SlackInboundSource,
  SlackMessageEvent,
  SlackTransportIdentity,
} from "./socket-event-filter.js";

export interface SlackSocketTransportOptions {
  /** The Socket Mode client (constructed by L4 with the account's appToken). */
  client: SocketModeClient;
  /** The identity facts L4 probed from `auth.test` — explicit-mention
   * detection + own-message filtering. Empty when the token is not a bot
   * token (mention detection then fails closed, pinned behavior). */
  identity: SlackTransportIdentity;
  /** Hand one normalized inbound event to the L3 processor. The transport
   * acks the envelope BEFORE calling this, so a handler fault never makes
   * Slack redeliver the event. */
  onInbound: (event: ChannelInboundEvent) => Promise<void>;
  /** The account's bot user id is known when `identity.botUserId` is set;
   * own-bot messages are flagged (and dropped by the L3) when either the
   * sender user or the message bot_id matches the identity. */
  botId?: string;
  /** The account's abort signal — "start" is the transport lifetime;
   * stop = abort (pinned-vertical-contracts/start-account.md). */
  abortSignal: AbortSignal;
  /** Logger; default silent. */
  logger?: HostChildLogger;
}

/** The running transport: `start()` resolves when the account aborts. */
export interface SlackSocketTransport {
  start(): Promise<void>;
}

/**
 * The Socket Mode transport: ack-first event dispatch into the shared L3
 * processor + the pinned reconnect loop. Redelivered `message`/`app_mention`
 * events re-enter the L3, whose in-flight set + ledger drop the duplicates.
 */
export function createSlackSocketTransport(
  options: SlackSocketTransportOptions,
): SlackSocketTransport {
  const { client, identity, onInbound, abortSignal, logger } = options;

  // In-flight envelope ids: the transport-level redelivery guard for the
  // socket reconnect window. The L3's event-id set + ledger row are the
  // durable dedupe; this set covers events already ACKED (Slack stops
  // redelivering them, but a same-session duplicate still costs a
  // dispatch if it lands).
  const seen = new Map<string, true>();
  const SEEN_CAP = 4096;
  const rememberEnvelope = (id: string): boolean => {
    if (seen.has(id)) return false;
    seen.set(id, true);
    if (seen.size > SEEN_CAP) {
      const oldest = seen.keys().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    return true;
  };

  const handleEnvelope = async (
    envelope: SocketEventEnvelope,
    source: SlackInboundSource,
  ): Promise<void> => {
    const drop = shouldDropMismatchedSlackEvent(envelope.body, identity);
    if (drop !== null) {
      logger?.debug?.(`slack: drop event with mismatched ${drop}`);
      return;
    }
    const event = envelope.event;
    if (event === undefined || typeof event !== "object") return;
    const inbound = buildSlackInboundEvent(event as never, source, identity, options.botId);
    if (inbound === undefined) return;
    try {
      await onInbound(inbound);
    } catch (error) {
      // Never let one event's fault kill the socket loop (P13).
      logger?.warn?.("slack inbound handoff fault (kept socket alive)", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const ackSafe = async (envelope: SocketEventEnvelope): Promise<void> => {
    try {
      await envelope.ack();
    } catch (error) {
      logger?.warn?.("slack envelope ack failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // Ack FIRST (Slack redelivers unacked events on reconnect — the blueprint
  // §1 redelivery semantic), then hand to the L3. The client's EventEmitter
  // keeps these handlers across its internal auto-reconnects.
  client.on("message", async (envelope: SocketEventEnvelope) => {
    if (rememberEnvelope(envelope.envelope_id)) {
      await handleEnvelope(envelope, "message");
    }
    await ackSafe(envelope);
  });
  client.on("app_mention", async (envelope: SocketEventEnvelope) => {
    // Pinned: app_mention in im/mpim duplicates the `message` event
    // (events/messages.ts:2453-2454).
    const channelType = normalizeSlackChannelType(
      typeof envelope.body["channel_type"] === "string"
        ? (envelope.body["channel_type"] as string)
        : undefined,
      typeof envelope.body["channel"] === "string"
        ? (envelope.body["channel"] as string)
        : undefined,
    );
    if (channelType === "im" || channelType === "mpim") {
      await ackSafe(envelope);
      return;
    }
    if (rememberEnvelope(envelope.envelope_id)) {
      await handleEnvelope(envelope, "app_mention");
    }
    await ackSafe(envelope);
  });

  return {
    start(): Promise<void> {
      // The loop resolves only when the account aborts — the transport's
      // lifetime is over, so tear down the SocketModeClient: its internal
      // auto-reconnect keeps the socket alive across socket closes until
      // disconnected, and would otherwise hold the host process open.
      const stopClient = (): Promise<void> => stopSlackSocketClient(client, logger);
      return runSlackSocketReconnectLoop({
        startSession: async (): Promise<void> => {
          await client.start();
        },
        waitDisconnect: (): Promise<{ event: "disconnect" | "abort" }> =>
          waitSocketDisconnect(client, abortSignal),
        signal: abortSignal,
        ...(logger !== undefined ? { logger } : {}),
      }).finally(stopClient);
    },
  };
}

/** Wait for the socket client's `disconnected`, or the account abort. */
function waitSocketDisconnect(
  client: SocketModeClient,
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
