import {
  cleanInteractionSnapshot,
  collapseAdjacentDuplicateLines,
} from "./transcript-normalization.ts";
import {
  deriveInteractionText,
  escapeCodeFence,
  normalizePaneText,
  truncateHead,
  truncateTail,
  extractScrolledAppend,
} from "./transcript-delta.ts";
import {
  extractFinalAnswer,
  stripSingleLineAssistantEnvelope,
} from "./transcript-final-answer.ts";

function normalizeBoundaryLine(line: string) {
  return line.trim().replace(/^(?::eight_spoked_asterisk:|[-*•◦·✽✶])\s+/, "");
}

export function extractSlackIncrement(previousSnapshot: string, snapshot: string): string {
  const previous = cleanInteractionSnapshot(previousSnapshot);
  const current = cleanInteractionSnapshot(snapshot);

  if (!current || current === previous) {
    return "";
  }

  if (!previous) {
    return current;
  }

  const scrolledAppend = extractScrolledAppend(previous, current);
  if (scrolledAppend) {
    return scrolledAppend;
  }

  const previousLines = previous.split("\n");
  const currentLines = current.split("\n");
  let commonPrefixLines = 0;
  while (
    commonPrefixLines < previousLines.length &&
    commonPrefixLines < currentLines.length &&
    normalizeBoundaryLine(previousLines[commonPrefixLines] ?? "") ===
      normalizeBoundaryLine(currentLines[commonPrefixLines] ?? "")
  ) {
    commonPrefixLines += 1;
  }

  if (commonPrefixLines > 0) {
    return collapseAdjacentDuplicateLines(currentLines.slice(commonPrefixLines).join("\n"));
  }

  const maxOverlapLines = Math.min(previousLines.length, currentLines.length);
  for (let size = maxOverlapLines; size > 0; size -= 1) {
    const previousSuffix = previousLines
      .slice(previousLines.length - size)
      .map(normalizeBoundaryLine);
    const currentPrefix = currentLines.slice(0, size).map(normalizeBoundaryLine);
    if (
      previousSuffix.every(
        (line, index) => line === currentPrefix[index] && (line !== "" || previousSuffix.length === 1),
      )
    ) {
      return collapseAdjacentDuplicateLines(currentLines.slice(size).join("\n"));
    }
  }

  let prefixLength = 0;
  const maxPrefix = Math.min(previous.length, current.length);
  while (prefixLength < maxPrefix && previous[prefixLength] === current[prefixLength]) {
    prefixLength += 1;
  }

  return current.slice(prefixLength).replace(/^\n+/, "").trim();
}

export function selectSlackCompletionBody(params: {
  previousBody?: string;
  finalBody: string;
  response: "all" | "final";
}) {
  const finalBody = cleanInteractionSnapshot(params.finalBody);
  if (!finalBody) {
    return "";
  }

  if (params.response === "final") {
    return finalBody;
  }

  const previousBody = cleanInteractionSnapshot(params.previousBody ?? "");
  if (!previousBody) {
    return finalBody;
  }

  return extractSlackIncrement(previousBody, finalBody);
}

export function mergeSlackStreamBodies(currentBody: string, nextDelta: string) {
  const trimmedCurrent = currentBody.trim();
  const trimmedDelta = nextDelta.trim();
  if (!trimmedDelta) {
    return trimmedCurrent;
  }
  if (!trimmedCurrent) {
    return collapseAdjacentDuplicateLines(trimmedDelta);
  }

  const currentLines = trimmedCurrent.split("\n");
  const deltaLines = trimmedDelta.split("\n");
  const maxOverlap = Math.min(currentLines.length, deltaLines.length, 8);
  let overlap = 0;

  for (let size = maxOverlap; size > 0; size -= 1) {
    const currentSuffix = currentLines.slice(currentLines.length - size).map(normalizeBoundaryLine);
    const deltaPrefix = deltaLines.slice(0, size).map(normalizeBoundaryLine);
    if (currentSuffix.every((line, index) => line && line === deltaPrefix[index])) {
      overlap = size;
      break;
    }
  }

  if (overlap > 0) {
    const mergedLines = [...currentLines.slice(0, currentLines.length - overlap), ...deltaLines];
    return collapseAdjacentDuplicateLines(mergedLines.join("\n"));
  }

  return collapseAdjacentDuplicateLines(`${trimmedCurrent}\n\n${trimmedDelta}`);
}

