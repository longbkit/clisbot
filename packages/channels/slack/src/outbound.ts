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

import { statSync } from "node:fs";
import type { SendMediaFn, SendTextFn } from "@getpaseo/channels-shared";
import { evaluateOutboundMedia, mediaFileName } from "@getpaseo/channels-shared";
import { getSlackWriteClient, isSilentReplyText } from "./client/web-api.js";
import { readSlackAccountConfig } from "./lifecycle/start-account.js";
import { getSlackRuntime } from "./runtime.js";
import { renderSlackMrkdwn } from "./mrkdwn.js";
import { uploadSlackFile } from "./outbound-media.js";

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

/** The native card blocks an outbound post may carry (open-typed — the Hub's
 * card builder mints them in COMMONMARK, the same wording source as the text
 * fallback). The vertical renders every `mrkdwn` section through the same
 * pipeline as plain text before posting — Block Kit mrkdwn is NOT CommonMark
 * (`**bold**` would show literal asterisks), and posting the block text
 * verbatim is how the card drifted from the fallback rendering. */
function cardBlocksOf(args: Parameters<SendTextFn>[0]): Record<string, unknown>[] | undefined {
  const blocks = args["blocks"];
  if (!Array.isArray(blocks) || blocks.length === 0) return undefined;
  return (blocks as Record<string, unknown>[]).map(renderBlockMrkdwn);
}

/** Render one block's `mrkdwn` text fields (section-ish shapes) through
 * `renderSlackMrkdwn`; anything else (actions, dividers, context) passes
 * through untouched. */
function renderBlockMrkdwn(block: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...block };
  const text = block["text"];
  if (
    typeof text === "object" &&
    text !== null &&
    (text as Record<string, unknown>)["type"] === "mrkdwn" &&
    typeof (text as Record<string, unknown>)["text"] === "string"
  ) {
    const t = text as Record<string, unknown>;
    out["text"] = { ...t, text: renderSlackMrkdwn(String(t["text"])) };
  }
  const fields = block["fields"];
  if (Array.isArray(fields)) {
    out["fields"] = fields.map((field) => {
      if (
        typeof field === "object" &&
        field !== null &&
        (field as Record<string, unknown>)["type"] === "mrkdwn" &&
        typeof (field as Record<string, unknown>)["text"] === "string"
      ) {
        const f = field as Record<string, unknown>;
        return Object.assign({}, f, { text: renderSlackMrkdwn(String(f["text"])) });
      }
      return field;
    });
  }
  return out;
}

/** COMPAT(clisbot-control-plane): Post one text message to a conversation
 * (optionally a thread) and record it. Media is posted only through the Hub's
 * explicit `send_file` MCP tool, which routes into this vertical's
 * `sendMedia`; G7–G11 semantics remain unchanged. When `args.blocks`
 * carries the native approval card (COMPAT(clisbot-control-plane)), the card
 * posts with the escaped text as its fallback rendering (Slack requires a
 * `text` fallback for block posts); `cardPosted` tells the plane the post
 * carries interactive markup (the in-place-update target). */
export async function sendSlackText(
  args: Parameters<SendTextFn>[0],
): Promise<{ messageId: string; channel?: string | undefined; cardPosted?: boolean }> {
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
  const blocks = cardBlocksOf(args);
  // `chat.postMessage` is the Slack Web API method (L1), not the browser
  // `window.postMessage` — the target-origin rule is a name-based false
  // positive (the error is reported at the call's closing paren).
  // Render the agent markdown to mrkdwn at the outbound boundary (C5):
  // legitimate markup (code spans, fenced blocks, links, emphasis) renders;
  // `&`/`<`/`>` in text leaves are XML-escaped.
  /* eslint-disable eslint-plugin-unicorn/require-post-message-target-origin */
  const result = await client.chat.postMessage({
    channel: to,
    text: renderSlackMrkdwn(text),
    ...(blocks !== undefined ? { blocks } : {}),
    ...(threadId !== undefined && threadId !== "" ? { thread_ts: threadId } : {}),
  });
  /* eslint-enable eslint-plugin-unicorn/require-post-message-target-origin */
  const messageId = result.ts ?? "";
  void recordSlackSentMessage({ accountId, conversationId: to, ts: messageId });
  return {
    messageId,
    channel: result.channel,
    ...(blocks !== undefined ? { cardPosted: true } : {}),
  };
}

