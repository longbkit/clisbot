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
import { resolveSlackWebClientOptions } from "../client-options.js";
import {
  probeSlackAuth,
  type SlackAuthProbeResult,
  type WebClient,
} from "../client/web-api.js";
import { createSlackBoltProvider } from "../monitor/provider.js";
import { getSlackHostRuntime } from "../runtime-store.js";
import { approvalRootKind, parseApprovalCardClick } from "../transport/approval-card.js";

/** Bolt's Socket Mode receiver builds its own `WebClient`, so it does not see
 * the API URL every other Slack call resolves through
 * `resolveSlackWebClientOptions` (`SLACK_API_URL`). Without this the receiver
 * always dials `slack.com`, which breaks an API-proxied workspace and makes the
 * transport untestable against a simulated platform. Only the URL crosses over;
 * the receiver keeps its own fetch and retry policy. */
function resolveSlackReceiverClientOptions(): Record<string, unknown> {
  const { slackApiUrl } = resolveSlackWebClientOptions();
  return slackApiUrl === undefined ? {} : { slackApiUrl };
}

/** The pinned default account id when `ctx.account` carries no `accountId`. */
export const SLACK_DEFAULT_ACCOUNT_ID = "default";

/**
 * The boot probe's budget. Upstream never probes at `startAccount`, so there is
 * no upstream number to inherit: its `probeSlack` default (2500 ms) belongs to
 * the interactive health check, where a fast answer beats a complete one. Boot
 * is the opposite trade — a busy host that answers `auth.test` in four seconds
 * must still get its Slack lane. Wave 5 lost the account on two consecutive
 * boots at load average > 10 while `curl` to the same endpoint answered in
 * 0.6 s (docs/tests/channels/p0-live-scenarios.md).
 */
export const SLACK_START_PROBE_TIMEOUT_MS = 15_000;

/**
 * `auth.test` at boot: the Fusion budget, one retry, and a loud `error` naming
 * the budget so a slow host never drops the lane silently. Only a transport
 * fault or timeout is retried (`status === null`); a Slack-answered rejection
 * — `invalid_auth`, `account_inactive` — is final and fails the account now.
 */
export async function probeSlackAuthAtStart(
  botToken: string,
  opts: {
    accountId: string;
    log?: HostChildLogger;
    client?: WebClient;
    timeoutMs?: number;
  },
): Promise<SlackAuthProbeResult> {
  const timeoutMs = opts.timeoutMs ?? SLACK_START_PROBE_TIMEOUT_MS;
  const probeOnce = async (): Promise<SlackAuthProbeResult> =>
    await probeSlackAuth(botToken, timeoutMs, {
      accountId: opts.accountId,
      ...(opts.client !== undefined ? { client: opts.client } : {}),
    });
  const first = await probeOnce();
  if (first.ok || first.status !== null) return first;
  opts.log?.error?.(
    `Slack auth.test for account "${opts.accountId}" did not answer within the ${timeoutMs}ms start budget (${first.error ?? "unknown"}); retrying once before failing the account`,
  );
  const second = await probeOnce();
  if (!second.ok && second.status === null) {
    opts.log?.error?.(
      `Slack auth.test for account "${opts.accountId}" failed twice within the ${timeoutMs}ms start budget (${second.error ?? "unknown"}); the account will not start`,
    );
  }
  return second;
}

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
function readStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

/** Read the token fields off the flat `ctx.account`. */
export function readSlackAccountTokens(account: Record<string, unknown>): {
  accountId: string;
  botToken?: string;
  appToken?: string;
} {
  const accountId = readStringField(account, "accountId") ?? SLACK_DEFAULT_ACCOUNT_ID;
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

/** Resolve the bot token from the drive-time cfg (the outbound path reads
 * tokens from cfg, not from ctx.account — start-account.md "Token source").
 * Shared with the typing adapter (typing.ts). */
export function resolveOutboundBotToken(
  cfg: Record<string, unknown>,
  accountId: string,
): string | undefined {
  const accountConfig = readSlackAccountConfig(cfg, accountId);
  const token = accountConfig["botToken"];
  return typeof token === "string" && token.trim() !== "" ? token : undefined;
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
  const accounts = slack?.["accounts"] as Record<string, Record<string, unknown>> | undefined;
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
  runtime = getSlackHostRuntime(),
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
export async function startSlackAccount(ctx: StartAccountContext): Promise<void> {
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
  const probe = await probeSlackAuthAtStart(botToken, { accountId, ...(log ? { log } : {}) });
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
  const onInteractive = slackApprovalInteractive(ctx.channelRuntime, accountId, log);
  // COMPAT(clisbot-control-plane): inbound media (F-06, G5+G6). When the Hub
  // fills `ctx.mediaDownloadDir`, the provider folds a message's `files[]` into
  // the inbound body before admission (the mirror of the Telegram vertical's
  // `downloadDir`). Absent (unit posture) = text-only.
  // COMPAT(clisbot-control-plane): the account's registered native slash
  // command (`transport.slashCommand`, e.g. `/paseo`). Set = the provider
  // rewrites matching `slash_commands` payloads to the shared plain-text
  // command form (the hub's commands.ts owns the verbs); absent = native
  // ingestion off.
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
    mediaDownloadDir !== undefined ? { accountId, downloadDir: mediaDownloadDir } : undefined;
  const provider = createSlackBoltProvider({
    botToken,
    appToken,
    identity: {
      ...(probe.botUserId !== undefined ? { botUserId: probe.botUserId } : {}),
      ...(probe.botId !== undefined ? { botId: probe.botId } : {}),
      ...(probe.teamId !== undefined ? { teamId: probe.teamId } : {}),
      ...(probe.apiAppId !== undefined ? { apiAppId: probe.apiAppId } : {}),
    },
    ...(probe.botId !== undefined ? { botId: probe.botId } : {}),
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
    clientOptions: resolveSlackReceiverClientOptions(),
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
    await provider.start();
  } finally {
    accountLifetime.abort();
    ctx.abortSignal.removeEventListener("abort", abortAccount);
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
  const invoke = approvalAction as (params: Record<string, unknown>) => Promise<unknown>;
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
