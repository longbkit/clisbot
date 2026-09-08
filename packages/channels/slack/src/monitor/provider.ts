// upstream: extensions/slack/src/monitor/provider.ts@5d8067a4483
// Slack provider module implements model/runtime integration.
//
// D-038: upstream's provider is the OpenClaw monitor host — it resolves the
// OpenClaw config graph (allow-from mapping, DM policy, group policy, slash
// config, enterprise install), builds a `SlackMonitorContext` and registers the
// whole `monitor/events/*` + `monitor/message-handler/*` tree, whose terminal
// step hands a prepared message to OpenClaw's auto-reply/agent pipeline. Fusion
// owns config, authorization, routing and the agent, so the cut is exactly at
// that terminal step: this file keeps upstream's Bolt construction verbatim
// (`createSlackBoltApp` + `startSlackSocketAndWaitForDisconnect` +
// `registerSlackSocketModeConnectionDiagnostics`, all in the ported
// `provider-support.ts` / `reconnect-policy.ts`), registers the same Bolt
// listener set, and replaces the pipeline hand-off with the Fusion hand-off:
// build a `ChannelInboundEvent` and admit it through the shared monitor before
// the envelope is acked (`ingress.ts`).
//
// Ack contract, per family:
//   * Events API (`message`, `app_mention`, reactions, members, channels,
//     pins): the receiver wrapper defers Bolt's eager ack, so the envelope is
//     acked only after the listener's Hub admission resolved. An admission
//     fault rejects the listener, nothing is acked, and Slack redelivers.
//   * Interactive components and slash commands: acked first, inside Slack's
//     3s response window, then admitted (D-041).

import type { App, Receiver } from "@slack/bolt";
import type { ChannelInboundEvent, HostChildLogger } from "@getpaseo/channels-shared";
import { foldInboundSlackMedia } from "../transport/media.js";
import {
  buildSlackInboundEvent,
  buildSlackSlashCommandEvent,
  normalizeSlackChannelType,
  resolveSlackTimestampMs,
  shouldDropMismatchedSlackEvent,
  type SlackInboundSource,
  type SlackMessageEvent,
  type SlackSlashCommandBody,
  type SlackTransportIdentity,
} from "../transport/socket-event-filter.js";
import {
  buildSlackChannelFacts,
  buildSlackMemberFacts,
  buildSlackMessageSubtypeFacts,
  buildSlackPinFacts,
  buildSlackReactionFacts,
  buildSlackSystemInboundEvent,
  type SlackSystemEventFacts,
} from "./events/system-events.js";
import {
  buildSlackInteractiveInboundEvent,
  parseSlackInteractiveCallback,
} from "./events/interactions.js";
import { createSlackDurableIngress } from "./ingress.js";
import {
  createSlackBoltApp,
  gracefulStopSlackApp,
  markSlackSocketShuttingDown,
  resolveSlackBoltInterop,
  startSlackSocketAndWaitForDisconnect,
  type SlackBoltResolvedExports,
} from "./provider-support.js";
import {
  formatSlackSocketModeSharedConnectionWarning,
  registerSlackSocketModeConnectionDiagnostics,
} from "./reconnect-policy.js";

export interface SlackBoltProviderOptions {
  /** The account's bot user token — the Bolt `App` token and the media/download
   * credential. */
  botToken: string;
  /** The account's app-level token — the Socket Mode connection credential. */
  appToken: string;
  /** The identity facts L4 probed from `auth.test`. */
  identity: SlackTransportIdentity;
  /** The account's bot id, when the probe resolved one. */
  botId?: string;
  /** Hand one normalized inbound event to the shared monitor. For Events API
   * traffic this MUST complete before the envelope is acked; a rejection means
   * "not admitted", the envelope stays unacked and Slack redelivers. */
  onInbound: (event: ChannelInboundEvent) => Promise<void>;
  /** COMPAT(clisbot-control-plane): the native approval-card seam. Receives the
   * raw `block_actions` body; the Hub's card parser owns the value format. */
  onInteractive?: (body: Record<string, unknown>) => Promise<void>;
  /** The account's registered native slash command (`/paseo`). Absent = native
   * slash ingestion off; the in-message text commands still work. */
  slashCommand?: string;
  /** Inbound media: when set, a message's `files[]` are downloaded and the
   * `[Attached files]` manifest is folded into the body BEFORE admission. */
  media?: {
    accountId: string;
    downloadDir: string;
    fetchImpl?: typeof globalThis.fetch;
  };
  abortSignal: AbortSignal;
  logger?: HostChildLogger;
  clientOptions?: Record<string, unknown>;
  /** Test seam: the Bolt exports. Defaults to a dynamic `@slack/bolt` import so
   * the module stays importable without the dep resolved. */
  interop?: SlackBoltResolvedExports;
}

