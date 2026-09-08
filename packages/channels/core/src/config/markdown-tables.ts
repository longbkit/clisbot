// upstream: src/config/markdown-tables.ts@5d8067a4483
// D-CORE-223: upstream resolves the effective table mode by walking the live
// plugin registry (`listChannelPlugins()` → `messaging.defaultMarkdownTableMode`)
// and the routed account. Fusion has no in-process channel registry — the Hub
// resolves the account before the send — so the per-channel defaults are a
// static map transcribed from the upstream plugin definitions, and the section
// is read off the config the caller already scoped. Everything else matches
// upstream: the precedence order (account override → channel section → the
// channel's own default → "code") and the `supportsBlockTables` downgrade to
// "code".
import type { MarkdownTableMode } from "./types.base.js";
import type { OpenClawConfig } from "./types.openclaw.js";

/**
 * `messaging.defaultMarkdownTableMode` per channel, transcribed from the
 * upstream plugin definitions at 5d8067a4483. A channel that declares none
 * (Slack, Discord, Feishu, Google Chat, Zalo) falls through to "code", which is
 * upstream's registry fallback.
 */
const CHANNEL_DEFAULT_MARKDOWN_TABLE_MODES: ReadonlyMap<string, MarkdownTableMode> = new Map([
  // extensions/telegram/src/channel.ts:842
  ["telegram", "block"],
  // extensions/matrix/src/channel.ts:455
  ["matrix", "block"],
  // extensions/mattermost/src/channel.ts:783
  ["mattermost", "off"],
  // extensions/signal/src/shared.ts:138
  ["signal", "bullets"],
  // extensions/whatsapp/src/shared.ts:233
  ["whatsapp", "bullets"],
]);

const DEFAULT_MARKDOWN_TABLE_MODE: MarkdownTableMode = "code";

const MARKDOWN_TABLE_MODES: ReadonlySet<string> = new Set(["off", "bullets", "code", "block"]);

function readTableMode(value: unknown): MarkdownTableMode | undefined {
  return typeof value === "string" && MARKDOWN_TABLE_MODES.has(value)
    ? (value as MarkdownTableMode)
    : undefined;
}

type MarkdownConfigEntry = { markdown?: { tables?: unknown } };
type MarkdownConfigSection = MarkdownConfigEntry & {
  accounts?: Record<string, MarkdownConfigEntry>;
};

/** Resolves the markdown table rendering mode for one channel/account send. */
export function resolveMarkdownTableMode(params: {
  cfg?: OpenClawConfig;
  channel?: string | null;
  accountId?: string | null;
  sessionKey?: string | null;
  /** Channel can render native block tables; "block" only survives when true. */
  supportsBlockTables?: boolean;
}): MarkdownTableMode {
  const channel = params.channel ?? null;
  const defaultMode = channel
    ? (CHANNEL_DEFAULT_MARKDOWN_TABLE_MODES.get(channel) ?? DEFAULT_MARKDOWN_TABLE_MODE)
    : DEFAULT_MARKDOWN_TABLE_MODE;
  const resolved = channel ? resolveAuthoredMode(params, channel) : undefined;
  const mode = resolved ?? defaultMode;
  return mode === "block" && params.supportsBlockTables !== true
    ? DEFAULT_MARKDOWN_TABLE_MODE
    : mode;
}

/** The authored override: the account entry wins over the channel section. */
function resolveAuthoredMode(
  params: { cfg?: OpenClawConfig; accountId?: string | null },
  channel: string,
): MarkdownTableMode | undefined {
  const cfg = params.cfg as
    | { channels?: Record<string, unknown>; [key: string]: unknown }
    | undefined;
  if (!cfg) {
    return undefined;
  }
  const section = (cfg.channels?.[channel] ?? cfg[channel]) as MarkdownConfigSection | undefined;
  if (!section) {
    return undefined;
  }
  const account = params.accountId ? section.accounts?.[params.accountId] : undefined;
  return readTableMode(account?.markdown?.tables) ?? readTableMode(section.markdown?.tables);
}
