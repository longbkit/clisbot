// The tool-activity surface (`sync.toolCalls`): what a channel says about the
// tools an Agent runs, and how often. The relay owns the delivery ledger and
// the thread link and hands this file a writer; this file owns the line and
// the message it lives on.
//
// One tool call is one line, from `Running` to its terminal word, so the
// reader follows a call instead of reading two messages about it. A line
// belongs to its call id: two calls that overlap never write over each other,
// and a channel with no edit verb never starts a line it could not close. The
// line's
// TARGET is what the call acted on — the command, the file, the query — read
// off the item's `detail`, whose variants are the protocol's `ToolCallDetail`
// union (`packages/protocol/src/messages.ts`). Without it a line says nothing
// useful: `Running shell…` is true of every command the Agent has ever run.
import type { ToolActivitySettings } from "../config/compile.js";
import type { ToolActivityDetail } from "../config/enums.js";
import type { AgentStreamTimelineItem } from "../daemon/types.js";
import type { PlaneClock } from "../plane/types.js";

/** A Route's tool-activity leaves with their floors applied. */
export type ToolActivity = ToolActivitySettings;

/** One scope's tool-line state, held on the relay's turn record. */
export interface ToolActivityTurn {
  /**
   * The message each tool call of this scope is showing, by call id. A call
   * keeps its own line, so two calls that overlap never fight over one
   * message; the entry is dropped when nothing more will be said about it.
   */
  toolLines: Map<string, string>;
  /**
   * The call whose line a throttled start may take over. Only a RUNNING call
   * is ever live: a line that already reached its terminal word is finished
   * text, and letting it become live is how one call's end used to steal the
   * message another call was still running on.
   */
  liveToolCall: string | undefined;
  /** Clock time of the last tool line actually POSTED (the throttle cursor).
   * An edit does not move it: the window bounds new messages, not updates. */
  lastToolPostAt: number | null;
}

/** What one relay post did. `posted: false` is a post that never reached the
 * channel — a replayed ledger row is `true`, because an earlier one did. */
export interface ToolLinePost {
  posted: boolean;
  externalMessageId?: string | undefined;
}

/**
 * How a tool line reaches the channel. Both verbs are the relay's: `post` runs
 * the record-before-post ledger, `edit` rewrites a message already posted and
 * answers false when the channel refused it. `canEdit` is the channel's
 * capability, known before anything is written.
 */
export interface ToolLineWriter {
  canEdit: boolean;
  post(line: string): Promise<ToolLinePost>;
  edit(externalMessageId: string, line: string): Promise<boolean>;
}

export interface ToolActivityRelay {
  clock: PlaneClock;
  writer: ToolLineWriter;
}

/**
 * One tool call, at a start or at its end. The caller has already checked that
 * the Route admits tool activity.
 *
 * On a channel that can edit, a call posts one line when it starts and that
 * same line becomes its terminal word. On a channel that cannot, a call says
 * nothing while it runs and posts one line when it ends — a start there could
 * never be closed, and used to leave `Running shell…` on screen forever.
 */
export async function relayToolCall(
  relay: ToolActivityRelay,
  turn: ToolActivityTurn,
  activity: ToolActivity,
  item: AgentStreamTimelineItem,
  prefix: string,
): Promise<void> {
  const line = `${prefix}${toolActivityLine(item, activity.detail)}`;
  if (item.status === "running") {
    if (relay.writer.canEdit) await startedTool(relay, turn, activity, item, line);
    return;
  }
  if (isTerminalToolStatus(item.status)) await endedTool(relay, turn, activity, item, line);
}

/**
 * A tool that started. Past the throttle window it posts its own line; inside
 * it, `update` rewrites the line of the call still running so the newest tool
 * is the one on screen — that line is handed over, and the call it belonged to
 * ends quietly. `skip` drops the start instead, which is how three commands in
 * a row used to reach a channel as one `Running shell…`.
 */
async function startedTool(
  relay: ToolActivityRelay,
  turn: ToolActivityTurn,
  activity: ToolActivity,
  item: AgentStreamTimelineItem,
  line: string,
): Promise<void> {
  if (!throttled(relay, turn, activity)) {
    await postToolLine(relay, turn, item.callId, line, true);
    return;
  }
  if (activity.whenThrottled === "skip") return;
  await takeOverLiveLine(relay, turn, item.callId, line);
}

/**
 * A tool that ended. Its own line becomes the terminal one in place, so a
 * reader follows one message per call rather than two. With no line to
 * rewrite — its start was throttled away, the channel cannot edit, or the
 * provider only ever reported the end (Codex's silent shell completions) — it
 * posts one, under the same throttle. A FAILURE ignores the throttle: it is
 * the one thing the reader must not miss.
 */
async function endedTool(
  relay: ToolActivityRelay,
  turn: ToolActivityTurn,
  activity: ToolActivity,
  item: AgentStreamTimelineItem,
  line: string,
): Promise<void> {
  const failed = item.status === "failed";
  const own = item.callId === undefined ? undefined : turn.toolLines.get(item.callId);
  if (own !== undefined && (await relay.writer.edit(own, line))) {
    release(turn, item.callId);
    return;
  }
  release(turn, item.callId);
  if (!failed && throttled(relay, turn, activity)) return;
  // A terminal line is finished text: it is posted, but it never becomes the
  // line a later tool writes over.
  await postToolLine(relay, turn, item.callId, line, false);
}

/** Nothing more will be said about this call: drop its line, and the live slot
 * with it when it held it. */
function release(turn: ToolActivityTurn, callId: string | undefined): void {
  if (callId === undefined) return;
  turn.toolLines.delete(callId);
  if (turn.liveToolCall === callId) turn.liveToolCall = undefined;
}

