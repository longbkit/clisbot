/**
 * The thread a mention arrived in, read once at admission.
 *
 * The Hub hands the Agent only the mention's own text, and a thread is often
 * opened by an app post (an Alertmanager alert whose content lives only in
 * `attachments`) that the bot never received as an event. So when the bot is
 * mentioned in a reply, the vertical reads the thread's root and its newest
 * replies before the mention, caps them, and the snapshot rides on the inbound
 * event into the ingress row (`ThreadContext`). The Hub renders it from the
 * row, so a retry of the delivery renders the same prompt and Slack is never
 * read again for it.
 *
 * Admission (and so the Socket Mode ack) waits on this, so it is bounded: one
 * time budget for every page, and any failure (missing scope, not in channel,
 * rate limit, timeout) becomes `unavailable` instead of holding the message,
 * keeping the root when the first page arrived. Every mention in a thread
 * gets a snapshot; the Hub decides, per session and durably, whether a prompt
 * carries it (`bindings/inbox.ts`).
 */
import type { ChannelThreadContext, ChannelThreadContextMessage } from "@clisbot/channels-shared";
import { decodeSlackEntities } from "../fusion/slack-entities.js";
import { compareSlackTs, slackErrorCode } from "../fusion/slack-read.js";
import type { SlackAttachment, SlackFile } from "../types.js";

/** The newest replies a snapshot keeps. */
export const THREAD_CONTEXT_RECENT = 15;
/** One message's text, after which it is cut. */
export const THREAD_CONTEXT_MESSAGE_CHARS = 2_000;
/** Every message's text together. */
export const THREAD_CONTEXT_TOTAL_CHARS = 10_000;
/** How long admission waits for the whole read. */
export const THREAD_CONTEXT_BUDGET_MS = 1_500;
/** Pages of 200 a read follows before it stops (`omitted: "unknown"`). */
const MAX_PAGES = 3;
const PAGE_SIZE = 200;

/** The slice of the Web API client this needs. */
export interface SlackRepliesClient {
  conversations: { replies(args: Record<string, unknown>): Promise<unknown> };
}

interface SlackThreadMessage {
  ts?: string;
  user?: string;
  bot_id?: string;
  username?: string;
  bot_profile?: { name?: string };
  text?: string;
  attachments?: SlackAttachment[];
  files?: SlackFile[];
}

interface SlackRepliesPage {
  messages?: SlackThreadMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
}

export interface ReadSlackThreadContextParams {
  client: SlackRepliesClient;
  channelId: string;
  threadTs: string;
  /** The mention's ts: the snapshot holds only what came before it. */
  messageTs: string;
  budgetMs?: number;
}

/** The snapshot for a mention: what the thread showed before it, or why it could not be read. */
export async function readSlackThreadContext(
  params: ReadSlackThreadContextParams,
): Promise<ChannelThreadContext> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), params.budgetMs ?? THREAD_CONTEXT_BUDGET_MS);
  });
  const progress: ThreadRead = { messages: [], complete: false };
  const read = readThread(params, progress).then(
    (thread) => ({ thread }),
    (error: unknown) => ({ error: slackErrorCode(error) }),
  );
  try {
    const outcome = await Promise.race([read, timeout]);
    if (outcome === "timeout" || "error" in outcome) {
      const reason = outcome === "timeout" ? "timeout" : outcome.error;
      // The first page holds the root: keep it, and say the rest is missing.
      if (progress.messages.length === 0) return { recent: [], unavailable: reason };
      return { ...snapshotOf({ messages: [...progress.messages], complete: false }, params), unavailable: reason };
    }
    return snapshotOf(outcome.thread, params);
  } finally {
    clearTimeout(timer);
  }
}

interface ThreadRead {
  messages: SlackThreadMessage[];
  /** False when the read stopped before the thread's end: the page cap, a
   * `has_more` without a cursor to follow, or the budget after the first page. */
  complete: boolean;
}

/** The thread up to (not including) the mention, oldest first, root included,
 * as far as it got: `progress` holds the pages read so far. */
