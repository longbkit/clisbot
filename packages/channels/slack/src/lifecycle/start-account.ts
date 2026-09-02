// L4 — the account lifecycle (blueprint §6.5: the `gateway.startAccount`
// subset — auth.test probe (botToken+appToken) → duplicate-token guard →
// transport handoff). Sync reference: @openclaw/slack@2026.7.1
// dist/channel-BjlsaGHn.js:1050-1068 [extensions/slack/src/channel.ts
// startAccount], dist/probe-CuwRDE5j.js [extensions/slack/src/probe.ts].
//
// Pinned flow (docs/audits/pinned-vertical-contracts/start-account.md):
// read `ctx.account` `{accountId, botToken, appToken}` → probe auth.test on
// the bot token → the `cfg.channels.slack.accounts` duplicate-token guard
// (exactly one account entry may own a given token) → hand off to the
// Socket Mode transport, whose `start()` resolves when `ctx.abortSignal`
// fires ("start" is the transport lifetime; stop = abort).
//
// No OpenClaw imports: the probe runs against a straight @slack/web-api
// WebClient (client/web-api.ts).

import {
  createInboundEventProcessor,
  type HostChildLogger,
  type HostRuntime,
  type StartAccountContext,
} from "@getpaseo/channels-shared";
import { probeSlackAuth } from "../client/web-api.js";
import { getSlackRuntime } from "../runtime.js";
import {
  approvalRootKind,
  parseApprovalCardClick,
} from "../transport/approval-card.js";
import { acquireSharedSlackSocket } from "../transport/socket-pool.js";
import { createSlackSocketTransport } from "../transport/socket-mode.js";

/** The pinned default account id when `ctx.account` carries no `accountId`. */
export const SLACK_DEFAULT_ACCOUNT_ID = "default";

/** COMPAT(clisbot-control-plane): the account's inbound-media download dir
 * (`<dataDir>/channels/<accountId>/downloads`, filled by the Hub supervisor as
 * `ctx.mediaDownloadDir`). `undefined` → the L2 skips media downloads
 * (text-only bodies), the unit-test floor. */
function resolveMediaDownloadDir(ctx: StartAccountContext): string | undefined {
  return typeof ctx.mediaDownloadDir === "string" && ctx.mediaDownloadDir !== ""
    ? ctx.mediaDownloadDir
    : undefined;
}

/** Read one `string` field off a `Record` account/cfg entry. */
function readStringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

/** Read the token fields off the flat `ctx.account`. */
export function readSlackAccountTokens(account: Record<string, unknown>): {
  accountId: string;
  botToken?: string;
  appToken?: string;
} {
  const accountId =
    readStringField(account, "accountId") ?? SLACK_DEFAULT_ACCOUNT_ID;
  const botToken = readStringField(account, "botToken")?.trim();
  const appToken = readStringField(account, "appToken")?.trim();
  return {
    accountId,
    ...(botToken !== undefined && botToken !== "" ? { botToken } : {}),
    ...(appToken !== undefined && appToken !== "" ? { appToken } : {}),
  };
}

/** The `cfg.channels.slack.accounts.<id>.botToken` the outbound path reads. */
export function readSlackAccountConfig(
  cfg: Record<string, unknown>,
  accountId: string,
): Record<string, unknown> {
  const channels = cfg["channels"] as Record<string, unknown> | undefined;
  const slack = channels?.["slack"] as Record<string, unknown> | undefined;
  const accounts = slack?.["accounts"] as Record<string, unknown> | undefined;
  const entry = accounts?.[accountId] as Record<string, unknown> | undefined;
  return entry ?? {};
}

/**
 * The duplicate-token guard (pinned `findTelegramTokenOwnerAccountId` family;
 * start-account.md "cfg.channels.<ch>.accounts.<id> holds exactly one account
 * entry"): two account entries owning the same bot token fail the account at
 * drive time — a stray duplicate would split one Slack app across two
 * monitors. Throws with the offending ids.
 */
