import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type { AgentMessage } from "@clisbot/protocol/agent-message";
import type { AgentAttachment } from "@clisbot/protocol/messages";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import { isLikelyExternalToolName } from "@clisbot/protocol/tool-name-normalization";
import { buildAgentMessageDisplay } from "@clisbot/protocol/clisbot-tool-presentation/index";
import { buildToolCallDisplayModel } from "@clisbot/protocol/tool-call-display";
import { projectTimelineRows, selectItemsByProjectedLimit } from "./timeline-projection.js";

const DEFAULT_MAX_ITEMS = 0;
const MAX_TOOL_INPUT_CHARS = 400;
const MAX_TOOL_SUMMARY_CHARS = 200;
/**
 * Fork history is measured in UTF-8 bytes, the unit the attachment is serialized, stored and
 * delivered in. A character count let CJK or emoji history reach three to four times the
 * intended size on the wire and in the provider prompt.
 */
const MAX_FORK_CONTEXT_BYTES = 100_000;
const MAX_FORK_METADATA_BYTES = 1_000;
const FORK_HISTORY_OMITTED = "[Earlier chat history omitted]\n";
const FORK_MESSAGE_TRUNCATED = "\n[Message truncated]\n";
/** Room below this is too small for a useful excerpt of the entry that crosses the budget. */
const MIN_FORK_EXCERPT_BYTES = 2_000;
/** The only kinds a fork copies; the checkpoint check and the paged reader use the same list. */
export const FORK_CONTEXT_KINDS: readonly AgentTimelineItem["type"][] = [
  "user_message",
  "assistant_message",
  "tool_call",
];

interface ActivityCuratorOptions {
  maxItems?: number;
  labelAssistantMessages?: boolean;
  includeKinds?: readonly AgentTimelineItem["type"][];
  includeExternalToolInput?: boolean;
}

interface ActivityEntry {
  text: string;
}

type TextAgentAttachment = Extract<AgentAttachment, { type: "text" }>;

function activityEntry(text: string): ActivityEntry {
  return { text };
}

function appendTextEntry(
  entries: ActivityEntry[],
  item: Extract<AgentTimelineItem, { type: "assistant_message" | "reasoning" }>,
  options?: ActivityCuratorOptions,
) {
  const text = item.text.trim();
  if (!text) return;
  let prefix = options?.labelAssistantMessages ? "[Assistant] " : "";
  if (item.type === "reasoning") prefix = "[Thought] ";
  entries.push(activityEntry(`${prefix}${text}`));
}

function formatToolInputJson(input: unknown): string | null {
  if (input === undefined) {
    return null;
  }
  try {
    const encoded = JSON.stringify(input);
    if (!encoded) {
      return null;
    }
    if (encoded.length <= MAX_TOOL_INPUT_CHARS) {
      return encoded;
    }
    return `${encoded.slice(0, MAX_TOOL_INPUT_CHARS)}...`;
  } catch {
    return null;
  }
}

