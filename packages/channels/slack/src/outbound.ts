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
import type { HostRuntime, SendMediaFn, SendTextFn } from "@getpaseo/channels-shared";
import { evaluateOutboundMedia, mediaFileName } from "@getpaseo/channels-shared";
import { getSlackWriteClient, isSilentReplyText } from "./client/web-api.js";
import { sendMessageSlack } from "./send.js";
import { resolveSlackOutboundPresentationMessages } from "./presentation-outbound.js";
import type { MessagePresentationBlockNote } from "@getpaseo/channels-core/plugin-sdk/interactive-runtime";
import type { SlackReplyDeliveryMessage } from "./reply-blocks.js";
import { rememberSlackDriveConfig } from "./fusion/plugin-config.js";
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { resolveOutboundBotToken } from "./lifecycle/start-account.js";
import { refreshSlackTypingAfterPost } from "./typing.js";
import { getSlackHostRuntime } from "./runtime-store.js";
import { normalizeSlackOutboundText } from "./format.js";
import { uploadSlackFile } from "./outbound-media.js";

/** The upstream send's config and block argument types, named locally so the
 * shared plugin record's open `Record<string, unknown>` args can be narrowed at
 * the one call site (D-035). */
type SlackSendCfg = OpenClawConfig;
type SlackSendOptions = Parameters<typeof sendMessageSlack>[2];
type SlackSendResult = Awaited<ReturnType<typeof sendMessageSlack>>;
type SlackSendBlocks = NonNullable<SlackSendOptions["blocks"]>;
type SlackSendClient = NonNullable<Parameters<typeof sendMessageSlack>[2]["client"]>;

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
  hostRuntime?: HostRuntime;
}): Promise<void> {
  // Named account first: the unkeyed slot belongs to whichever account the
  // entry was driven with last, and this record IS per-account state.
  const runtime = params.hostRuntime ?? getSlackHostRuntime(params.accountId);
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
 * `normalizeSlackOutboundText`; anything else (actions, dividers, context) passes
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
    out["text"] = { ...t, text: normalizeSlackOutboundText(String(t["text"])) };
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
        return Object.assign({}, f, {
          text: normalizeSlackOutboundText(String(f["text"])),
        });
      }
      return field;
    });
  }
  return out;
}

/** COMPAT(clisbot-control-plane): Post one text message to a conversation
 * (optionally a thread) and record it. Media is posted only through the
 * `message` tool's media params (`media`/`attachments`/`buffer`), which route
 * into this vertical's `sendMedia`; G7–G11 semantics remain unchanged. When `args.blocks`
 * carries the native approval card (COMPAT(clisbot-control-plane)), the card
 * posts with the escaped text as its fallback rendering (Slack requires a
 * `text` fallback for block posts); `cardPosted` tells the plane the post
 * carries interactive markup (the in-place-update target). */
export async function sendSlackText(args: Parameters<SendTextFn>[0]): Promise<{
  messageId: string;
  channel?: string | undefined;
  cardPosted?: boolean;
}> {
  const { cfg, accountId, to, text, threadId } = args;
  const hostRuntime = args["hostRuntime"] as HostRuntime | undefined;
  rememberSlackDriveConfig(cfg);
  if (isSilentReplyText(text)) {
    // NO_REPLY is the silent-answer token; post nothing.
    return { messageId: "" };
  }
  const { result, cardPosted } = await deliverSlackText(args);
  await refreshSlackTypingAfterPost({ accountId, to, threadId });
  void recordSlackSentMessage({
    accountId,
    conversationId: result.channelId || to,
    ts: result.messageId,
    ...(hostRuntime === undefined ? {} : { hostRuntime }),
  });
  return {
    messageId: result.messageId,
    channel: result.channelId,
    ...(cardPosted ? { cardPosted: true } : {}),
  };
}

/**
 * Posts what one `sendText` call carries: the compiled presentation when it has
 * one (D-W6-01), otherwise the text plus any native card blocks. `cardPosted`
 * is the plane's fact that the post carries markup it can update in place.
 */