export function assertNoDuplicateSlackBotTokens(
  cfg: Record<string, unknown>,
  activeAccountId: string,
): void {
  const channels = cfg["channels"] as Record<string, unknown> | undefined;
  const slack = channels?.["slack"] as Record<string, unknown> | undefined;
  const accounts = slack?.["accounts"] as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (accounts === undefined) return;
  const activeConfig = readSlackAccountConfig(cfg, activeAccountId);
  const activeToken = readStringField(activeConfig, "botToken");
  if (activeToken === undefined || activeToken === "") return;
  const owners = Object.keys(accounts).filter((id) => {
    const token = accounts[id]?.["botToken"];
    return token === activeToken;
  });
  if (owners.length > 1) {
    throw new Error(
      `Slack account "${activeAccountId}" and ${owners
        .filter((id) => id !== activeAccountId)
        .map((id) => `"${id}"`)
        .join(
          ", ",
        )} share one botToken; cfg.channels.slack.accounts must hold exactly one entry per token`,
    );
  }
}

/** The shared L3 processor for one account, or undefined when the runtime
 * is not mounted yet (unit-test posture): the inboundLedger sink is the
 * Hub's durable dedupe when present; without a Hub the in-flight set is the
 * whole dedupe. */
function createSlackL3Processor(
  accountId: string,
  botId?: string,
  runtime = getSlackRuntime(),
) {
  const hostRuntime = runtime;
  if (hostRuntime === undefined) return undefined;
  return createInboundEventProcessor({
    hostRuntime,
    channel: "slack",
    accountId,
    ...(botId !== undefined ? { botId } : {}),
    ...(hostRuntime.logging !== undefined
      ? {
          logger: hostRuntime.logging.getChildLogger({
            channel: "slack",
            accountId,
          }),
        }
      : {}),
  });
}

/** `plugin.gateway.startAccount` — probe the tokens, then run the Socket
 * Mode transport for the account's lifetime. */
// eslint-disable-next-line complexity -- this is the single account lifecycle transaction.
export async function startSlackAccount(
  ctx: StartAccountContext,
): Promise<void> {
  const log = ctx.log;
  const { accountId, botToken, appToken } = readSlackAccountTokens(ctx.account);
  if (botToken === undefined || appToken === undefined) {
    throw new Error(
      `Slack account "${accountId}" needs account.botToken (bot user token) + account.appToken (app-level token)`,
    );
  }
  assertNoDuplicateSlackBotTokens(ctx.cfg, accountId);

  // L4 auth.test probe on the bot token (blueprint §6.5). A bad bot token
  // fails the account here, before the socket ever starts.
  const probe = await probeSlackAuth(botToken, 2500, { accountId });
  if (!probe.ok) {
    throw new Error(
      `Slack auth.test failed for account "${accountId}": ${probe.error ?? "unknown"}`,
    );
  }
  if (probe.warning !== undefined) log?.warn?.(probe.warning);
  if (probe.teamId === undefined) {
    throw new Error(
      `Slack auth.test for account "${accountId}" returned no teamId; cannot route a shared app socket safely`,
    );
  }

  const processor = createSlackL3Processor(
    accountId,
    probe.botId,
    ctx["hostRuntime"] as HostRuntime | undefined,
  );
  const socket = acquireSharedSlackSocket({
    appToken,
    ...(log === undefined ? {} : { logger: log }),
  });
  const accountLifetime = new AbortController();
  const abortAccount = (): void => accountLifetime.abort();
  ctx.abortSignal.addEventListener("abort", abortAccount, { once: true });
  // COMPAT(clisbot-control-plane): the approval card's button-click seam. The
  // Hub supervisor mounts `channelRuntime.approvalAction` (the plane's
  // onApprovalCallback, the SAME exactly-once resolver as a typed command —
  // the click is data, never authority). Absent (unit posture, pinned
  // vertical) = no card clicks; the typed command still answers the prompt.
  // L4 narrows the channel envelope only (approval-card.ts); the card value
  // stays opaque to the vertical — the hub's card parser owns its format.
  const onInteractive = slackApprovalInteractive(
    ctx.channelRuntime,
    accountId,
    log,
  );
  // COMPAT(clisbot-control-plane): inbound media (F-06, G5+G6). When the Hub
  // fills `ctx.mediaDownloadDir`, the L2 folds a message's `files[]` into the
  // inbound body before the L3 handoff (the mirror of the Telegram vertical's
  // `downloadDir`). Absent (unit posture, pinned vertical) = text-only.
  // COMPAT(clisbot-control-plane): the account's registered native slash
  // command (`transport.slashCommand`, e.g. `/paseo`). Set = the L2 rewrites
  // matching `slash_commands` envelopes to the shared plain-text command form
  // (the hub's commands.ts owns the verbs); absent = native ingestion off.
  const transportRecord = ctx.account["transport"];
  const slashCommandSetting =
    typeof transportRecord === "object" && transportRecord !== null
      ? (transportRecord as Record<string, unknown>)["slashCommand"]
      : undefined;
  const slashCommand =
    typeof slashCommandSetting === "string" && slashCommandSetting !== ""
      ? slashCommandSetting
      : undefined;
  const mediaDownloadDir = resolveMediaDownloadDir(ctx);
  const media =
    mediaDownloadDir !== undefined
      ? { accountId, botToken, downloadDir: mediaDownloadDir }
      : undefined;
  const transport = createSlackSocketTransport({
    client: socket.client,
    sharedClient: true,
    identity: {
      ...(probe.botUserId !== undefined ? { botUserId: probe.botUserId } : {}),
      ...(probe.botId !== undefined ? { botId: probe.botId } : {}),
      ...(probe.teamId !== undefined ? { teamId: probe.teamId } : {}),
      ...(probe.apiAppId !== undefined ? { apiAppId: probe.apiAppId } : {}),
    },
    onInbound:
      processor !== undefined
        ? async (event) => {
            await processor.process(event);
          }
        : async () => {
            // No runtime yet (unit posture): drop the event — a drive surface
            // with no host is not a channel.
          },
    abortSignal: accountLifetime.signal,
    ...(log !== undefined ? { logger: log } : {}),
    ...(onInteractive !== undefined ? { onInteractive } : {}),
    ...(slashCommand !== undefined ? { slashCommand } : {}),
    ...(media !== undefined ? { media } : {}),
  });

  ctx.setStatus?.({
    channel: "slack",
    accountId,
    connected: true,
    lifecycle: "ready",
  });
  try {
    socket.start();
    await Promise.all([transport.start(), socket.wait(accountLifetime.signal)]);
  } finally {
    accountLifetime.abort();
    ctx.abortSignal.removeEventListener("abort", abortAccount);
    await socket.release();
    ctx.setStatus?.({ channel: "slack", accountId, connected: false });
  }
}