async function readThread(
  params: ReadSlackThreadContextParams,
  progress: ThreadRead,
): Promise<ThreadRead> {
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = (await params.client.conversations.replies({
      channel: params.channelId,
      ts: params.threadTs,
      latest: params.messageTs,
      inclusive: false,
      limit: PAGE_SIZE,
      ...(cursor === undefined ? {} : { cursor }),
    })) as SlackRepliesPage;
    progress.messages.push(...(response.messages ?? []));
    if (response.has_more !== true) return { ...progress, complete: true };
    cursor = response.response_metadata?.next_cursor?.trim() || undefined;
    // More replies but no way to reach them: what was read is the oldest part.
    if (cursor === undefined) return progress;
  }
  return progress;
}

function snapshotOf(thread: ThreadRead, params: ReadSlackThreadContextParams): ChannelThreadContext {
  const before = thread.messages.filter(
    (message) =>
      typeof message.ts === "string" && compareSlackTs(message.ts, params.messageTs) < 0,
  );
  const root = before.find((message) => message.ts === params.threadTs);
  const replies = before.filter((message) => message.ts !== params.threadTs);
  const budget = { chars: THREAD_CONTEXT_TOTAL_CHARS };
  const rootLine = root === undefined ? undefined : lineOf(root, budget);
  // A read that stopped early holds the oldest replies, not the newest: keep
  // only the root then, so the snapshot never passes them off as the latest.
  const kept = thread.complete ? replies.slice(-THREAD_CONTEXT_RECENT) : [];
  // Newest first against the budget, so the replies nearest the mention survive.
  const recent: ChannelThreadContextMessage[] = [];
  for (const message of [...kept].reverse()) {
    const line = lineOf(message, budget);
    if (line === undefined) break;
    recent.unshift(line);
  }
  const omitted = thread.complete ? replies.length - recent.length : "unknown";
  return {
    ...(rootLine === undefined ? {} : { root: rootLine }),
    recent,
    ...(omitted === 0 ? {} : { omitted }),
    ...(root === undefined && thread.complete ? { unavailable: "root_not_returned" } : {}),
  };
}

/** A message as a snapshot line, or undefined when the text budget is spent. */
function lineOf(
  message: SlackThreadMessage,
  budget: { chars: number },
): ChannelThreadContextMessage | undefined {
  if (budget.chars <= 0) return undefined;
  const full = messageText(message);
  const limit = Math.min(THREAD_CONTEXT_MESSAGE_CHARS, budget.chars);
  const text = full.length > limit ? `${full.slice(0, limit)}… [cut]` : full;
  budget.chars -= Math.min(full.length, limit);
  const senderName = message.user === undefined ? appName(message) : undefined;
  return {
    messageId: message.ts as string,
    senderId: message.user ?? message.bot_id ?? "unknown",
    ...(senderName === undefined ? {} : { senderName }),
    text,
  };
}

function appName(message: SlackThreadMessage): string | undefined {
  const name = message.bot_profile?.name ?? message.username;
  return typeof name === "string" && name.trim() !== "" ? name.trim() : undefined;
}

/** The text a person sees: the message text, then what its attachments and files show. */
export function messageText(message: SlackThreadMessage): string {
  const parts: string[] = [];
  const push = (value: string | undefined) => {
    const text = value === undefined ? "" : decodeSlackEntities(value).trim();
    if (text !== "" && !parts.includes(text)) parts.push(text);
  };
  push(message.text);
  for (const attachment of message.attachments ?? []) {
    const before = parts.length;
    push(attachment.pretext);
    push(attachment.title);
    push(attachment.text);
    for (const field of attachment.fields ?? []) {
      if (field.title || field.value) push(`${field.title ?? ""}: ${field.value ?? ""}`);
    }
    if (parts.length === before) push(attachment.fallback);
  }
  const files = (message.files ?? []).map((file) => file.name ?? "file");
  if (files.length > 0) parts.push(`[files: ${files.join(", ")}]`);
  return parts.join("\n");
}