export function selectSlackSnapshotBody(params: {
  snapshot: string;
  initialSnapshot?: string;
  previousBody?: string;
  status: "queued" | "running" | "completed" | "timeout" | "detached" | "error";
}) {
  const current = normalizePaneText(params.snapshot);
  const previousBody = cleanInteractionSnapshot(params.previousBody ?? "");
  const interactionBody = deriveInteractionText(params.initialSnapshot ?? "", current);

  if (!current) {
    return previousBody || "";
  }

  if (interactionBody) {
    return interactionBody;
  }

  return previousBody;
}

function renderInteractionBody(params: {
  status: "queued" | "running" | "completed" | "timeout" | "detached" | "error";
  content: string;
  maxChars: number;
  responsePolicy?: "all" | "final";
}) {
  const trimmedContent = params.content.trim();
  const responsePolicy = params.responsePolicy ?? "final";
  const completedBody =
    params.status === "completed" && responsePolicy === "final"
      ? stripSingleLineAssistantEnvelope(extractFinalAnswer(trimmedContent))
      : trimmedContent;

  if (!completedBody) {
    return "";
  }

  if (
    params.status === "completed" ||
    params.status === "timeout" ||
    params.status === "detached" ||
    params.status === "error"
  ) {
    return truncateHead(completedBody, params.maxChars);
  }

  return truncateTail(completedBody, params.maxChars);
}

function normalizeLeadingStatusLine(line: string) {
  return line.trim().replace(/^[_*`\s]+|[_*`\s]+$/g, "");
}

function startsWithExplicitErrorLabel(body: string) {
  const firstLine = body
    .split("\n")
    .map((line) => normalizeLeadingStatusLine(line))
    .find((line) => line.length > 0);

  if (!firstLine) {
    return false;
  }

  return /^(error|failed|failure|denied|forbidden)(?::|\.)/i.test(firstLine);
}

function shouldInlineErrorPrefix(body: string) {
  return !body.includes("\n") && !body.includes("```");
}

function renderErrorInteractionBody(body: string, footer: string) {
  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return footer;
  }

  if (startsWithExplicitErrorLabel(trimmedBody)) {
    return trimmedBody;
  }

  if (shouldInlineErrorPrefix(trimmedBody)) {
    return `Error: ${trimmedBody}`;
  }

  return `${trimmedBody}\n\n${footer}`;
}

function renderSlackRunningInteraction(body: string, note?: string) {
  const statusNote = note ? `_${note}_` : "_Working..._";
  return body ? `${body}\n\n${statusNote}` : statusNote;
}

function renderTelegramRunningInteraction(body: string, note?: string) {
  const statusNote = note || "Working...";
  return body ? `${body}\n\n${statusNote}` : statusNote;
}

export function renderSlackInteraction(params: {
  status: "queued" | "running" | "completed" | "timeout" | "detached" | "error";
  content: string;
  maxChars: number;
  queuePosition?: number;
  note?: string;
  allowTranscriptInspection?: boolean;
  responsePolicy?: "all" | "final";
}) {
  const body = renderInteractionBody(params);

  if (params.status === "queued") {
    const queueNote =
      typeof params.queuePosition === "number" && params.queuePosition > 0
        ? `_Queued: ${params.queuePosition} ahead._`
        : "_Queued._";
    return body ? `${queueNote}\n\n${body}` : queueNote;
  }

  if (params.status === "running") {
    return renderSlackRunningInteraction(body, params.note);
  }

  if (params.status === "timeout") {
    return body ? `${body}\n\n_Timed out waiting for more output._` : "_Timed out waiting for visible output._";
  }

  if (params.status === "detached") {
    const note = resolveDetachedInteractionNote({
      baseNote: params.note,
      allowTranscriptInspection: params.allowTranscriptInspection,
      transcriptCommand: "`/transcript`",
    });
    return body ? `${body}\n\n_${note}_` : `_${note}_`;
  }

  if (params.status === "error") {
    return renderErrorInteractionBody(body, "_Error._");
  }

  return body || "_Completed with no new visible output._";
}

