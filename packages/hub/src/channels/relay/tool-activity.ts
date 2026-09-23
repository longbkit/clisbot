// The tool-activity surface (`sync.toolCalls`): what a channel says about the
// tools an Agent runs, and how often. The relay owns the delivery ledger and
// the thread link and hands this file a writer; this file owns the line and
// the message it lives on.
//
// One tool call is one line, from `Running` to its terminal word, so the
// reader follows a call instead of reading two messages about it. The line's
// TARGET is what the call acted on — the command, the file, the query — read
// off the item's `detail`, whose variants are the protocol's `ToolCallDetail`
// union (`packages/protocol/src/messages.ts`). Without it a line says nothing
// useful: `Running shell…` is true of every command the Agent has ever run.
import type { EffectiveDefaults } from "../config/compile.js";
import type { ToolActivityDetail } from "../config/enums.js";
import type { AgentStreamTimelineItem } from "../daemon/types.js";
import type { PlaneClock } from "../plane/types.js";

/** A Route's effective tool-activity leaves. */
export type ToolActivity = EffectiveDefaults["sync"]["toolCalls"];

/** One scope's tool-line state, held on the relay's turn record. */
export interface ToolActivityTurn {
  /**
   * The live tool line: the call it currently shows and the message carrying
   * it. A later tool may rewrite that message; a failure clears this, so the
   * failed line is the last thing that message ever says.
   */
  toolLine: { callId: string; externalMessageId: string } | undefined;
  /** Clock time of the last tool line POSTED (the throttle cursor). An edit
   * does not move it: the window bounds new messages, not updates. */
  lastToolPostAt: number | null;
}

/**
 * How a tool line reaches the channel. Both verbs are the relay's: `post` runs
 * the record-before-post ledger and returns the channel's message id, `edit`
 * rewrites one already posted and answers false when it did not happen — no
 * edit verb on this channel, or the channel refused it.
 */
export interface ToolLineWriter {
  post(line: string): Promise<string | undefined>;
  edit(externalMessageId: string, line: string): Promise<boolean>;
}

export interface ToolActivityRelay {
  clock: PlaneClock;
  writer: ToolLineWriter;
}

/**
 * One tool call, at a start or at its end. The caller has already checked that
 * the Route admits tool activity at all — `sync.toolCalls` is the only gate,
 * so a Route with it off says nothing about tools whatever its progress knobs
 * say.
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
    await startedTool(relay, turn, activity, item, line);
    return;
  }
  if (isTerminalToolStatus(item.status)) await endedTool(relay, turn, activity, item, line);
}

/**
 * A tool that started. Past the throttle window it posts its own line, which
 * becomes the turn's live one; inside it, `update` rewrites that line so the
 * newest tool is always the one on screen and `skip` drops it — which is how
 * three different commands used to reach a channel as one `Running shell…`.
 */
async function startedTool(
  relay: ToolActivityRelay,
  turn: ToolActivityTurn,
  activity: ToolActivity,
  item: AgentStreamTimelineItem,
  line: string,
): Promise<void> {
  if (!throttled(relay, turn, activity)) {
    await postToolLine(relay, turn, item.callId, line);
    return;
  }
  if (activity.whenThrottled === "skip") return;
  await editToolLine(relay, turn, item.callId, line);
}

/**
 * A tool that ended. Its own line becomes the terminal one in place, so a
 * reader follows one message per call rather than two. With no line to rewrite
 * — its start was throttled away, or the channel has no edit verb, or the
 * provider only ever reported the end (Codex's silent shell completions) — it
 * posts one, under the same throttle as a start. A FAILURE ignores the
 * throttle and closes the live line, so the next tool that starts opens a new
 * one instead of overwriting what failed.
 */
async function endedTool(
  relay: ToolActivityRelay,
  turn: ToolActivityTurn,
  activity: ToolActivity,
  item: AgentStreamTimelineItem,
  line: string,
): Promise<void> {
  const failed = item.status === "failed";
  const owns = item.callId !== undefined && turn.toolLine?.callId === item.callId;
  if (owns && (await editToolLine(relay, turn, item.callId, line))) {
    if (failed) turn.toolLine = undefined;
    return;
  }
  if (!failed && throttled(relay, turn, activity)) return;
  await postToolLine(relay, turn, item.callId, line);
  if (failed) turn.toolLine = undefined;
}

/** Is a new tool line inside this turn's throttle window? `0` seconds never
 * throttles, and the first line of a turn is never held. */
function throttled(
  relay: ToolActivityRelay,
  turn: ToolActivityTurn,
  activity: ToolActivity,
): boolean {
  const lastAt = turn.lastToolPostAt;
  if (lastAt === null || activity.throttleSeconds === 0) return false;
  return relay.clock.now() - lastAt < activity.throttleSeconds * 1_000;
}

/** Post a tool line as its own message and make it the turn's live one. */
async function postToolLine(
  relay: ToolActivityRelay,
  turn: ToolActivityTurn,
  callId: string | undefined,
  line: string,
): Promise<void> {
  const externalMessageId = await relay.writer.post(line);
  turn.lastToolPostAt = relay.clock.now();
  turn.toolLine =
    externalMessageId === undefined || callId === undefined
      ? undefined
      : { callId, externalMessageId };
}

/**
 * Rewrite the turn's live tool line, and hand it to `callId`. False means it
 * did not happen, and every caller then falls back to what it would do without
 * an edit. A refused edit drops the line rather than retrying it: the channel
 * that refused this one will refuse the next.
 */
async function editToolLine(
  relay: ToolActivityRelay,
  turn: ToolActivityTurn,
  callId: string | undefined,
  line: string,
): Promise<boolean> {
  const live = turn.toolLine;
  if (live === undefined) return false;
  if (!(await relay.writer.edit(live.externalMessageId, line))) {
    turn.toolLine = undefined;
    return false;
  }
  if (callId !== undefined) turn.toolLine = { ...live, callId };
  return true;
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
 * The line for one tool call in its current state. `name` says the tool only;
 * `short` adds the target on one line, cut at `SHORT_TARGET_CHARS`; `full`
 * adds it whole and lets the outbound layer chunk it per platform.
 */
export function toolActivityLine(
  item: AgentStreamTimelineItem,
  detail: ToolActivityDetail,
): string {
  const name = item.name ?? item.type;
  const status = item.status ?? "completed";
  const verb = STATUS_VERBS[status] ?? "Ran";
  const target = detail === "name" ? undefined : toolTarget(item, detail === "full");
  if (target !== undefined) return `${verb} ${name}: ${target}`;
  return status === "running" ? `${verb} ${name}…` : `${verb} ${name}`;
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
