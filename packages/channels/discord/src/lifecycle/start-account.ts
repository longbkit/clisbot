// L4 account lifecycle (blueprint §6.5 L4, start-account.md): resolve the token,
// probe the application/bot identity, install the account's ported plugin runtime,
// register the L3 inbound processor, then hand off to the L2 gateway transport.
// The startAccount promise resolves only when `ctx.abortSignal` fires — "start"
// is the transport lifetime.

import type { HostRuntime, StartAccountContext } from "@getpaseo/channels-shared";
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { resolveDiscordAccount } from "../accounts.js";
import { parseApplicationIdFromToken, probeDiscord } from "../probe.js";
import { installDiscordRuntime } from "../fusion/runtime.js";
import { registerAccountInbound, unregisterAccountInbound } from "../runtime-store.js";
import {
  type DiscordGatewayOutcome,
  resolveDiscordGatewayIntents,
  runDiscordGateway,
} from "../transport/gateway.js";

/** One live gateway per bot identity: Discord refuses a second IDENTIFY for the
 * same token on the same shard, so a duplicate account is a configuration fault
 * the vertical reports instead of a silent reconnect loop. */
const activeGateways = new Map<string, string>();

/** `GET /users/@me` bound; the account start must not hang on a dead network. */
const DISCORD_IDENTITY_PROBE_TIMEOUT_MS = 15_000;

export function claimDiscordGateway(botId: string, accountId: string): () => void {
  const owner = activeGateways.get(botId);
  if (owner !== undefined && owner !== accountId) {
    throw new Error(
      `Discord bot ${botId} is already connected by account "${owner}"; one bot token may hold one gateway session. Remove the stray account entry.`,
    );
  }
  activeGateways.set(botId, accountId);
  return () => {
    if (activeGateways.get(botId) === accountId) activeGateways.delete(botId);
  };
}

/** The duplicate-token guard across the configured accounts (the Telegram
 * vertical's `assertNoDuplicateTelegramTokens`, same rule for Discord).
 *
 * Every pair is compared, not just each account against the first one with a
 * token: `a=X, b=Y, c=Y` shares a token between `b` and `c` and must be
 * refused, which a single-owner scan misses. */
export function assertNoDuplicateDiscordTokens(cfg: OpenClawConfig, accountId: string): void {
  const accounts = cfg.channels?.discord?.accounts;
  if (accounts === undefined) return;
  const owners = new Map<string, string>();
  for (const [id, entry] of Object.entries(accounts)) {
    const token = typeof entry?.token === "string" ? entry.token.trim() : "";
    if (token === "") continue;
    const owner = owners.get(token);
    if (owner !== undefined) {
      throw new Error(
        `duplicate Discord bot token configured for accounts "${owner}" and "${id}" — one bot token may serve one account.`,
      );
    }
    owners.set(token, id);
  }
  void accountId;
}

export interface DiscordIdentity {
  botId: string;
  applicationId: string;
  botUsername?: string;
}

/** Resolve the bot identity without a network round trip when the token carries
 * it (Discord encodes the application id in the token's first segment), falling
 * back to `GET /users/@me` through the ported probe. */
export async function resolveDiscordIdentity(params: {
  token: string;
  configuredApplicationId?: string;
}): Promise<DiscordIdentity> {
  const fromToken = parseApplicationIdFromToken(params.token);
  const probe = await probeDiscord(params.token, DISCORD_IDENTITY_PROBE_TIMEOUT_MS);
  if (!probe.ok) {
    throw new Error(`discord: bot token probe failed: ${probe.error ?? "unknown error"}`);
  }
  const botId = probe.bot?.id ?? fromToken;
  const applicationId = params.configuredApplicationId ?? fromToken ?? botId;
  if (!botId || !applicationId) {
    throw new Error("discord: could not resolve the bot identity from the configured token");
  }
  return {
    botId,
    applicationId,
    ...(probe.bot?.username ? { botUsername: probe.bot.username } : {}),
  };
}

/** `plugin.gateway.startAccount` — the drive surface entry. Resolves on abort.
 * Steps: token → identity probe → duplicate guard → L2 gateway. */
export async function startDiscordAccount(
  ctx: StartAccountContext,
  hostRuntime: HostRuntime,
): Promise<void> {
  const log = ctx.log;
  const cfg = ctx.cfg as unknown as OpenClawConfig;
  const { accountId, abortSignal } = ctx;
  if (cfg === undefined || cfg === null) {
    throw new Error("discord startAccount requires a runtime config (ctx.cfg)");
  }
  assertNoDuplicateDiscordTokens(cfg, accountId);
  const account = resolveDiscordAccount({ cfg, accountId });
  if (!account.token) {
    throw new Error(`discord account "${accountId}" has no usable bot token`);
  }
  installDiscordRuntime(hostRuntime, accountId);
  const identity = await resolveDiscordIdentity({
    token: account.token,
    ...(account.config.applicationId
      ? { configuredApplicationId: account.config.applicationId }
      : {}),
  });
  const release = claimDiscordGateway(identity.botId, accountId);
  let inbound: ReturnType<typeof registerAccountInbound>;
  try {
    inbound = registerAccountInbound(accountId, identity.botId, hostRuntime);
  } catch (error) {
    release();
    throw error;
  }
  log?.info?.("discord account started", { accountId, botId: identity.botId });
  ctx.setStatus({
    state: "connected",
    accountId,
    botId: identity.botId,
    botUsername: identity.botUsername ?? null,
  });
  let outcome: DiscordGatewayOutcome = { stopped: "abort" };
  try {
    outcome = await runDiscordGateway({
      accountId,
      token: account.token,
      botId: identity.botId,
      applicationId: identity.applicationId,
      intents: resolveDiscordGatewayIntents(
        account.config.intents ? { intentsConfig: account.config.intents } : {},
      ),
      ...(account.config.proxy ? { proxyUrl: account.config.proxy } : {}),
      abortSignal,
      ...(log !== undefined ? { logger: log } : {}),
      onEvent: async (event) => {
        // L3 dedupe / durable admission / handoff: the shared processor this
        // account registered. Admission happens before anything is acknowledged.
        await inbound.handleInbound(event);
      },
    });
  } finally {
    unregisterAccountInbound(accountId, hostRuntime);
    release();
    ctx.setStatus({ state: "stopped", accountId });
  }
  if (outcome.stopped === "error") {
    // The gateway gave up (bad token, disallowed intent, reconnect budget
    // spent). The supervisor parks a rejected monitor as `failed` with this
    // reason; resolving here would report the account as cleanly stopped.
    ctx.setStatus({ state: "failed", accountId, error: outcome.reason });
    throw new Error(`discord account "${accountId}" gateway stopped: ${outcome.reason}`);
  }
}
