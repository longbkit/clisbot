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
// Slack clears status on any bot reply and after two minutes. Refresh while the
// Hub's lease is active, including after interim posts. Per-thread serialization
// makes the terminal clear run after any status write already in flight.
//
// Scope: `assistant.threads.setStatus` is served by `chat:write` (already a
// required bot scope); `assistant:write` is the compatibility scope Slack still
// accepts for the assistant surface. Neither is in the Hub's hard-verified
// required set, so a `missing_scope` is logged once per account with both ways
// out (turn the leaf off, or add the scope to the app) and re-thrown, so the
// Hub's breaker stops the calls instead of warning on every turn.

import { getSlackWriteClient } from "./client/web-api.js";
import type { HostRuntime } from "@getpaseo/channels-shared";
import { resolveOutboundBotToken } from "./lifecycle/start-account.js";
import { getSlackHostRuntime } from "./runtime-store.js";

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
  return marker !== undefined && SLACK_THREAD_TS_RE.test(marker) ? marker : undefined;
}

/** Surfaces this process currently holds open (the set-once / clear-once dedupe). */
interface ReactionSurface {
  active: boolean;
  queue: Promise<void>;
}
const reactionSurfaces = new Map<string, ReactionSurface>();
export const SLACK_TYPING_REFRESH_MS = 60_000;
interface StatusSurface {
  args: SlackTypingArgs;
  threadTs: string;
  active: boolean;
  queue: Promise<void>;
  timer?: ReturnType<typeof setInterval>;
  pendingRefreshes: number;
}
const statusSurfaces = new Map<string, StatusSurface>();

/** Test seam: forget every open surface. */
export function clearSlackTypingSurfacesForTest(): void {
  for (const surface of reactionSurfaces.values()) surface.active = false;
  reactionSurfaces.clear();
  for (const surface of statusSurfaces.values()) {
    surface.active = false;
    clearInterval(surface.timer);
  }
  statusSurfaces.clear();
}