/** Is a new tool line inside this scope's throttle window? `0` seconds never
 * throttles, and the first line of a scope is never held. */
function throttled(
  relay: ToolActivityRelay,
  turn: ToolActivityTurn,
  activity: ToolActivity,
): boolean {
  const lastAt = turn.lastToolPostAt;
  if (lastAt === null || activity.throttleSeconds === 0) return false;
  return relay.clock.now() - lastAt < activity.throttleSeconds * 1_000;
}

/** Post a tool line as its own message. `live` makes it the line a throttled
 * start may take over — only a call that is still running qualifies. */
async function postToolLine(
  relay: ToolActivityRelay,
  turn: ToolActivityTurn,
  callId: string | undefined,
  line: string,
  live: boolean,
): Promise<void> {
  const result = await relay.writer.post(line);
  // A post that never reached the channel must not start the window: one
  // replayed or refused line used to silence tool activity for a whole one.
  if (!result.posted) return;
  turn.lastToolPostAt = relay.clock.now();
  if (!live || callId === undefined || result.externalMessageId === undefined) return;
  turn.toolLines.set(callId, result.externalMessageId);
  turn.liveToolCall = callId;
}

/** Rewrite the line of the call that is still running, and hand it to this
 * call. False means it did not happen, and the start is dropped as `skip`
 * would: the channel that refused this edit will refuse the next. */
async function takeOverLiveLine(
  relay: ToolActivityRelay,
  turn: ToolActivityTurn,
  callId: string | undefined,
  line: string,
): Promise<void> {
  const live = turn.liveToolCall;
  const message = live === undefined ? undefined : turn.toolLines.get(live);
  if (live === undefined || message === undefined) return;
  if (!(await relay.writer.edit(message, line))) {
    release(turn, live);
    return;
  }
  turn.toolLines.delete(live);
  turn.liveToolCall = undefined;
  if (callId === undefined) return;
  turn.toolLines.set(callId, message);
  turn.liveToolCall = callId;
}

/** Longest target a `short` line carries. Two Slack lines' worth: enough for a
 * real command or a deep path, short enough that ten of them stay scannable. */
const SHORT_TARGET_CHARS = 160;

/** The line's opening word, by the call's status. */
const STATUS_VERBS: Record<string, string> = {
  running: "Running",
  completed: "Finished",
  failed: "Failed",
  canceled: "Canceled",
};

/**
 * Which field of each `ToolCallDetail` variant names what the call acted on,
 * most specific first. A variant that is absent here (`unknown`) carries no
 * target and falls back to the call's own label.
 */
const DETAIL_TARGET_FIELDS: Record<string, readonly string[]> = {
  shell: ["command"],
  read: ["filePath"],
  edit: ["filePath"],
  write: ["filePath"],
  search: ["query"],
  fetch: ["url"],
  sub_agent: ["description", "subAgentType"],
  worktree_setup: ["branchName"],
  plain_text: ["label", "text"],
  plan: ["text"],
};

/** A tool call that will not change again. */
export function isTerminalToolStatus(status: string | undefined): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

/**
 * A bold status/tool heading, with the target in a separate code block so
 * commands and paths are read literally rather than as authored Markdown.
 * `short` cuts the target at `SHORT_TARGET_CHARS`; `full` keeps it whole.
 */
export function toolActivityLine(
  item: AgentStreamTimelineItem,
  detail: ToolActivityDetail,
): string {
  const name = item.name ?? item.type;
  const status = item.status ?? "completed";
  const verb = STATUS_VERBS[status] ?? "Ran";
  const target = detail === "name" ? undefined : toolTarget(item, detail === "full");
  const label = name.replace(/\s+/gu, " ").replace(/([\\`*_{}[\]()<>!#|~])/gu, "\\$1");
  const heading = `**${verb} ${label}${status === "running" ? "…" : ""}**`;
  if (target === undefined) return heading;
  // A command can itself contain Markdown fences (for example a heredoc).
  const fence = "`".repeat(
    Math.max(3, ...Array.from(target.matchAll(/`+/gu), (m) => m[0].length + 1)),
  );
  return `${heading}\n${fence}\n${target}\n${fence}`;
}

/** What the call acted on, rendered for the requested detail level. */
function toolTarget(item: AgentStreamTimelineItem, full: boolean): string | undefined {
  const raw = rawToolTarget(item)?.trim();
  if (raw === undefined || raw === "") return undefined;
  return full ? raw : shorten(raw);
}

function rawToolTarget(item: AgentStreamTimelineItem): string | undefined {
  const detail = asRecord(item["detail"]);
  const variant = readString(detail?.["type"]) ?? "";
  for (const field of DETAIL_TARGET_FIELDS[variant] ?? []) {
    const value = readString(detail?.[field]);
    if (value !== undefined) return value;
  }
  // ACP providers name a call by its ACP *kind* (`use_tool`, `execute`,
  // `other`) and keep the readable label in `metadata.title`. Without this a
  // Grok or Copilot call would reach the channel as `Running use_tool…`.
  return readString(asRecord(item["metadata"])?.["title"]);
}

/** One readable line: whitespace collapsed, cut on a word boundary when the
 * cut lands in the line's second half, with an ellipsis. */
function shorten(text: string): string {
  const line = text.replace(/\s+/gu, " ");
  if (line.length <= SHORT_TARGET_CHARS) return line;
  const head = line.slice(0, SHORT_TARGET_CHARS);
  const boundary = head.lastIndexOf(" ");
  const cut = boundary > SHORT_TARGET_CHARS / 2 ? head.slice(0, boundary) : head;
  return `${cut.trimEnd()}…`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