export interface SlackBoltProvider {
  /** Resolves when the account aborts or the socket terminates. */
  start(): Promise<void>;
}

type SlackListenerArgs = {
  event: Record<string, unknown>;
  body: Record<string, unknown>;
};

/** Upstream's interop resolution over a dynamic `@slack/bolt` import, so the
 * module stays importable when the dep is not resolved. */
async function loadSlackBoltInterop(): Promise<SlackBoltResolvedExports> {
  const namespaceImport = await import("@slack/bolt");
  return resolveSlackBoltInterop({
    defaultImport: (namespaceImport as { default?: unknown }).default,
    namespaceImport,
  });
}

function readEventId(body: Record<string, unknown>): string | undefined {
  const value = body["event_id"];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function readTeamId(body: Record<string, unknown>): string | undefined {
  const direct = body["team_id"];
  if (typeof direct === "string" && direct !== "") return direct;
  const team = body["team"];
  if (team !== null && typeof team === "object" && "id" in team) {
    const id = (team as { id?: unknown }).id;
    if (typeof id === "string" && id !== "") return id;
  }
  return undefined;
}

function eventTimestampMs(event: Record<string, unknown>): number | undefined {
  const eventTs = event["event_ts"];
  return typeof eventTs === "string" ? resolveSlackTimestampMs(eventTs) : undefined;
}

/**
 * The Slack Bolt provider: one `App` on a `SocketModeReceiver` per account,
 * with the ack-after-admission receiver wrapper in front of it.
 */
export function createSlackBoltProvider(options: SlackBoltProviderOptions): SlackBoltProvider {
  const { identity, onInbound, logger, abortSignal } = options;

  // --------------------------------------------------------------- admission

  /** Every listener funnels through here: one normalized event, admitted before
   * the caller returns. A rejection is what stops the ack. */
  const admit = async (event: ChannelInboundEvent): Promise<void> => {
    await onInbound(event);
  };

  const admitSystemFacts = async (
    facts: SlackSystemEventFacts | undefined,
    args: SlackListenerArgs,
    channelType?: string,
  ): Promise<void> => {
    if (facts === undefined) return;
    await admit(
      buildSlackSystemInboundEvent(facts, {
        eventId: readEventId(args.body) ?? facts.contextKey,
        ...(channelType !== undefined ? { channelType } : {}),
        ...(eventTimestampMs(args.event) !== undefined
          ? { timestampMs: eventTimestampMs(args.event) as number }
          : {}),
      }),
    );
  };

  /** The app/team identity guard: an envelope from another install of the same
   * Slack app is not this account's traffic. */
  const matchesIdentity = (body: Record<string, unknown>): boolean => {
    const drop = shouldDropMismatchedSlackEvent(body, identity);
    if (drop === null) return true;
    logger?.debug?.(`slack: drop event with mismatched ${drop}`);
    return false;
  };

  // ----------------------------------------------------------------- message

  const admitMessageEvent = async (
    event: SlackMessageEvent,
    source: SlackInboundSource,
    args: SlackListenerArgs,
  ): Promise<void> => {
    // Edits and deletes are not new messages: upstream routes them through the
    // subtype registry as system notifications, never as agent turns.
    if (event.subtype === "message_changed" || event.subtype === "message_deleted") {
      await admitSystemFacts(buildSlackMessageSubtypeFacts({ event }), args, event.channel_type);
      return;
    }
    const inbound = buildSlackInboundEvent(event, source, identity, options.botId);
    if (inbound === undefined) return;
    let admitted: ChannelInboundEvent | null = inbound;
    if (options.media !== undefined) {
      admitted = await foldInboundSlackMedia(
        {
          accountId: options.media.accountId,
          botToken: options.botToken,
          downloadDir: options.media.downloadDir,
          abortSignal,
          ...(options.media.fetchImpl !== undefined ? { fetchImpl: options.media.fetchImpl } : {}),
          ...(logger !== undefined ? { logger } : {}),
        },
        event,
        inbound,
      );
    }
    if (admitted === null) return;
    await admit(admitted);
  };

  // ---------------------------------------------------------------- register

  const registerListeners = (app: App): void => {
    app.event("message", async (args: unknown) => {
      const { event, body } = args as SlackListenerArgs;
      if (!matchesIdentity(body)) return;
      await admitMessageEvent(event as SlackMessageEvent, "message", { event, body });
    });

    app.event("app_mention", async (args: unknown) => {
      const { event, body } = args as SlackListenerArgs;
      if (!matchesIdentity(body)) return;
      // Upstream: app_mention in im/mpim duplicates the `message` event.
      const channelType = normalizeSlackChannelType(
        typeof event["channel_type"] === "string" ? (event["channel_type"] as string) : undefined,
        typeof event["channel"] === "string" ? (event["channel"] as string) : undefined,
      );
      if (channelType === "im" || channelType === "mpim") return;
      await admitMessageEvent(event as SlackMessageEvent, "app_mention", { event, body });
    });

    for (const action of ["added", "removed"] as const) {
      app.event(`reaction_${action}`, async (args: unknown) => {
        const { event, body } = args as SlackListenerArgs;
        if (!matchesIdentity(body)) return;
        await admitSystemFacts(
          buildSlackReactionFacts({
            event,
            action,
            eventId: readEventId(body) ?? "unknown",
            ...(readTeamId(body) !== undefined ? { teamId: readTeamId(body) as string } : {}),
          }),
          { event, body },
        );
      });
    }

    for (const [eventName, verb] of [
      ["member_joined_channel", "joined"],
      ["member_left_channel", "left"],
    ] as const) {
      app.event(eventName, async (args: unknown) => {
        const { event, body } = args as SlackListenerArgs;
        if (!matchesIdentity(body)) return;
        await admitSystemFacts(
          buildSlackMemberFacts({
            event,
            verb,
            eventId: readEventId(body) ?? "unknown",
            ...(readTeamId(body) !== undefined ? { teamId: readTeamId(body) as string } : {}),
          }),
          { event, body },
        );
      });
    }

    for (const [eventName, kind] of [
      ["channel_created", "created"],
      ["channel_rename", "renamed"],
    ] as const) {
      app.event(eventName, async (args: unknown) => {
        const { event, body } = args as SlackListenerArgs;
        if (!matchesIdentity(body)) return;
        await admitSystemFacts(
          buildSlackChannelFacts({
            event,
            kind,
            eventId: readEventId(body) ?? "unknown",
            ...(readTeamId(body) !== undefined ? { teamId: readTeamId(body) as string } : {}),
          }),
          { event, body },
        );
      });
    }

    for (const [eventName, action, suffix] of [
      ["pin_added", "pinned", "added"],
      ["pin_removed", "unpinned", "removed"],
    ] as const) {
      app.event(eventName, async (args: unknown) => {
        const { event, body } = args as SlackListenerArgs;
        if (!matchesIdentity(body)) return;
        await admitSystemFacts(
          buildSlackPinFacts({
            event,
            action,
            contextKeySuffix: suffix,
            eventId: readEventId(body) ?? "unknown",
            ...(readTeamId(body) !== undefined ? { teamId: readTeamId(body) as string } : {}),
          }),
          { event, body },
        );
      });
    }

    // Slash commands: ack FIRST with an empty body — the response window is 3s
    // and the plane's work (binding, agent turn) is far longer, so Slack shows
    // no ephemeral response and the plane's own thread posts everything.
    app.command(/.*/, async (args: unknown) => {
      const { ack, body } = args as {
        ack: (response?: unknown) => Promise<void>;
        body: Record<string, unknown>;
      };
      await ack();
      if (!matchesIdentity(body)) return;
      const inbound = buildSlackSlashCommandEvent(
        body as SlackSlashCommandBody,
        options.slashCommand,
      );
      if (inbound === undefined) return;
      try {
        await admit(inbound);
      } catch (error) {
        logger?.warn?.("slack slash-command handoff fault (kept socket alive)", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Interactive components: ack FIRST (3s window), then hand the raw body to
    // the native approval seam and admit the decoded callback.
    const handleInteractive = async (body: Record<string, unknown>): Promise<void> => {
      if (!matchesIdentity(body)) return;
      if (options.onInteractive !== undefined && body["type"] === "block_actions") {
        try {
          await options.onInteractive(body);
        } catch (error) {
          logger?.warn?.("slack interactive handoff fault (kept socket alive)", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const callback = parseSlackInteractiveCallback(body);
      if (callback === null) {
        logger?.warn?.("slack interactive payload did not parse", {
          payloadKeys: Object.keys(body),
        });
        return;
      }
      try {
        await admit(
          buildSlackInteractiveInboundEvent(
            callback,
            typeof body["event_id"] === "string" ? { eventId: body["event_id"] } : {},
          ),
        );
      } catch (error) {
        logger?.warn?.("slack interactive admission fault (kept socket alive)", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    app.action(/.*/, async (args: unknown) => {
      const { ack, body } = args as {
        ack: (response?: unknown) => Promise<void>;
        body: Record<string, unknown>;
      };
      await ack();
      await handleInteractive(body);
    });

    app.view(/.*/, async (args: unknown) => {
      const { ack, body } = args as {
        ack: (response?: unknown) => Promise<void>;
        body: Record<string, unknown>;
      };
      await ack();
      await handleInteractive(body);
    });

    // The global error handler must REJECT so a listener fault propagates out of
    // `App.processEvent` — that rejection is what leaves the envelope unacked.
    app.error(async (error) => {
      logger?.warn?.("slack listener fault (envelope left unacked)", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });
  };

  return {
    async start(): Promise<void> {
      const interop = options.interop ?? (await loadSlackBoltInterop());
      const ingress = createSlackDurableIngress();
      const { app, receiver } = createSlackBoltApp({
        interop,
        slackMode: "socket",
        token: options.botToken,
        appToken: options.appToken,
        slackWebhookPath: "/slack/events",
        clientOptions: options.clientOptions ?? {},
        wrapReceiver: (inner: Receiver) => ingress.wrapReceiver(inner),
      });
      // Bolt's single-token authorize calls `auth.test` on the first event and
      // caches it. The account lifecycle already probed exactly that call
      // (`probeSlackAuth`), so the probed identity is installed directly:
      // upstream re-probes because its provider has no earlier probe, Fusion's
      // does. `createSlackBoltApp` stays byte-identical.
      Reflect.set(app, "authorize", async () => ({
        botToken: options.botToken,
        ...(identity.botId !== undefined ? { botId: identity.botId } : {}),
        ...(identity.botUserId !== undefined ? { botUserId: identity.botUserId } : {}),
        ...(identity.teamId !== undefined ? { teamId: identity.teamId } : {}),
      }));
      registerListeners(app);
      registerSlackSocketModeConnectionDiagnostics({
        app,
        onSharedConnection: (activeConnections) => {
          logger?.warn?.(formatSlackSocketModeSharedConnectionWarning(activeConnections));
        },
      });
      void receiver;
      // The abort IS the stop. Bolt's socket client reconnects on its own
      // schedule and only stands down when `shuttingDown` is set, which used to
      // happen in the `finally` — after the disconnect await — so a stopping
      // account could bring its socket back up and keep consuming events
      // (D-042). Flag it the moment the abort fires.
      const markShuttingDown = () => {
        markSlackSocketShuttingDown(app);
      };
      if (abortSignal.aborted) markShuttingDown();
      else abortSignal.addEventListener("abort", markShuttingDown, { once: true });
      try {
        await startSlackSocketAndWaitForDisconnect({
          app: app as unknown as { start: () => unknown },
          abortSignal,
          // The live channel harness waits for this exact line before it posts
          // a marker (Slack delivers a socket event only to a connected
          // client): packages/hub/src/channels/supervisor/boot.integration.native.ts.
          onStarted: () => {
            logger?.info?.("slack socket mode connected");
          },
        });
      } finally {
        abortSignal.removeEventListener("abort", markShuttingDown);
        await gracefulStopSlackApp(app as unknown as { stop: () => unknown });
      }
    },
  };
}