function surfaceKey(args: SlackTypingArgs, kind: "status" | "reaction"): string {
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
  const runtime = args.hostRuntime ?? getSlackHostRuntime();
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

/** Serialize every status write, including a close followed immediately by a new turn. */
function writeStatus(surface: StatusSurface, status: string): Promise<void> {
  const operation = surface.queue.then(async () => {
    if (status !== "" && !surface.active) return;
    const client = await getSlackWriteClient(tokenFor(surface.args));
    if (status !== "" && !surface.active) return;
    await client.assistant.threads.setStatus({
      channel_id: surface.args.to,
      thread_ts: surface.threadTs,
      status,
      ...(status === "" ? {} : { loading_messages: [...SLACK_TYPING_LOADING_MESSAGES] }),
    });
    return undefined;
  });
  surface.queue = operation.catch(() => undefined);
  return operation;
}

/** A failed cosmetic refresh must not turn a delivered message into a retryable send failure. */
async function refreshStatus(surface: StatusSurface, afterPost = false): Promise<void> {
  if (!surface.active || (surface.pendingRefreshes > 0 && !afterPost)) return;
  surface.pendingRefreshes += 1;
  try {
    await writeStatus(surface, SLACK_TYPING_STATUS);
  } catch (error) {
    surface.active = false;
    clearInterval(surface.timer);
    if (slackErrorCode(error) === "missing_scope")
      warnMissingScope(surface.args, "assistant:write");
    const runtime = surface.args.hostRuntime ?? getSlackHostRuntime();
    runtime?.logging
      .getChildLogger({ channel: "slack", accountId: surface.args.accountId })
      .warn("slack typing refresh stopped", {
        error: error instanceof Error ? error.message : String(error),
      });
  } finally {
    surface.pendingRefreshes -= 1;
  }
}

/** Slack clears status on every bot post, even when the Agent's turn is still running. */
export async function refreshSlackTypingAfterPost(input: {
  accountId: string;
  to: string;
  threadId?: string | undefined;
}): Promise<void> {
  await Promise.all(
    [...statusSurfaces.values()]
      .filter(
        (surface) =>
          surface.active &&
          surface.args.accountId === input.accountId &&
          surface.args.to === input.to &&
          (input.threadId ? surface.threadTs === input.threadId : !surface.args.threadId),
      )
      .map((surface) => refreshStatus(surface, true)),
  );
}

async function driveIndicator(args: SlackTypingArgs): Promise<StatusSurface | undefined> {
  const threadTs = statusAnchor(args);
  if (threadTs === undefined) return;
  const key = surfaceKey(args, "status");
  const previous = statusSurfaces.get(key);
  if (args.action === "stop") {
    if (previous === undefined) return;
    previous.active = false;
    clearInterval(previous.timer);
    try {
      await writeStatus(previous, "");
    } finally {
      if (statusSurfaces.get(key) === previous) statusSurfaces.delete(key);
    }
    return;
  }
  if (previous?.active) {
    await previous.queue;
    return previous;
  }
  const surface: StatusSurface = {
    args,
    threadTs,
    active: true,
    queue: previous?.queue ?? Promise.resolve(),
    pendingRefreshes: 0,
  };
  statusSurfaces.set(key, surface);
  const start = writeStatus(surface, SLACK_TYPING_STATUS);
  const startQueue = surface.queue;
  try {
    await start;
  } catch (error) {
    surface.active = false;
    if (statusSurfaces.get(key) === surface && surface.queue === startQueue)
      statusSurfaces.delete(key);
    if (slackErrorCode(error) === "missing_scope") warnMissingScope(args, "assistant:write");
    throw error;
  }
  if (!surface.active) return surface;
  surface.timer = setInterval(() => {
    void refreshStatus(surface);
  }, SLACK_TYPING_REFRESH_MS);
  surface.timer.unref?.();
  return surface;
}

/** The receipt reaction. Both directions are idempotent: a keepalive re-add
 * answers `already_reacted`, and a close after the message moved answers
 * `no_reaction` / `message_not_found`. */
async function driveReaction(args: SlackTypingArgs): Promise<void> {
  const name = args.reactionEmoji;
  const timestamp = args.messageId;
  if (name === undefined || timestamp === undefined) return;
  const key = surfaceKey(args, "reaction");
  const previous = reactionSurfaces.get(key);
  if (args.action === "start" && previous?.active) return previous.queue;
  if (args.action === "stop" && previous === undefined) return;
  const surface: ReactionSurface =
    args.action === "start"
      ? { active: true, queue: previous?.queue ?? Promise.resolve() }
      : previous!;
  if (args.action === "start") reactionSurfaces.set(key, surface);
  else surface.active = false;
  const operation = surface.queue.then(async () => {
    if (args.action === "start" && !surface.active) return;
    const client = await getSlackWriteClient(tokenFor(args));
    if (args.action === "start" && !surface.active) return;
    try {
      if (args.action === "start")
        await client.reactions.add({ channel: args.to, timestamp, name });
      else await client.reactions.remove({ channel: args.to, timestamp, name });
    } catch (error) {
      if (["already_reacted", "no_reaction", "message_not_found"].includes(slackErrorCode(error)))
        return;
      throw error;
    }
    return undefined;
  });
  const settled = operation.catch(() => undefined);
  surface.queue = settled;
  try {
    await operation;
  } catch (error) {
    surface.active = false;
    if (reactionSurfaces.get(key) === surface && surface.queue === settled)
      reactionSurfaces.delete(key);
    throw error;
  } finally {
    if (!surface.active && reactionSurfaces.get(key) === surface && surface.queue === settled)
      reactionSurfaces.delete(key);
  }
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
  if (args.action === "stop") {
    await Promise.all([
      args.indicator ? driveIndicator(args) : Promise.resolve(),
      args.reactionEmoji !== undefined ? driveReaction(args) : Promise.resolve(),
    ]);
    return;
  }
  let indicator: StatusSurface | undefined;
  try {
    if (args.indicator) {
      indicator = await driveIndicator(args);
      if (
        indicator !== undefined &&
        (!indicator.active || statusSurfaces.get(surfaceKey(args, "status")) !== indicator)
      )
        return;
    }
    if (args.reactionEmoji !== undefined) await driveReaction(args);
  } catch (error) {
    // A delayed failure belongs only to its own turn, never a replacement's status.
    if (indicator !== undefined && statusSurfaces.get(surfaceKey(args, "status")) === indicator) {
      await driveIndicator({ ...args, action: "stop" }).catch(() => undefined);
    }
    throw error;
  }
}
