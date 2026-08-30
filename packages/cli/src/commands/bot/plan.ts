// COMPAT(clisbot-bot): pure planning for `bot start` (implementation doc §2.1).
// A bot is a composite — workspace + idle agent + channel account + route — and
// the plan is the single place that resolves the operator's flags into that
// bundle. Kept pure (no I/O) so idempotency and the flag semantics are testable
// in isolation; the orchestration in `run.ts` performs the side effects.

import type { CommandError } from "../../output/index.js";
import { resolveProviderAndModel } from "../../utils/provider-model.js";
import type { BotManifest } from "./manifest.js";
import { parseTokenInput } from "./token-input.js";
import type { ParsedTokenInput } from "./token-input.js";

export const BOT_TYPES = ["personal", "team"] as const;
export type BotType = (typeof BOT_TYPES)[number];

export const BOT_CHANNELS = ["slack", "telegram"] as const;
export type BotChannel = (typeof BOT_CHANNELS)[number];

/** The operator-supplied flags, in commander's camelCase shape. */
export interface BotStartOptions {
  provider?: string;
  model?: string;
  mode?: string;
  botType?: string;
  botName?: string;
  agentName?: string;
  workspace?: string;
  cwd?: string;
  newWorkspace?: string;
  slackBotToken?: string;
  slackAppToken?: string;
  slackAccount?: string;
  telegramBotToken?: string;
  telegramAccount?: string;
  persist?: boolean;
}

/** The fully-resolved bot bundle, ready for side effects. */
export interface BotStartPlan {
  name: string;
  botType: BotType;
  provider: string;
  model?: string;
  mode?: string;
  /** The workspace directory the bot's agent lives in. */
  workspacePath: string;
  /** `local` or `worktree` — the daemon workspace isolation, as in `run`. */
  isolation: string;
  agentTitle: string;
  channel: BotChannel;
  account: string;
  persist: boolean;
  /** The channel credential input, resolved to its secret before side effects. */
  credential: BotCredentialPlan;
  /** The intended route, as a one-line note for the manifest and output. */
  routeNote: string;
}

export interface BotCredentialPlan {
  channel: BotChannel;
  account: string;
  input: ParsedTokenInput;
  /** A second, channel-specific credential (Slack's app token). */
  secondary?: ParsedTokenInput;
}

const DEFAULT_ISOLATION = "local";
const WORKSPACE_ISOLATIONS = ["local", "worktree"] as const;

export function buildBotStartPlan(options: BotStartOptions, home: string): BotStartPlan {
  const botType = resolveBotType(options.botType);
  const name = (options.botName ?? `${botType}-assistant`).trim();
  const providerModel = resolveProviderAndModel({
    provider: options.provider,
    model: options.model,
  });
  const credential = resolveCredential(options, name);
  const isolation = resolveIsolation(options.newWorkspace);
  const workspacePath = resolveWorkspacePath(options, home);
  const agentTitle = options.agentName?.trim() || name;
  return {
    name,
    botType,
    provider: providerModel.provider,
    ...(providerModel.model === undefined ? {} : { model: providerModel.model }),
    ...(options.mode?.trim() ? { mode: options.mode.trim() } : {}),
    workspacePath,
    isolation,
    agentTitle,
    channel: credential.channel,
    account: credential.account,
    persist: options.persist === true,
    credential,
    routeNote: buildRouteNote(credential.channel, credential.account, agentTitle),
  };
}

function resolveBotType(raw: string | undefined): BotType {
  const value = raw?.trim() || "personal";
  if (!BOT_TYPES.includes(value as BotType)) {
    throw commandError("INVALID_BOT_TYPE", `--bot-type must be one of: ${BOT_TYPES.join(", ")}`);
  }
  return value as BotType;
}

