// The Slack half of `sync.progress` — `plugin.outbound.typing` (the Hub owns
// the processing-lease lifecycle in channels/plane/processing.ts; this file
// owns the wire). Sync reference: @openclaw/slack@2026.7.1
// dist/provider-C1-DFSpw.js `setSlackThreadStatus`,
// dist/pipeline.runtime-rpVpay59.js `SLACK_THREAD_LOADING_MESSAGES`.
//
// The two surfaces are NOT interchangeable:
// - `indicator` → `assistant.threads.setStatus`, the "is typing..." line with
//   rotating loading messages. It is THREAD-scoped, and a root message's own
//   `ts` IS a thread anchor, so a root turn carries it too — the status sits
//   under the message the bot is answering. Only a turn with neither a reply
//   thread nor a usable marker is silent.
// - `reaction` → `reactions.add` on the SENDER's own message for the length of
//   the turn: the receipt that the message was taken, removed on close.
//
// One lease = one set and one clear. Slack holds an assistant status for about
// two minutes and clears it itself when the bot answers, so a live turn needs
// no re-push; the Hub's lease TTL (60s) sits inside that window, and a repeat
// `start` for a surface this process already opened is a no-op.
//
// Scope: `assistant.threads.setStatus` is served by `chat:write` (already a
// required bot scope); `assistant:write` is the compatibility scope Slack still
// accepts for the assistant surface. Neither is in the Hub's hard-verified
// required set, so a `missing_scope` is logged once per account with both ways
// out (turn the leaf off, or add the scope to the app) and re-thrown, so the
// Hub's breaker stops the calls instead of warning on every turn.

import { getSlackWriteClient } from "./client/web-api.js";
import type { HostRuntime } from "@getpaseo/channels-shared";
import { resolveOutboundBotToken } from "./outbound.js";
import { getSlackRuntime } from "./runtime.js";

/** The status text Slack shows while the turn runs. */
export const SLACK_TYPING_STATUS = "is typing...";

/** What rotates under the status (OpenClaw's list, verbatim). */
export const SLACK_TYPING_LOADING_MESSAGES = [
  "Reading the thread...",
  "Checking context...",
  "Working through the request...",
  "Putting it all together...",
] as const;

/** The args the Hub's `outbound.typing` drive carries (plane/types.ts). */
export interface SlackTypingArgs {
  cfg: Record<string, unknown>;
  accountId: string;
  /** The conversation the turn is running in. */
  to: string;
  action: "start" | "stop";
  indicator: boolean;
  /** The thread the reply lands in; absent = the conversation root. */
  threadId?: string | undefined;
  /** The sender's message id — the reaction target. */
  messageId?: string | undefined;
  /** The emoji name to react with; absent = the reaction leaf is off. */
  reactionEmoji?: string | undefined;
  hostRuntime?: HostRuntime | undefined;
}

/** The Slack native `ts` shape — the only string usable as a `thread_ts`. */
const SLACK_THREAD_TS_RE = /^\d+\.\d+$/;

/**
 * The status anchor: the thread the reply lands in, else the sender's own
 * message `ts` (a root message anchors its own thread, which is how every
 * Slack assistant shows liveness on an unthreaded ask). A synthetic marker id
 * — a slash command's `slash:<ts>:<user>` — is not a `ts`, so those turns fall
 * back to the reaction surface.
 */
function statusAnchor(args: SlackTypingArgs): string | undefined {
  if (args.threadId !== undefined && args.threadId !== "") return args.threadId;
  const marker = args.messageId;
  return marker !== undefined && SLACK_THREAD_TS_RE.test(marker)
    ? marker
    : undefined;
}

/** Surfaces this process currently holds open (the set-once / clear-once dedupe). */
const openSurfaces = new Set<string>();

/** Test seam: forget every open surface. */
export function clearSlackTypingSurfacesForTest(): void {
  openSurfaces.clear();
}

function surfaceKey(
  args: SlackTypingArgs,
  kind: "status" | "reaction",
): string {
  // Each surface keys on its OWN target: two turns answered in one thread share
  // a status anchor but react to different messages, and must not dedupe
  // against each other.
  const anchor = kind === "status" ? statusAnchor(args) : args.messageId;
  return `${args.accountId}:${kind}:${args.to}:${anchor ?? ""}`;
}

/** The Slack API error code of a thrown `WebAPICallError` (the body's `error`
 * field, which the SDK mirrors onto the error object). */
