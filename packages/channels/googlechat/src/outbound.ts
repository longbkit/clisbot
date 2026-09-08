// Fusion drive-surface bridge onto the ported Google Chat send path (D-GC-016).
//
// `plugin.outbound.*` is the Hub's contract (`@getpaseo/channels-shared`), so
// this file is the only place that translates between it and upstream's
// `api.ts` entry points. Every wire decision — markdown rendering, byte-bounded
// chunking, the thread-name validity rule, the message resource shape — lives in
// the ported source, not here. Mirrors the Discord vertical's `outbound.ts`.
import { createChannelPartialDeliveryError } from "@getpaseo/channels-core/plugin-sdk/channel-inbound";
import type { HostRuntime, SendMediaFn, SendTextFn } from "@getpaseo/channels-shared";
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { resolveGoogleChatAccount, type ResolvedGoogleChatAccount } from "./accounts.js";
import {
  deleteGoogleChatMessage,
  sendGoogleChatMessage,
  updateGoogleChatMessage,
} from "./api.js";
import { formatGoogleChatTextChunks } from "./format.js";
import { mergeAccountCarrier } from "./fusion/account-config.js";
import { installGoogleChatRuntime } from "./fusion/runtime.js";
import { withGoogleChatAccount } from "./runtime.js";
import { getHostRuntime } from "./runtime-store.js";
import { resolveGoogleChatOutboundSpace } from "./targets.js";
import type { GoogleChatCardV2 } from "./types.js";

/** Runs one send under its own account's ported plugin runtime. */
async function withAccountRuntime<T>(
  args: Record<string, unknown>,
  run: (account: ResolvedGoogleChatAccount) => Promise<T>,
): Promise<T> {
  const host = (args["hostRuntime"] as HostRuntime | undefined) ?? getHostRuntime();
  const accountId = String(args["accountId"] ?? "");
  installGoogleChatRuntime(host, accountId);
  const account = resolveGoogleChatAccount({
    cfg: mergeAccountCarrier(
      args["cfg"] as OpenClawConfig,
      accountId,
      args["account"] as Record<string, unknown> | undefined,
    ),
    accountId,
  });
  return await withGoogleChatAccount(accountId, () => run(account));
}

/** The space a post lands in, and the thread it replies into.
 *
 * A Google Chat thread is `spaces/{space}/threads/{thread}`, a resource under
 * the space rather than a channel of its own, so the Hub's `to`/`threadId` pair
 * maps onto the space plus the thread name. `api.ts` drops a thread name that
 * does not belong to the space rather than failing the whole send. */
function resolveThread(args: Record<string, unknown>): string | undefined {
  const threadId = args["threadId"];
  return threadId === undefined || threadId === null || threadId === ""
    ? undefined
    : String(threadId);
}

/**
 * `plugin.outbound.sendText` — the Hub's final-answer post. `to` is
 * `spaces/{space}`, `users/{user}` (a DM the app opens through
 * `spaces:findDirectMessage`), or any of the `googlechat:` / `gchat:` prefixed
 * forms upstream's `targets.ts` normalizes.
 *
 * Long answers are chunked by upstream's byte-bounded renderer and posted as
 * separate messages; the returned `messageId` is the FIRST chunk's resource
 * name, so the ledger confirms with the message a reader sees first.
 */
export const sendText: SendTextFn = async (args) =>
  await withAccountRuntime(args, async (account) => {
    const space = await resolveGoogleChatOutboundSpace({ account, target: String(args.to) });
    const chunks = formatGoogleChatTextChunks(String(args.text));
    let thread = resolveThread(args);
    let firstMessageName: string | undefined;
    let threadName: string | undefined;
    const messageIds: string[] = [];
    for (const chunk of chunks) {
      if (chunk === "") continue;
      let sent: Awaited<ReturnType<typeof sendGoogleChatMessage>>;
      try {
        sent = await sendGoogleChatMessage({
          account,
          space,
          text: chunk,
          ...(thread === undefined ? {} : { thread }),
        });
      } catch (error) {
        // Chunk N failed with 1..N-1 already in the space. A plain throw makes
        // the Hub retry the whole answer and repost what the reader already
        // has; `sentBeforeError` is upstream's partial-delivery shape.
        if (messageIds.length === 0) throw error;
        throw createChannelPartialDeliveryError(error, {
          visibleReplySent: true,
          messageIds,
          ...(threadName === undefined ? {} : { threadId: threadName }),
        });
      }
      firstMessageName ??= sent?.messageName;
      threadName ??= sent?.threadName;
      if (sent?.messageName !== undefined) messageIds.push(sent.messageName);
      // Chunk 1 defines the thread. Without this a long answer posted to a
      // space root started a NEW thread per chunk, so the reader saw one answer
      // shredded across N conversations; a thread reply that fell back to a new
      // thread has the same problem.
      if (sent?.threadName) thread = sent.threadName;
    }
    if (firstMessageName === undefined) {
      throw new Error("Google Chat sendText produced no message");
    }
    return {
      messageId: firstMessageName,
      to: space,
      ...(threadName === undefined ? {} : { threadId: threadName }),
      chunks: chunks.length,
    };
  });

/**
 * COMPAT(clisbot-control-plane): the in-place update. Google Chat patches a
 * message by resource name with an explicit update mask, which upstream's
 * `updateGoogleChatMessage` builds from the fields present.
 */
export async function updateText(args: {
  cfg: Record<string, unknown>;
  accountId: string;
  to: string;
  threadId?: string;
  text: string;
  externalMessageId: string;
  cardsV2?: GoogleChatCardV2[];
  [key: string]: unknown;
}): Promise<{ ok: boolean }> {
  return await withAccountRuntime(args, async (account) => {
    const [chunk] = formatGoogleChatTextChunks(String(args.text));
    await updateGoogleChatMessage({
      account,
      messageName: String(args.externalMessageId),
      text: chunk ?? "",
      ...(args.cardsV2 === undefined ? {} : { cardsV2: args.cardsV2 }),
    });
    return { ok: true };
  });
}

/** The in-place delete, for the message-tool `delete` action. */
export async function deleteMessage(args: {
  cfg: Record<string, unknown>;
  accountId: string;
  externalMessageId: string;
  [key: string]: unknown;
}): Promise<{ ok: boolean }> {
  return await withAccountRuntime(args, async (account) => {
    await deleteGoogleChatMessage({ account, messageName: String(args.externalMessageId) });
    return { ok: true };
  });
}

/**
 * `plugin.outbound.sendMedia` — REFUSED, loudly, and never silently.
 *
 * Google Chat's attachment upload endpoint is user-OAuth only: a service-account
 * Chat app cannot upload a file at all (upstream refuses the same way in
 * `actions.ts` and `monitor-reply-delivery.ts`). The Hub's G11 contract has a
 * shape for exactly this — post the in-channel notice through the text path and
 * report `mediaPosted: false` — so the operator sees why the file did not
 * arrive instead of a transport error.
 */
export const sendMedia: SendMediaFn = async (args) => {
  const notice =
    "[Google Chat attachments require user OAuth and are not supported by this service-account app; the file was not uploaded]";
  const posted = await sendText({ ...args, text: notice });
  return { messageId: posted.messageId, mediaPosted: false };
};
