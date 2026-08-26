// Outbound (blueprint §6.5: `plugin.outbound.sendText` + `recordSentMessage`
// write-back to the plane's keyed-store seam — DEVIATIONS D-001). Sync
// reference: @openclaw/slack@2026.7.1 dist/outbound-*.js
// [extensions/slack/src/outbound-adapter.ts, send.ts, sent-thread-cache.ts].
//
// `sendText` posts one text message through the write-path WebClient (no
// retries — the Hub's delivery ledger owns retry accounting,
// SLACK_WRITE_RETRY_OPTIONS) and returns the channel-native message ts.
// `recordSentMessage` persists "the bot sent message N in conversation C"
// through the plane's keyed-store seam, the same contract as telegram's
// `telegram.sent-messages` (state-store-namespaces.md §Slack; D-001).

import type { SendTextFn } from "@getpaseo/channels-shared";
import { getSlackWriteClient, isSilentReplyText } from "./client/web-api.js";
import { readSlackAccountConfig } from "./lifecycle/start-account.js";
import { getSlackRuntime } from "./runtime.js";

/** The pinned `sent-messages` record: "the bot sent message N in chat C." */
export interface SlackSentMessageRecord {
  /** The channel-native message ts. */
  ts: string;
  /** When it was recorded, ms. */
  recordedAt: number;
}

/** The keyed-store seam namespace (state-store-namespaces.md §Slack). */
export const SLACK_SENT_MESSAGES_NAMESPACE = "slack.sent-messages";
export const SLACK_SENT_MESSAGES_MAX_ENTRIES = 10_000;

/** Resolve the bot token from the drive-time cfg (the outbound path reads
 * tokens from cfg, not from ctx.account — start-account.md "Token source"). */
function resolveOutboundBotToken(
  cfg: Record<string, unknown>,
  accountId: string,
): string | undefined {
  const accountConfig = readSlackAccountConfig(cfg, accountId);
  const token = accountConfig["botToken"];
  return typeof token === "string" && token.trim() !== "" ? token : undefined;
}

/** The keyed-store key for one sent message (accountId-scoped). */
export function slackSentMessageKey(accountId: string, conversationId: string, ts: string): string {
  return `${accountId}:${conversationId}:${ts}`;
}

/** `recordSentMessage` write-back (DEVIATIONS D-001): persist the sent
 * message through the plane's keyed-store seam so a later read can answer
 * "did the bot already send this?" Best-effort — a missing runtime (unit
 * posture) or a store fault is logged, not thrown. */
export async function recordSlackSentMessage(params: {
  accountId: string;
  conversationId: string;
  ts: string;
}): Promise<void> {
  const runtime = getSlackRuntime();
  if (runtime === undefined) return;
  const { accountId, conversationId, ts } = params;
  if (accountId === "" || conversationId === "" || ts === "") return;
  try {
    const store = runtime.state.openKeyedStore({
      namespace: SLACK_SENT_MESSAGES_NAMESPACE,
      maxEntries: SLACK_SENT_MESSAGES_MAX_ENTRIES,
    });
    await store.register(slackSentMessageKey(accountId, conversationId, ts), {
      ts,
      recordedAt: Date.now(),
    } satisfies SlackSentMessageRecord);
  } catch (error) {
    runtime.logging
      .getChildLogger({ channel: "slack", accountId })
      .warn("slack sent-message record failed", {
        error: error instanceof Error ? error.message : String(error),
      });
  }
}

/** Post one text message to a conversation (optionally a thread) and record
 * it. The Hub's relay posts final answers through this. */
export async function sendSlackText(
  args: Parameters<SendTextFn>[0],
): Promise<{ messageId: string; channel?: string | undefined }> {
  const { cfg, accountId, to, text, threadId } = args;
  const botToken = resolveOutboundBotToken(cfg, accountId);
  if (botToken === undefined) {
    throw new Error(
      `Slack sendText for account "${accountId}" found no cfg.channels.slack.accounts.${accountId}.botToken`,
    );
  }
  if (isSilentReplyText(text)) {
    // NO_REPLY is the silent-answer token; post nothing.
    return { messageId: "" };
  }
  const client = await getSlackWriteClient(botToken);
  // `chat.postMessage` is the Slack Web API method (L1), not the browser
  // `window.postMessage` — the target-origin rule is a name-based false
  // positive (the error is reported at the call's closing paren).
  /* eslint-disable eslint-plugin-unicorn/require-post-message-target-origin */
  const result = await client.chat.postMessage({
    channel: to,
    text,
    ...(threadId !== undefined && threadId !== "" ? { thread_ts: threadId } : {}),
  });
  /* eslint-enable eslint-plugin-unicorn/require-post-message-target-origin */
  const messageId = result.ts ?? "";
  void recordSlackSentMessage({ accountId, conversationId: to, ts: messageId });
  return { messageId, channel: result.channel };
}