export function renderTelegramInteraction(params: {
  status: "queued" | "running" | "completed" | "timeout" | "detached" | "error";
  content: string;
  maxChars: number;
  queuePosition?: number;
  note?: string;
  allowTranscriptInspection?: boolean;
  responsePolicy?: "all" | "final";
}) {
  const body = renderInteractionBody(params);

  if (params.status === "queued") {
    const queueNote =
      typeof params.queuePosition === "number" && params.queuePosition > 0
        ? `Queued: ${params.queuePosition} ahead.`
        : "Queued.";
    return body ? `${queueNote}\n\n${body}` : queueNote;
  }

  if (params.status === "running") {
    return renderTelegramRunningInteraction(body, params.note);
  }

  if (params.status === "timeout") {
    return body ? `${body}\n\nTimed out waiting for more output.` : "Timed out waiting for visible output.";
  }

  if (params.status === "detached") {
    const note = resolveDetachedInteractionNote({
      baseNote: params.note,
      allowTranscriptInspection: params.allowTranscriptInspection,
      transcriptCommand: "/transcript",
    });
    return body ? `${body}\n\n${note}` : note;
  }

  if (params.status === "error") {
    return renderErrorInteractionBody(body, "Error.");
  }

  return body || "Completed with no new visible output.";
}

export function renderSlackTranscript(params: {
  agentId: string;
  sessionName: string;
  workspacePath: string;
  status: "queued" | "running" | "completed" | "timeout" | "detached" | "error";
  snapshot: string;
  queuePosition?: number;
  maxChars: number;
  note?: string;
}) {
  const lines = [
    `clisbot`,
    `agent: ${params.agentId}`,
    `session: ${params.sessionName}`,
    `workspace: ${params.workspacePath}`,
    `status: ${params.status}`,
  ];

  if (typeof params.queuePosition === "number" && params.queuePosition > 0) {
    lines.push(`queue: ${params.queuePosition} ahead`);
  }

  if (params.note) {
    lines.push(`note: ${params.note}`);
  }

  const body = escapeCodeFence(truncateTail(params.snapshot || "(no tmux output yet)", params.maxChars));
  return `${lines.join("\n")}\n\n\`\`\`\n${body}\n\`\`\``;
}

export function renderCompactChannelTranscript(params: {
  snapshot: string;
  maxChars: number;
  fullCommand?: string;
}) {
  const body = escapeCodeFence(truncateTail(params.snapshot || "(no tmux output yet)", params.maxChars));
  const fullCommand = params.fullCommand ?? "/transcript full";

  return [
    "Transcript",
    "",
    "Recent session snapshot:",
    "```",
    body,
    "```",
    `Use \`${fullCommand}\` if you want the longer pane snapshot.`,
  ].join("\n");
}

export const renderSlackSnapshot = renderSlackTranscript;
export const renderChannelInteraction = renderSlackInteraction;
export const renderChannelTranscript = renderSlackTranscript;
export const renderChannelSnapshot = renderSlackSnapshot;

export function resolveDetachedInteractionNote(params: {
  baseNote?: string;
  allowTranscriptInspection?: boolean;
  transcriptCommand: string;
}) {
  const note =
    params.baseNote ??
    "This session is still running. Use `/attach`, `/watch every <duration>`, or `/stop` to manage it.";
  if (!params.allowTranscriptInspection) {
    return note;
  }

  if (note.includes("/transcript")) {
    return note;
  }

  return `${note} You can also use ${params.transcriptCommand} to inspect the current session snapshot.`;
}
