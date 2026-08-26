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

import { SocketModeClient } from "@slack/socket-mode";
import { createInboundEventProcessor, type StartAccountContext } from "@getpaseo/channels-shared";
import { probeSlackAuth } from "../client/web-api.js";
import { getSlackRuntime } from "../runtime.js";
import { createSlackSocketTransport } from "../transport/socket-mode.js";

/** The pinned default account id when `ctx.account` carries no `accountId`. */
export const SLACK_DEFAULT_ACCOUNT_ID = "default";

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

/** `plugin.gateway.startAccount` — probe the tokens, then run the Socket
 * Mode transport for the account's lifetime. */
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
  const probe = await probeSlackAuth(botToken, 2500, { accountId });
  if (!probe.ok) {
    throw new Error(
      `Slack auth.test failed for account "${accountId}": ${probe.error ?? "unknown"}`,
    );
  }
  if (probe.warning !== undefined) log?.warn?.(probe.warning);

  // L3 processor (shared, channel-agnostic): the inboundLedger sink is the
  // Hub's durable dedupe when present; without a Hub the in-flight set is
  // the whole dedupe (unit-test posture).
  const hostRuntime = getSlackRuntime();
  const processor =
    hostRuntime !== undefined
      ? createInboundEventProcessor({
          hostRuntime,
          channel: "slack",
          accountId,
          ...(probe.botId !== undefined ? { botId: probe.botId } : {}),
          ...(hostRuntime.logging !== undefined
            ? {
                logger: hostRuntime.logging.getChildLogger({
                  channel: "slack",
                  accountId,
                }),
              }
            : {}),
        })
      : undefined;

  const client = new SocketModeClient({
    appToken,
    autoReconnectEnabled: true,
    clientPingTimeout: 15000,
  });
  const transport = createSlackSocketTransport({
    client,
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
    abortSignal: ctx.abortSignal,
    ...(log !== undefined ? { logger: log } : {}),
  });

  ctx.setStatus?.({ channel: "slack", accountId, connected: true, lifecycle: "ready" });
  try {
    await transport.start();
  } finally {
    ctx.setStatus?.({ channel: "slack", accountId, connected: false });
  }
}