/**
 * COMPAT(clisbot-control-plane): the in-place update (`plugin.outbound
 * .updateText` → `chat.update`). The approval card's decided state
 * ("Approved by <sender>" / "Denied" / "Answered: <option>") lands here;
 * `clearCard` (the default when updating a card) strips the interactive
 * markup (`blocks: []`) so a stale button click after the resolution has no
 * live card to act on — the resolver's latch is the second line.
 */
export async function updateSlackText(
  args: Parameters<SendTextFn>[0] & {
    externalMessageId: string;
    clearCard?: boolean;
    /** COMPAT(clisbot-control-plane): a Slack user mention (the `<@U123>`
     * tag) for the responder, prepended to the decided-state text so the
     * decision names who answered. */
    senderMention?: string;
  },
): Promise<{ ok: boolean }> {
  const { cfg, accountId, to, text, externalMessageId, clearCard, senderMention } = args;
  const finalText =
    senderMention !== undefined && senderMention !== "" ? `${senderMention} ${text}` : text;
  const botToken = resolveOutboundBotToken(cfg, accountId);
  if (botToken === undefined) {
    throw new Error(
      `Slack updateText for account "${accountId}" found no cfg.channels.slack.accounts.${accountId}.botToken`,
    );
  }
  const client = await getSlackWriteClient(botToken);
  /* eslint-disable eslint-plugin-unicorn/require-post-message-target-origin */
  const result = await client.chat.update({
    channel: to,
    ts: externalMessageId,
    text: renderSlackMrkdwn(finalText),
    // Strip the card's buttons (the prompt is decided — a stale click must
    // have no live markup; thread_ts is irrelevant to an update in place).
    ...(clearCard !== false ? { blocks: [] } : {}),
  });
  /* eslint-enable eslint-plugin-unicorn/require-post-message-target-origin */
  if (result.ok === false) {
    throw new Error(`Slack chat.update failed: ${result.error ?? "unknown"}`);
  }
  return { ok: true };
}

/**
 * COMPAT(clisbot-control-plane): the native-media post
 * (`plugin.outbound.sendMedia`, G7–G11). One call posts ONE local media file
 * through the 3-step external upload (outbound-media.ts) — any file type
 * (the Slack API accepts arbitrary files; the upload rides
 * `application/octet-stream`). The G11 gate runs FIRST and is size-only: an
 * oversized file is not dropped — the in-channel notice is posted through
 * `chat.postMessage` and `mediaPosted` reports false. A transport fault
 * (missing file, upload fault) throws.
 */
export const sendMedia: SendMediaFn = async (args) => {
  const { cfg, accountId, to, threadId, filePath } = args;
  const botToken = resolveOutboundBotToken(cfg, accountId);
  if (botToken === undefined) {
    throw new Error(
      `Slack sendMedia for account "${accountId}" found no cfg.channels.slack.accounts.${accountId}.botToken`,
    );
  }
  const client = await getSlackWriteClient(botToken);
  const postNotice = (text: string): Promise<{ messageId: string }> =>
    sendSlackText({
      cfg,
      accountId,
      to: String(to),
      ...(threadId !== undefined && threadId !== "" ? { threadId } : {}),
      text,
    });
  const fileName = mediaFileName(filePath);
  let sizeBytes: number;
  try {
    sizeBytes = statSync(filePath).size;
  } catch {
    throw new Error(`Slack sendMedia: local media file not found: ${filePath}`);
  }
  const decision = evaluateOutboundMedia({
    sizeBytes,
    channel: "slack",
    fileName,
  });
  if (!decision.ok) {
    // G11: the file is not posted natively — post the notice instead.
    const notice = await postNotice(decision.notice);
    return { messageId: notice.messageId, mediaPosted: false };
  }
  const fileId = await uploadSlackFile({
    client,
    filePath,
    fileName,
    channelId: String(to),
    ...(threadId !== undefined && threadId !== "" ? { threadTs: threadId } : {}),
  });
  // `completeUploadExternal` returns the file id, not the new message ts; the
  // sent-file record keys on the file id (a file post's channel-native id).
  void recordSlackSentMessage({ accountId, conversationId: String(to), ts: fileId });
  return { messageId: fileId, mediaPosted: true };
};
