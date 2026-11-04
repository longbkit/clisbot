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
 * rate limit, timeout) becomes `unavailable` instead of holding the message.
 * When the bot has already posted in the thread, or was mentioned in it before,
 * a session has been given the thread, and no snapshot is taken.
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
  /** The bot's own ids: a thread it posted in gets no snapshot. */
  botUserId?: string | undefined;
  botId?: string | undefined;
  budgetMs?: number;
}

/** The snapshot for a mention, or undefined when the bot already posted in the thread. */
export async function readSlackThreadContext(
  params: ReadSlackThreadContextParams,
): Promise<ChannelThreadContext | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), params.budgetMs ?? THREAD_CONTEXT_BUDGET_MS);
  });
  const read = readThread(params).then(
    (thread) => ({ thread }),
    (error: unknown) => ({ error: slackErrorCode(error) }),
  );
  try {
    const outcome = await Promise.race([read, timeout]);
    if (outcome === "timeout") return { recent: [], unavailable: "timeout" };
    if ("error" in outcome) return { recent: [], unavailable: outcome.error };
    return snapshotOf(outcome.thread, params);
  } finally {
    clearTimeout(timer);
  }
}

interface ThreadRead {
  messages: SlackThreadMessage[];
  /** False when pages remained after `MAX_PAGES`. */
  complete: boolean;
}

/** The thread up to (not including) the mention, oldest first, root included. */
async function readThread(params: ReadSlackThreadContextParams): Promise<ThreadRead> {
  const messages: SlackThreadMessage[] = [];
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
    messages.push(...(response.messages ?? []));
    const next = response.response_metadata?.next_cursor?.trim();
    cursor = response.has_more === true && next ? next : undefined;
    if (cursor === undefined) return { messages, complete: true };
  }
  return { messages, complete: false };
}

function snapshotOf(
  thread: ThreadRead,
  params: ReadSlackThreadContextParams,
): ChannelThreadContext | undefined {
  const before = thread.messages.filter(
    (message) =>
      typeof message.ts === "string" && compareSlackTs(message.ts, params.messageTs) < 0,
  );
  // The bot posted, or was mentioned earlier: that mention carried the thread
  // to a session already, so a second copy would only repeat it.
  if (before.some((message) => isBot(message, params) || mentionsBot(message, params)))
    return undefined;
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

function isBot(message: SlackThreadMessage, params: ReadSlackThreadContextParams): boolean {
  return (
    (params.botUserId !== undefined && message.user === params.botUserId) ||
    (params.botId !== undefined && message.bot_id === params.botId)
  );
}

function mentionsBot(message: SlackThreadMessage, params: ReadSlackThreadContextParams): boolean {
  return params.botUserId !== undefined && (message.text ?? "").includes(`<@${params.botUserId}>`);
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