/**
 * COMPAT(clisbot-control-plane): the approval card's button-click seam. The
 * Hub supervisor mounts `channelRuntime.approvalAction` (the plane's
 * onApprovalCallback, the SAME exactly-once resolver as a typed command —
 * the click is data, never authority). Absent (unit posture, pinned
 * vertical) = no card clicks; the typed command still answers the prompt.
 * L4 narrows the channel envelope only (approval-card.ts); the card value
 * stays opaque to the vertical — the hub's card parser owns its format.
 * Returns undefined when no seam is wired.
 */
function slackApprovalInteractive(
  channelRuntime: Record<string, unknown> | undefined,
  accountId: string,
  logger?: HostChildLogger,
): ((body: Record<string, unknown>) => Promise<void>) | undefined {
  const approvalAction = channelRuntime?.["approvalAction"];
  if (typeof approvalAction !== "function") return undefined;
  const invoke = approvalAction as (
    params: Record<string, unknown>,
  ) => Promise<unknown>;
  return async (body: Record<string, unknown>): Promise<void> => {
    // The vertical parses the CHANNEL envelope only (who clicked, where the
    // card sits); the card value is opaque to the vertical — the hub's card
    // parser owns its format (one parse, hub-side).
    const click = parseApprovalCardClick(body);
    if (click === null) {
      // A block_actions that is not a posted-card click (a modal, or a
      // payload shape the parser does not own). Log the fingerprint so a
      // live card that fails to parse is visible instead of a silent
      // dead button.
      logger?.warn?.("slack approval card click did not parse", {
        accountId,
        payloadKeys: Object.keys(body),
      });
      return;
    }
    await invoke({
      channel: "slack",
      accountId,
      senderIdentity: `slack:${click.senderId}`,
      cardValue: click.cardValue,
      externalConversationId: click.rootChannelId,
      externalThreadId: click.threadTs ?? null,
      rootKind: approvalRootKind(click.rootChannelId),
    });
  };
}
