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
  buildSlackSlashCommandEvent,
  normalizeSlackChannelType,
  shouldDropMismatchedSlackEvent,
  type SocketEventEnvelope,
  type SlackInboundSource,
  type SlackSlashCommandBody,
  type SlackTransportIdentity,
} from "./socket-event-filter.js";
import { foldInboundSlackMedia } from "./media.js";
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
  /** COMPAT(clisbot-control-plane): one native approval-card button click
   * (the Socket Mode `block_actions` envelope — a Block Kit interactive
   * component inside a posted message). The transport acks the envelope
   * BEFORE handing over (same redelivery semantic as `onInbound`); the raw
   * payload body goes to the Hub's approval seam UNCHANGED — the hub's card
   * parser owns the value format. Absent = no card clicks (the typed
   * command still answers the prompt). */
  onInteractive?: (body: Record<string, unknown>) => Promise<void>;
  /** COMPAT(clisbot-control-plane): inbound media (F-06, G5+G6) — when set,
   * a message event's `files[]` are downloaded before the event is handed to
   * the L3, and the `[Attached files]` manifest is folded into its body. The
   * fold runs BEFORE the ack handoff (the event's body must be final before
   * the L3 dedupes/records it); per-file faults are logged skips, never a
   * socket fault (P13). Absent = no inbound media (text-only, the P0 floor). */
  /** COMPAT(clisbot-control-plane): the account's registered NATIVE slash
   * command name (from `transport.slashCommand`, e.g. `/paseo`). When set,
   * a `slash_commands` envelope whose `command` matches is rewritten to the
   * plain-text inbound command (`/paseo approve` → `<@U> approve`) and rides
   * the SAME `onInbound` path as typed text — one parser, both spellings.
   * Absent = native slash ingestion off (the in-message text commands still
   * work, which is the zero-app-setup default). */
  slashCommand?: string;
  media?: {
    accountId: string;
    botToken: string;
    /** The account's download dir (`<dataDir>/channels/<accountId>/downloads`). */
    downloadDir: string;
    fetchImpl?: typeof globalThis.fetch;
  };
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
  const { client, identity, onInbound, onInteractive, slashCommand, abortSignal, logger } = options;

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
    // F-06/G5+G6: fold the message's `files[]` into the body BEFORE the L3
    // handoff (the body must be final before dedupe/record). Per-file faults
    // are logged skips inside the fold — it never throws; all-files-failed
    // trims the body to "" and the fold returns null (the event is dropped).
    let admitted: ChannelInboundEvent | null = inbound;
    if (options.media !== undefined) {
      admitted = await foldInboundSlackMedia(
        {
          accountId: options.media.accountId,
          botToken: options.media.botToken,
          downloadDir: options.media.downloadDir,
          abortSignal,
          ...(options.media.fetchImpl !== undefined ? { fetchImpl: options.media.fetchImpl } : {}),
          ...(logger !== undefined ? { logger } : {}),
        },
        event as never,
        inbound,
      );
    }
    if (admitted === null) return;
    try {
      await onInbound(admitted);
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

  // COMPAT(clisbot-control-plane): native approval-card button clicks arrive
  // as Socket Mode `interactive` envelopes (a Block Kit interactive
  // component inside a posted message). Wire fact (verified against
  // @slack/socket-mode 2.0.7's dispatch + the Slack Socket Mode reference):
  // the client emits a non-events_api envelope on the ENVELOPE's `type`, and
  // every interaction payload — `block_actions` included — rides the
  // envelope type `"interactive"`; `block_actions` is the PAYLOAD's type. A
  // listener on `"block_actions"` never fires live. Ack FIRST (same
  // redelivery semantic), then hand the RAW payload body to the hub's
  // approval seam — the hub's card parser owns the value format (the
  // vertical's approval-card.ts narrows the channel envelope, not the
  // value). A fault never kills the socket loop (P13). The hub's
  // exactly-once resolver makes a stale re-click inert; the in-place update
  // strips the markup when the prompt resolves, so no response payload
  // (button invalidation) is needed at P0.
  // COMPAT(clisbot-control-plane): native slash commands (`slash_commands`
  // envelopes). Ack FIRST with an EMPTY body — the HTTP-response window for
  // slash commands is 3s and the plane's work (binding, agent turn) is far
  // longer; an empty ack means Slack shows no ephemeral response and the
  // plane's own thread posts everything (the same surface the typed command
  // uses). Then rewrite to the plain-text form and hand to `onInbound`.
  client.on("slash_commands", async (envelope: SocketEventEnvelope) => {
    if (slashCommand !== undefined && slashCommand !== "") {
      const inbound = buildSlackSlashCommandEvent(
        envelope.body as SlackSlashCommandBody,
        slashCommand,
      );
      if (inbound !== undefined && rememberEnvelope(envelope.envelope_id)) {
        try {
          await onInbound(inbound);
        } catch (error) {
          logger?.warn?.("slack slash-command handoff fault (kept socket alive)", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    await ackSafe(envelope);
  });

  client.on("interactive", async (envelope: SocketEventEnvelope) => {
    // Only message-component clicks matter here; a modal or Home-tab
    // interaction (or a `block_suggestion`, which needs a 3s response the
    // plane never mints) is acked and dropped before the seam.
    if (envelope.body["type"] !== "block_actions") {
      await ackSafe(envelope);
      return;
    }
    // The approval card's buttons are the native answer surface: log the
    // arrival — without it a click that never arrives (Slack interactivity
    // off) and a click that dies hub-side are indistinguishable.
    if (onInteractive === undefined) {
      logger?.warn?.("slack interactive click dropped (no approval seam wired)", {
        envelopeId: envelope.envelope_id,
      });
      await ackSafe(envelope);
      return;
    }
    if (rememberEnvelope(envelope.envelope_id)) {
      logger?.info?.("slack block_actions received", {
        envelopeId: envelope.envelope_id,
      });
      try {
        await onInteractive(envelope.body);
      } catch (error) {
        logger?.warn?.("slack interactive handoff fault (kept socket alive)", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
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