function formatToolSummary(summary: string | undefined): string | null {
  if (typeof summary !== "string") {
    return null;
  }
  const normalized = summary.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= MAX_TOOL_SUMMARY_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_TOOL_SUMMARY_CHARS - 3)}...`;
}

function inputFromUnknownDetail(
  detail: Extract<AgentTimelineItem, { type: "tool_call" }>["detail"],
): unknown {
  return detail.type === "unknown" ? detail.input : undefined;
}

function projectForCuration(items: readonly AgentTimelineItem[]): AgentTimelineItem[] {
  const rows = items.map((item, index) => ({
    seq: index + 1,
    timestamp: "",
    item,
  }));
  return projectTimelineRows({ rows, mode: "projected" }).map((entry) => entry.item);
}

function shouldIncludeItem(item: AgentTimelineItem, options?: ActivityCuratorOptions): boolean {
  if (!options?.includeKinds) {
    return true;
  }
  return options.includeKinds.includes(item.type);
}

function formatToolCallEntry(
  item: Extract<AgentTimelineItem, { type: "tool_call" }>,
  options?: ActivityCuratorOptions,
): ActivityEntry {
  const inputJson = formatToolInputJson(inputFromUnknownDetail(item.detail));
  const display = buildToolCallDisplayModel({
    name: item.name,
    status: item.status,
    error: item.error,
    detail: item.detail,
    metadata: item.metadata,
  });
  const displayName = display.displayName;
  const summary = formatToolSummary(display.summary);
  if (
    (options?.includeExternalToolInput ?? true) &&
    isLikelyExternalToolName(item.name) &&
    inputJson
  ) {
    return activityEntry(`[${displayName}] ${inputJson}`);
  }
  return activityEntry(summary ? `[${displayName}] ${summary}` : `[${displayName}]`);
}

function appendAgentMessageEntries(entries: ActivityEntry[], message: AgentMessage) {
  const display = buildAgentMessageDisplay(message);
  entries.push(
    activityEntry(
      display.summary ? `[${display.displayName}] ${display.summary}` : `[${display.displayName}]`,
    ),
  );
  const body = message.text.trim();
  if (body) entries.push(activityEntry(body));
}

// COMPAT(subagent-log): sessions stored before sub-agents became launch markers carry the
// child's activity in `log`; current producers send it empty.
function appendLegacySubAgentLogEntry(
  entries: ActivityEntry[],
  item: Extract<AgentTimelineItem, { type: "tool_call" }>,
) {
  if (item.detail.type === "sub_agent" && item.detail.log?.trim()) {
    entries.push(activityEntry(item.detail.log.trim()));
  }
}

function curateProjectedActivityEntries(
  items: readonly AgentTimelineItem[],
  options?: ActivityCuratorOptions,
): ActivityEntry[] {
  if (items.length === 0) {
    return [];
  }

  const maxItems = options?.maxItems ?? DEFAULT_MAX_ITEMS;
  const recentItems = maxItems > 0 && items.length > maxItems ? items.slice(-maxItems) : items;

  const entries: ActivityEntry[] = [];

  for (const item of recentItems) {
    if (!shouldIncludeItem(item, options)) {
      continue;
    }

    switch (item.type) {
      case "user_message":
        entries.push(activityEntry(`[User] ${item.text.trim()}`));
        break;
      case "assistant_message":
      case "reasoning":
        appendTextEntry(entries, item, options);
        break;
      case "tool_call": {
        if (item.agentMessage) {
          appendAgentMessageEntries(entries, item.agentMessage);
          break;
        }
        entries.push(formatToolCallEntry(item, options));
        appendLegacySubAgentLogEntry(entries, item);
        break;
      }
      case "todo":
        entries.push(activityEntry("[Tasks]"));
        for (const entry of item.items) {
          const checkbox = entry.completed ? "[x]" : "[ ]";
          const text = `- ${checkbox} ${entry.text}`;
          entries.push(activityEntry(text));
        }
        break;
      case "error":
        entries.push(activityEntry(`[Error] ${item.message}`));
        break;
      case "compaction":
        entries.push(activityEntry("[Compacted]"));
        break;
    }
  }

  return entries;
}

function curateAgentActivityEntries(
  timeline: AgentTimelineItem[],
  options?: ActivityCuratorOptions,
): ActivityEntry[] {
  const collapsed = projectForCuration(timeline);
  return curateProjectedActivityEntries(collapsed, options);
}

/**
 * Convert normalized agent timeline items into a concise text summary.
 */
export function curateAgentActivity(
  timeline: AgentTimelineItem[],
  options?: ActivityCuratorOptions,
): string {
  const entries = curateAgentActivityEntries(timeline, options);
  return entries.length > 0
    ? entries.map((entry) => entry.text).join("\n")
    : "No activity to display.";
}

export function summarizeAgentActivity(timeline: AgentTimelineItem[], limit?: number) {
  const selection = selectItemsByProjectedLimit({
    items: timeline,
    direction: "tail",
    limit: limit ?? 0,
  });
  const { totalProjected, shownProjected } = selection;
  const noun = totalProjected === 1 ? "activity" : "activities";
  const countHeader =
    limit && shownProjected < totalProjected
      ? `Showing ${shownProjected} of ${totalProjected} ${noun} (limited to ${limit})`
      : `Showing all ${totalProjected} ${noun}`;
  return {
    updateCount: timeline.length,
    content: `${countHeader}\n\n${curateAgentActivity(selection.items)}`,
  };
}

interface ForkCursorBoundary {
  timelineEpoch: string;
  cursor: { epoch: string; seq: number };
}

function selectForkContextRows(input: {
  rows: readonly AgentTimelineRow[];
  cursorBoundary?: ForkCursorBoundary | null;
  boundaryMessageId?: string | null;
}): {
  items: AgentTimelineItem[];
  endSeq: number;
  boundaryCursor: { epoch: string; seq: number } | null;
  boundaryMessageId: string | null;
} {
  const projectedRows = projectTimelineRows({ rows: input.rows, mode: "projected" });
  const boundaryCursor = input.cursorBoundary?.cursor ?? null;
  const boundaryMessageId = input.boundaryMessageId?.trim() || null;
  if (!boundaryCursor && !boundaryMessageId) {
    return {
      items: projectedRows
        .filter((entry) => FORK_CONTEXT_KINDS.includes(entry.item.type))
        .map((entry) => entry.item),
      endSeq: input.rows.at(-1)?.seq ?? 0,
      boundaryCursor: null,
      boundaryMessageId: null,
    };
  }

  if (
    input.cursorBoundary &&
    input.cursorBoundary.cursor.epoch !== input.cursorBoundary.timelineEpoch
  ) {
    throw new Error("Selected timeline position is no longer available.");
  }
  const boundaryIndex = boundaryCursor
    ? projectedRows.findIndex((row) => row.seqEnd === boundaryCursor.seq)
    : projectedRows.findLastIndex(
        (row) => row.item.type === "assistant_message" && row.item.messageId === boundaryMessageId,
      );
  if (boundaryIndex < 0) {
    throw new Error(
      boundaryCursor
        ? "Selected timeline position is no longer available."
        : "Selected assistant message is no longer available.",
    );
  }
  const boundarySeq = projectedRows[boundaryIndex].seqEnd;
  // A copied row that spans the checkpoint was updated after it, and the projection keeps only
  // its latest payload: its state at the checkpoint is unknown, and copying it would put later
  // results into the fork. Plugin cards also stretch across later updates, but a fork never
  // copies them.
  if (
    projectedRows.some(
      (row) =>
        FORK_CONTEXT_KINDS.includes(row.item.type) &&
        row.seqStart <= boundarySeq &&
        row.seqEnd > boundarySeq,
    )
  ) {
    throw new Error(
      "This checkpoint changed after it was created. Fork from a later completed response instead.",
    );
  }
  const items = projectedRows
    .filter((row) => row.seqEnd <= boundarySeq && FORK_CONTEXT_KINDS.includes(row.item.type))
    .map((row) => row.item);

  return { items, endSeq: boundarySeq, boundaryCursor, boundaryMessageId };
}

function trimContextMetadata(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? utf8Head(trimmed, MAX_FORK_METADATA_BYTES) : null;
}

function buildForkContextText(input: {
  body: string;
  agentTitle?: string | null;
  cwd?: string | null;
}): string {
  const header = ["Chat history from a previous Clisbot agent."];
  const agentTitle = trimContextMetadata(input.agentTitle);
  const cwd = trimContextMetadata(input.cwd);
  if (agentTitle) {
    header.push(`Source agent: ${agentTitle}`);
  }
  if (cwd) {
    header.push(`Source directory: ${cwd}`);
  }
  return `<chat-history-summary>\n${header.join("\n")}\n\n${input.body}\n</chat-history-summary>`;
}

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** The longest prefix within `bytes`, never cutting a character in two. */
function utf8Head(text: string, bytes: number): string {
  const encoded = Buffer.from(text, "utf8");
  if (encoded.length <= bytes) return text;
  let end = Math.max(0, bytes);
  while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end--;
  return encoded.subarray(0, end).toString("utf8");
}

/** The longest suffix within `bytes`, never cutting a character in two. */
function utf8Tail(text: string, bytes: number): string {
  const encoded = Buffer.from(text, "utf8");
  if (encoded.length <= bytes) return text;
  let start = encoded.length - Math.max(0, bytes);
  while (start < encoded.length && (encoded[start]! & 0xc0) === 0x80) start++;
  return encoded.subarray(start).toString("utf8");
}

/**
 * Keeps the newest entries that fit `budget` bytes. `olderOmitted` says the caller already left
 * older history unread, so the omission marker is shown even when every read entry fits.
 */
function fitForkContextEntries(
  entries: ActivityEntry[],
  budget: number,
  olderOmitted: boolean,
): { body: string; truncated: boolean } {
  const joined = entries.map((entry) => entry.text).join("\n");
  const marker = olderOmitted ? FORK_HISTORY_OMITTED : "";
  if (utf8Bytes(marker) + utf8Bytes(joined) <= budget)
    return { body: marker + joined, truncated: false };

  const selected: string[] = [];
  let remaining = budget - utf8Bytes(FORK_HISTORY_OMITTED);
  for (let index = entries.length - 1; index >= 0; index--) {
    const text = entries[index]!.text;
    const separator = selected.length > 0 ? 1 : 0;
    const size = utf8Bytes(text) + separator;
    if (size > remaining) {
      // The entry that crosses the budget is often the long message the work happened in.
      // Keep its beginning and end in the room left instead of dropping it for a short reply.
      const available = remaining - separator - utf8Bytes(FORK_MESSAGE_TRUNCATED);
      if (selected.length === 0 || available >= MIN_FORK_EXCERPT_BYTES) {
        const head = Math.ceil(available / 2);
        selected.push(
          utf8Head(text, head) + FORK_MESSAGE_TRUNCATED + utf8Tail(text, available - head),
        );
      }
      break;
    }
    selected.push(text);
    remaining -= size;
  }
  return { body: FORK_HISTORY_OMITTED + selected.toReversed().join("\n"), truncated: true };
}

export function buildAgentForkContextAttachment(input: {
  rows: readonly AgentTimelineRow[];
  sourceSession?: { agentId: string; epoch: string };
  cursorBoundary?: ForkCursorBoundary | null;
  boundaryMessageId?: string | null;
  agentTitle?: string | null;
  cwd?: string | null;
  /** Older history was deliberately left unread (see `readForkHistoryRows`). */
  olderOmitted?: boolean;
}): {
  attachment: TextAgentAttachment;
  itemCount: number;
  /** Some read history did not fit the byte budget; reading more cannot add to the result. */
  truncated: boolean;
  boundaryCursor: { epoch: string; seq: number } | null;
  boundaryMessageId: string | null;
} {
  const selected = selectForkContextRows({
    rows: input.rows,
    cursorBoundary: input.cursorBoundary,
    boundaryMessageId: input.boundaryMessageId,
  });
  const entries = curateProjectedActivityEntries(selected.items, {
    maxItems: 0,
    labelAssistantMessages: true,
    includeKinds: FORK_CONTEXT_KINDS,
    includeExternalToolInput: false,
  });
  const metadata = { agentTitle: input.agentTitle, cwd: input.cwd };
  const budget =
    MAX_FORK_CONTEXT_BYTES - utf8Bytes(buildForkContextText({ body: "", ...metadata }));
  const olderOmitted = input.olderOmitted ?? false;
  const fitted =
    entries.length > 0
      ? fitForkContextEntries(entries, budget, olderOmitted)
      : {
          body: olderOmitted ? FORK_HISTORY_OMITTED.trimEnd() : "No chat history to display.",
          truncated: false,
        };
  const body = fitted.body;
  return {
    attachment: {
      type: "text",
      mimeType: "text/plain",
      contextKind: "chat_history",
      ...(input.sourceSession
        ? { sourceSession: { ...input.sourceSession, seq: selected.endSeq } }
        : {}),
      title: "Chat history",
      text: buildForkContextText({
        body,
        agentTitle: input.agentTitle,
        cwd: input.cwd,
      }),
    },
    itemCount: selected.items.length,
    truncated: fitted.truncated,
    boundaryCursor: selected.boundaryCursor,
    boundaryMessageId: selected.boundaryMessageId,
  };
}