function resolveIsolation(raw: string | undefined): string {
  const value = raw?.trim() || DEFAULT_ISOLATION;
  if (!(WORKSPACE_ISOLATIONS as readonly string[]).includes(value)) {
    throw commandError(
      "INVALID_WORKSPACE",
      `--new-workspace must be one of: ${WORKSPACE_ISOLATIONS.join(", ")}`,
    );
  }
  return value;
}

function resolveWorkspacePath(options: BotStartOptions, home: string): string {
  const explicit = options.workspace?.trim() || options.cwd?.trim();
  if (explicit !== undefined) return explicit;
  return `${home}/workspaces/default`;
}

/** At least one channel credential is required; one bot answers on one channel. */
function resolveCredential(options: BotStartOptions, botName: string): BotCredentialPlan {
  const slackBot = options.slackBotToken?.trim();
  const telegramBot = options.telegramBotToken?.trim();
  if (slackBot !== undefined && telegramBot !== undefined) {
    throw commandError(
      "MULTIPLE_CHANNELS",
      "one bot answers on one channel: pass either --slack-bot-token or --telegram-bot-token, " +
        "and run `bot start` again for a second channel",
    );
  }
  if (slackBot !== undefined) {
    return {
      channel: "slack",
      account: options.slackAccount?.trim() || botName,
      input: parseRequiredToken("slack-bot-token", slackBot),
      ...(options.slackAppToken?.trim()
        ? { secondary: parseTokenInput(options.slackAppToken.trim()) }
        : {}),
    };
  }
  if (telegramBot !== undefined) {
    return {
      channel: "telegram",
      account: options.telegramAccount?.trim() || botName,
      input: parseRequiredToken("telegram-bot-token", telegramBot),
    };
  }
  throw commandError(
    "MISSING_CREDENTIAL",
    "a channel credential is required to start a bot: pass --slack-bot-token or --telegram-bot-token " +
      "(a literal value, ${ENV_VAR}, or a secret-file path)",
  );
}

function parseRequiredToken(flag: string, raw: string): ParsedTokenInput {
  if (raw.length === 0) {
    throw commandError("MISSING_CREDENTIAL", `--${flag} requires a non-empty value`);
  }
  return parseTokenInput(raw);
}

/**
 * The one line that tells the operator what the route must say: the channel
 * account is not wired to the agent by `bot start` (routes live in the active
 * config, authored by `hub init`/`hub deploy`), so this is the exact mapping to
 * add. It is recorded in the manifest so a later `bot status` can explain it.
 */
export function buildRouteNote(channel: BotChannel, account: string, agent: string): string {
  return `add a ${channel} route matching account "${account}" that targets agent "${agent}" in the active config`;
}

/** True when the flags are unchanged from an existing manifest (reuse, no re-create). */
export function planUnchanged(existing: BotManifest, plan: BotStartPlan): boolean {
  return (
    existing.botType === plan.botType &&
    existing.provider === plan.provider &&
    (existing.model ?? undefined) === (plan.model ?? undefined) &&
    (existing.mode ?? undefined) === (plan.mode ?? undefined) &&
    existing.channel === plan.channel &&
    existing.account === plan.account &&
    existing.agentTitle === plan.agentTitle
  );
}

/** Assemble a manifest from the plan plus the daemon ids the side effects return. */
export function buildBotManifest(
  plan: BotStartPlan,
  ids: { workspaceId: string; agentId: string },
  now: Date = new Date(),
): BotManifest {
  const credentialKey = `${plan.credential.channel}:${plan.credential.account}`;
  return {
    version: 1,
    name: plan.name,
    botType: plan.botType,
    provider: plan.provider,
    ...(plan.model === undefined ? {} : { model: plan.model }),
    ...(plan.mode === undefined ? {} : { mode: plan.mode }),
    workspacePath: plan.workspacePath,
    workspaceId: ids.workspaceId,
    agentId: ids.agentId,
    agentTitle: plan.agentTitle,
    channel: plan.channel,
    account: plan.account,
    credentials: { [credentialKey]: { persisted: plan.persist } },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function commandError(code: string, message: string): CommandError {
  return { code, message };
}