export function slackErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const candidate = error as Record<string, unknown>;
  const data = candidate["data"];
  if (typeof data === "object" && data !== null) {
    const code = (data as Record<string, unknown>)["error"];
    if (typeof code === "string") return code;
  }
  return typeof candidate["error"] === "string" ? candidate["error"] : "";
}

/** A `missing_scope` is a setup fact, not a transient fault: say it once per
 * account, naming both ways out, then let the Hub's breaker stop the loop. */
const scopeWarnings = new Set<string>();
function warnMissingScope(args: SlackTypingArgs, scope: string): void {
  const key = `${args.accountId}:${scope}`;
  if (scopeWarnings.has(key)) return;
  scopeWarnings.add(key);
  const runtime = args.hostRuntime ?? getSlackRuntime();
  if (runtime === undefined) return;
  runtime.logging
    .getChildLogger({ channel: "slack", accountId: args.accountId })
    .warn("slack typing indicator needs a scope the app does not have", {
      scope,
      hint: `add "${scope}" to the Slack app's bot scopes and reinstall, or set sync.progress.typingIndicator: false`,
    });
}

/** Test seam: allow the scope warning to be emitted again. */
export function clearSlackTypingScopeWarningsForTest(): void {
  scopeWarnings.clear();
}

/** The thread status: set on open, cleared on close, never re-called while
 * live, and never attempted without an anchor. */
async function driveIndicator(args: SlackTypingArgs): Promise<void> {
  const threadTs = statusAnchor(args);
  if (threadTs === undefined) return;
  const key = surfaceKey(args, "status");
  const client = await getSlackWriteClient(tokenFor(args));
  if (args.action === "start") {
    // Set once per surface: Slack keeps the status live on its own, so a
    // repeat drive is a no-op (see the header).
    if (openSurfaces.has(key)) return;
    try {
      await client.assistant.threads.setStatus({
        channel_id: args.to,
        thread_ts: threadTs,
        status: SLACK_TYPING_STATUS,
        loading_messages: [...SLACK_TYPING_LOADING_MESSAGES],
      });
    } catch (error) {
      if (slackErrorCode(error) === "missing_scope")
        warnMissingScope(args, "assistant:write");
      throw error;
    }
    openSurfaces.add(key);
    return;
  }
  // Only clear what this process opened: a status left by an earlier process
  // dies with the TTL, and clearing a thread another turn is still using would
  // hide that turn's indicator.
  if (!openSurfaces.delete(key)) return;
  await client.assistant.threads.setStatus({
    channel_id: args.to,
    thread_ts: threadTs,
    status: "",
  });
}

/** The receipt reaction. Both directions are idempotent: a keepalive re-add
 * answers `already_reacted`, and a close after the message moved answers
 * `no_reaction` / `message_not_found`. */
async function driveReaction(args: SlackTypingArgs): Promise<void> {
  const name = args.reactionEmoji;
  const timestamp = args.messageId;
  if (name === undefined || timestamp === undefined) return;
  const key = surfaceKey(args, "reaction");
  const client = await getSlackWriteClient(tokenFor(args));
  const already =
    args.action === "start" ? openSurfaces.has(key) : !openSurfaces.delete(key);
  if (already) return;
  const call =
    args.action === "start"
      ? () => client.reactions.add({ channel: args.to, timestamp, name })
      : () => client.reactions.remove({ channel: args.to, timestamp, name });
  try {
    await call();
  } catch (error) {
    const code = slackErrorCode(error);
    if (
      code === "already_reacted" ||
      code === "no_reaction" ||
      code === "message_not_found"
    ) {
      if (args.action === "start") openSurfaces.add(key);
      return;
    }
    throw error;
  }
  if (args.action === "start") openSurfaces.add(key);
}

function tokenFor(args: SlackTypingArgs): string {
  const botToken = resolveOutboundBotToken(args.cfg, args.accountId);
  if (botToken === undefined) {
    throw new Error(
      `Slack typing for account "${args.accountId}" found no cfg.channels.slack.accounts.${args.accountId}.botToken`,
    );
  }
  return botToken;
}

/**
 * `plugin.outbound.typing` — one liveness drive for a turn. Throws on a wire
 * fault (the Hub's controller counts it and trips its breaker); typing is
 * never allowed to disturb the reply path, so nothing here is caught and
 * swallowed.
 */
export async function slackTyping(args: SlackTypingArgs): Promise<void> {
  if (args.indicator) await driveIndicator(args);
  if (args.reactionEmoji !== undefined) await driveReaction(args);
}