async function deliverSlackText(
  args: Parameters<SendTextFn>[0],
): Promise<{ result: SlackSendResult; cardPosted: boolean }> {
  const { cfg, accountId, to, text, threadId } = args;
  const blocks = cardBlocksOf(args);
  // Upstream's own client injection point (`SlackSendOpts.client`), surfaced on
  // the open drive-surface args so a test can post through a fake WebClient
  // without reaching into the write-client cache.
  const client = args["client"] as SlackSendClient | undefined;
  const post = (message: string, opts: Partial<SlackSendOptions>) =>
    sendMessageSlack(to, message, {
      cfg: cfg as unknown as SlackSendCfg,
      accountId,
      ...(client === undefined ? {} : { client }),
      ...(threadId !== undefined && threadId !== "" ? { threadTs: threadId } : {}),
      ...opts,
    });
  // A portable `presentation` posts as native Block Kit — charts, tables and
  // controls — instead of core's flattened fallback text.
  const presented = resolveSlackOutboundPresentationMessages({
    text,
    presentation: args["presentation"],
  });
  logPresentationAdmission({
    accountId,
    notes: presented.notes,
    hostRuntime: args["hostRuntime"] as HostRuntime | undefined,
  });
  if (presented.messages.length === 0) {
    const result = await post(
      text,
      blocks === undefined ? {} : { blocks: blocks as unknown as SlackSendBlocks },
    );
    return { result, cardPosted: blocks !== undefined };
  }
  return {
    result: await postPresentationMessages(presented.messages, post),
    cardPosted: presented.messages.some((message) => (message.blocks?.length ?? 0) > 0),
  };
}

/** D-W6-02: what admission repaired or refused is an operator fact — the tool
 * result the model reads is the Hub's to write, but the account's log must not
 * be the one place a dropped block is invisible. */
function logPresentationAdmission(params: {
  accountId: string;
  notes: readonly MessagePresentationBlockNote[];
  hostRuntime?: HostRuntime | undefined;
}): void {
  if (params.notes.length === 0) return;
  const runtime = params.hostRuntime ?? getSlackHostRuntime(params.accountId);
  runtime?.logging
    .getChildLogger({ channel: "slack", accountId: params.accountId })
    .warn("slack presentation admission", { notes: params.notes });
}

/**
 * Posts the compiled presentation messages in order and reports the first one.
 *
 * A presentation can compile into more than one Slack message (native data
 * blocks cap at `SLACK_MAX_BLOCKS`, and authored text outside the blocks is its
 * own message). The Hub's delivery ledger records one row per seam call, so the
 * first platform message is the id the reply is addressed and confirmed by.
 */
async function postPresentationMessages(
  messages: readonly SlackReplyDeliveryMessage[],
  post: (text: string, opts: Partial<SlackSendOptions>) => Promise<SlackSendResult>,
): Promise<SlackSendResult> {
  const results: SlackSendResult[] = [];
  for (const message of messages) {
    results.push(
      await post(message.text, {
        ...(message.blocks ? { blocks: message.blocks as SlackSendBlocks } : {}),
        ...(message.authoredTextPlacement
          ? { authoredTextPlacement: message.authoredTextPlacement }
          : {}),
        ...(Object.hasOwn(message, "nativeDataFallbackBaseText")
          ? { nativeDataFallbackBaseText: message.nativeDataFallbackBaseText }
          : {}),
        ...(message.textIsSlackPlainText ? { textIsSlackPlainText: true } : {}),
      }),
    );
  }
  const first = results[0];
  if (first === undefined) {
    throw new Error("Slack presentation send produced no message");
  }
  return first;
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
    text: normalizeSlackOutboundText(finalText),
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
  const hostRuntime = args["hostRuntime"] as HostRuntime | undefined;
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
      ...(hostRuntime === undefined ? {} : { hostRuntime }),
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
  await refreshSlackTypingAfterPost({ accountId, to: String(to), threadId });
  // `completeUploadExternal` returns the file id, not the new message ts; the
  // sent-file record keys on the file id (a file post's channel-native id).
  void recordSlackSentMessage({
    accountId,
    conversationId: String(to),
    ts: fileId,
    ...(hostRuntime === undefined ? {} : { hostRuntime }),
  });
  return { messageId: fileId, mediaPosted: true };
};
