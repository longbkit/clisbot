import { stripVTControlCharacters } from "node:util";

export function normalizePaneText(raw: string): string {
  return stripVTControlCharacters(raw).replaceAll("\r\n", "\n").replaceAll("\r", "\n").trimEnd();
}

function splitNormalizedLines(raw: string): string[] {
  const normalized = normalizePaneText(raw);
  return normalized ? normalized.split("\n") : [];
}

function trimBlankLines(lines: string[]) {
  let start = 0;
  let end = lines.length;

  while (start < end && !lines[start]?.trim()) {
    start += 1;
  }

  while (end > start && !lines[end - 1]?.trim()) {
    end -= 1;
  }

  return lines.slice(start, end);
}

function collapseBlankLines(lines: string[]) {
  const collapsed: string[] = [];

  for (const line of lines) {
    if (!line.trim() && collapsed.at(-1) === "") {
      continue;
    }

    collapsed.push(line.trim() ? line : "");
  }

  return collapsed;
}

function looksLikeUrlContinuation(line: string) {
  const trimmed = line.trim();
  return trimmed.startsWith("(") || trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

function isListOrStructuredLine(line: string) {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("```") ||
    trimmed.startsWith("› ") ||
    /^[-*•]\s/.test(trimmed) ||
    /^\d+\.\s/.test(trimmed) ||
    trimmed.startsWith("#")
  );
}

function shouldJoinWrappedLine(previousLine: string, currentLine: string) {
  const previous = previousLine.trimEnd();
  const current = currentLine.trim();
  if (!previous || !current) {
    return false;
  }

  if (isListOrStructuredLine(currentLine)) {
    return false;
  }

  return (
    /^\s{2,}/.test(currentLine) ||
    previous.endsWith("-") ||
    current.startsWith("(") ||
    current.startsWith("http")
  );
}

function joinWrappedLines(previousLine: string, currentLine: string) {
  const previous = previousLine.trimEnd();
  const current = currentLine.trim();
  if (previous.endsWith("-")) {
    return `${previous}${current}`;
  }

  return `${previous} ${current}`;
}

function stripUrlContinuationGaps(lines: string[]) {
  const compacted: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      const previousLine = compacted.at(-1);
      const nextLine = lines[index + 1];
      if (previousLine && nextLine && looksLikeUrlContinuation(nextLine)) {
        continue;
      }
    }

    compacted.push(line);
  }

  return compacted;
}

function unwrapSoftWrappedLines(lines: string[]) {
  const unwrapped: string[] = [];

  for (const line of stripUrlContinuationGaps(lines)) {
    const previousLine = unwrapped.at(-1);
    if (previousLine && shouldJoinWrappedLine(previousLine, line)) {
      unwrapped[unwrapped.length - 1] = joinWrappedLines(previousLine, line);
      continue;
    }

    unwrapped.push(line);
  }

  return unwrapped;
}

function looksLikeCodexSnapshot(lines: string[]) {
  return lines.some((line) => {
    const trimmed = line.trim();
    return (
      trimmed.includes("OpenAI Codex") ||
      trimmed.includes("Welcome to Codex") ||
      trimmed.includes("Do you trust the contents of this directory?") ||
      trimmed.startsWith("› ") ||
      /^gpt-[\w.-]+/.test(trimmed)
    );
  });
}

function looksLikeClaudeSnapshot(lines: string[]) {
  return lines.some((line) => {
    const trimmed = line.trim();
    return (
      trimmed.includes("Claude Code v") ||
      trimmed.includes("Welcome back!") ||
      trimmed.includes("Tips for getting started") ||
      trimmed.startsWith("❯") ||
      trimmed.startsWith("⏺")
    );
  });
}

function isProgressLine(line: string) {
  const trimmed = line.trim();
  const normalized = trimmed.replace(/^(?::eight_spoked_asterisk:|[✽✶])\s+/, "");
  return (
    /^• (Searching|Searched|Explored|Reading|Inspecting|Checking|Running|Calling|Using|Thinking|Looking|Analyzing|Listing|Gathering)\b/i.test(
      normalized,
    ) ||
    /^• I(?:'|’)m (checking|listing|searching|looking|inspecting|reading|running|analyzing|pulling|refreshing)\b/i.test(
      normalized,
    ) ||
    /^[^A-Za-z0-9]*[A-Za-z][a-z]{3,24}(?:ing|ed)$/i.test(normalized) ||
    /^Read \d+ files?(?:, recalled \d+ memor(?:y|ies))?(?: \(.*\))?$/i.test(normalized) ||
    /^Reading \d+ files?(?: \(.*\))?$/i.test(normalized) ||
    /^Searched for \d+ patterns?(?:, read \d+ files?)?(?: \(.*\))?$/i.test(normalized) ||
    /^Searching for \d+ patterns?, reading \d+ files?[.…]*(?: \(.*\))?$/i.test(normalized)
  );
}

function unwrapMessageBlocks(
  lines: string[],
  params: {
    marker: RegExp;
    isProgressLine?: (line: string) => boolean;
  },
) {
  const normalized: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!params.marker.test(line.trimStart()) || params.isProgressLine?.(line)) {
      normalized.push(line);
      continue;
    }

    let end = index + 1;
    let sawIndentedContinuation = false;
    while (end < lines.length) {
      const candidate = lines[end] ?? "";
      if (!candidate.trim()) {
        end += 1;
        continue;
      }

      if (/^\s{2,}\S/.test(candidate)) {
        sawIndentedContinuation = true;
        end += 1;
        continue;
      }

      break;
    }

    if (!sawIndentedContinuation) {
      normalized.push(line);
      continue;
    }

    normalized.push(line.replace(params.marker, ""));
    for (let continuationIndex = index + 1; continuationIndex < end; continuationIndex += 1) {
      const continuation = lines[continuationIndex] ?? "";
      normalized.push(continuation ? continuation.replace(/^ {2}/, "") : continuation);
    }
    index = end - 1;
  }

  return normalized;
}

function unwrapCodexMessageBlocks(lines: string[]) {
  return unwrapMessageBlocks(lines, {
    marker: /^\s*•\s*/,
    isProgressLine,
  });
}

function unwrapClaudeMessageBlocks(lines: string[]) {
  return unwrapMessageBlocks(lines, {
    marker: /^\s*⏺\s*/,
  }).map((line) =>
    line
      .replace(/^\s*⏺\s*/, "")
      .replace(/^\s*⎿\s*/, "")
      .replace(/^\s*·\s*/, "• "),
  );
}

function dropPromptBlocks(lines: string[], marker: RegExp) {
  const filtered: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!marker.test(line.trimStart())) {
      filtered.push(line);
      continue;
    }

    let end = index + 1;
    while (end < lines.length) {
      const candidate = lines[end] ?? "";
      if (!candidate.trim()) {
        end += 1;
        continue;
      }

      if (/^\s{2,}\S/.test(candidate)) {
        end += 1;
        continue;
      }

      break;
    }

    index = end - 1;
  }

  return filtered;
}

function dropCodexPromptBlocks(lines: string[]) {
  return dropPromptBlocks(lines, /^\s*›\s/);
}

function dropClaudePromptBlocks(lines: string[]) {
  const filtered: string[] = [];
  let skippingPrompt = false;

  for (const line of lines) {
    if (/^\s*❯/.test(line.trimStart())) {
      skippingPrompt = true;
      continue;
    }

    if (skippingPrompt) {
      if (!line.trim()) {
        skippingPrompt = false;
      }
      continue;
    }

    filtered.push(line);
  }

  return filtered;
}

function isInterruptStatusLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  return (
    /^(?:[•◦·]\s*)?Working(?:\s*\()?\d+s\b.*(?:esc to interrupt|interrupt)\)?$/i.test(trimmed) ||
    /^(?:[•◦·]\s*)?\d+s\s*[•◦·]?\s*esc to interrupt\)?$/i.test(trimmed)
  );
}

function shouldDropCodexChromeLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  return (
    trimmed.includes("Welcome to Codex") ||
    trimmed.includes("Do you trust the contents of this directory?") ||
    trimmed === "Press enter to continue" ||
    trimmed === "1. Yes, continue" ||
    trimmed === "2. No, quit" ||
    trimmed.startsWith("model:") ||
    trimmed.startsWith("directory:") ||
    trimmed.startsWith("Tip:") ||
    trimmed.startsWith("Ctrl+L is disabled") ||
    isInterruptStatusLine(trimmed) ||
    trimmed.startsWith("› ") ||
    /^gpt-[\w.-]+ .*·/.test(trimmed) ||
    /^[╭╰│]/.test(trimmed) ||
    /^─+$/.test(trimmed)
  );
}

function shouldDropClaudeChromeLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  return (
    trimmed.includes("Claude Code v") ||
    trimmed.includes("Welcome back!") ||
    trimmed.includes("Tips for getting started") ||
    trimmed.includes("Ask Claude to create a new app or clone a repository") ||
    trimmed.includes("Recent activity") ||
    trimmed.includes("No recent activity") ||
    trimmed.includes("API Usage Billing") ||
    trimmed.includes("shift+tab to cycle") ||
    trimmed.includes("ctrl+o to expand") ||
    trimmed.includes("ctrl+b ctrl+b") ||
    trimmed.includes("run in background") ||
    /^~\/\.muxbot\/(?:workspace\/)?[a-z0-9._/-]+$/i.test(trimmed) ||
    trimmed.includes("| claude |") ||
    /^(?:[✻*]\s*)?(?:Worked|Cooked) for \d+s$/i.test(trimmed) ||
    trimmed.startsWith("⏵⏵") ||
    trimmed.startsWith("❯") ||
    isProgressLine(trimmed) ||
    /^[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+$/.test(trimmed) ||
    /^[╭╰│]/.test(trimmed) ||
    /^─+$/.test(trimmed) ||
    /^[▐▛▜▌▝▘ ]+$/.test(trimmed) ||
    /^[▐▛▜▌▝▘ ]+.+$/.test(trimmed)
  );
}

export function cleanInteractionSnapshot(raw: string) {
  const lines = splitNormalizedLines(raw);
  const isCodex = looksLikeCodexSnapshot(lines);
  const isClaude = looksLikeClaudeSnapshot(lines);
  const promptStripped = isCodex
    ? dropCodexPromptBlocks(lines)
    : isClaude
      ? dropClaudePromptBlocks(lines)
      : lines;
  const filtered = promptStripped.filter((line) => {
    if (isCodex && shouldDropCodexChromeLine(line)) {
      return false;
    }

    if (isClaude && shouldDropClaudeChromeLine(line)) {
      return false;
    }

    return true;
  });
  const normalized = isCodex
    ? unwrapCodexMessageBlocks(filtered)
    : isClaude
      ? unwrapClaudeMessageBlocks(filtered)
      : filtered;
  const unwrapped = unwrapSoftWrappedLines(normalized);
  return collapseAdjacentDuplicateLines(collapseBlankLines(trimBlankLines(unwrapped)).join("\n"));
}

function diffText(previous: string, current: string) {
  if (!current || current === previous) {
    return "";
  }

  if (!previous) {
    return current;
  }

  const previousLines = previous.split("\n");
  const currentLines = current.split("\n");
  let start = 0;

  while (
    start < previousLines.length &&
    start < currentLines.length &&
    previousLines[start] === currentLines[start]
  ) {
    start += 1;
  }

  let previousEnd = previousLines.length - 1;
  let currentEnd = currentLines.length - 1;
  while (
    previousEnd >= start &&
    currentEnd >= start &&
    previousLines[previousEnd] === currentLines[currentEnd]
  ) {
    previousEnd -= 1;
    currentEnd -= 1;
  }

  return collapseBlankLines(trimBlankLines(currentLines.slice(start, currentEnd + 1)))
    .join("\n")
    .trim();
}

function extractScrolledAppend(previous: string, current: string) {
  if (!previous || !current || previous === current) {
    return "";
  }

  if (current.startsWith(previous)) {
    return current.slice(previous.length).replace(/^\n+/, "").trim();
  }

  const previousIndex = current.indexOf(previous);
  if (previousIndex >= 0) {
    return current
      .slice(previousIndex + previous.length)
      .replace(/^\n+/, "")
      .trim();
  }

  const previousLines = previous.split("\n");
  const currentLines = current.split("\n");
  const maxOverlap = Math.min(previousLines.length, currentLines.length);

  for (let size = maxOverlap; size > 0; size -= 1) {
    const previousSuffix = previousLines.slice(previousLines.length - size).join("\n");
    if (size < 2 && previousSuffix.length < 80) {
      continue;
    }

    for (let start = 0; start <= currentLines.length - size; start += 1) {
      const currentWindow = currentLines.slice(start, start + size).join("\n");
      if (previousSuffix !== currentWindow) {
        continue;
      }

      return currentLines
        .slice(start + size)
        .join("\n")
        .trim();
    }
  }

  return "";
}

export function deriveInteractionText(initialSnapshot: string, currentSnapshot: string) {
  const previous = cleanInteractionSnapshot(initialSnapshot);
  const current = cleanInteractionSnapshot(currentSnapshot);
  return extractScrolledAppend(previous, current) || diffText(previous, current);
}

function joinExcerpt(lines: string[], params: { trimmedHead: boolean; trimmedTail: boolean }) {
  if (lines.length === 0) {
    return "";
  }

  const rendered = [...lines];
  if (params.trimmedHead) {
    rendered.unshift("...");
  }
  if (params.trimmedTail) {
    rendered.push("...");
  }

  return rendered.join("\n");
}

export function deriveMeaningfulPaneSnapshot(params: {
  previousSnapshot?: string;
  snapshot: string;
  contextLines?: number;
  maxLines?: number;
}) {
  const previous = cleanInteractionSnapshot(params.previousSnapshot ?? "");
  const current = cleanInteractionSnapshot(params.snapshot);
  const contextLines = Math.max(0, params.contextLines ?? 2);
  const maxLines = Math.max(1, params.maxLines ?? 40);

  if (!current) {
    return {
      fullSnapshot: "",
      displaySnapshot: "",
      hasMeaningfulChange: false,
    };
  }

  const currentLines = splitNormalizedLines(current);

  if (!previous) {
    const excerpt = currentLines.slice(-maxLines);
    return {
      fullSnapshot: current,
      displaySnapshot: joinExcerpt(excerpt, {
        trimmedHead: excerpt.length < currentLines.length,
        trimmedTail: false,
      }),
      hasMeaningfulChange: true,
    };
  }

  if (current === previous) {
    return {
      fullSnapshot: current,
      displaySnapshot: current,
      hasMeaningfulChange: false,
    };
  }

  const previousLines = splitNormalizedLines(previous);
  let prefix = 0;
  while (
    prefix < previousLines.length &&
    prefix < currentLines.length &&
    previousLines[prefix] === currentLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < previousLines.length - prefix &&
    suffix < currentLines.length - prefix &&
    previousLines[previousLines.length - 1 - suffix] ===
      currentLines[currentLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const currentChangedEnd = currentLines.length - suffix;
  const previousChangedEnd = previousLines.length - suffix;
  const excerptStart = Math.max(0, prefix - contextLines);
  const excerptEnd = Math.min(currentLines.length, currentChangedEnd + contextLines);
  const nextExcerpt = currentLines.slice(excerptStart, excerptEnd);

  if (nextExcerpt.length === 0) {
    const removedCount = Math.max(1, previousChangedEnd - prefix);
    return {
      fullSnapshot: current,
      displaySnapshot: `[${removedCount} line${removedCount === 1 ? "" : "s"} removed from pane]`,
      hasMeaningfulChange: true,
    };
  }

  const boundedExcerpt =
    nextExcerpt.length > maxLines ? nextExcerpt.slice(nextExcerpt.length - maxLines) : nextExcerpt;

  return {
    fullSnapshot: current,
    displaySnapshot: joinExcerpt(boundedExcerpt, {
      trimmedHead: excerptStart > 0 || boundedExcerpt.length < nextExcerpt.length,
      trimmedTail: excerptEnd < currentLines.length,
    }),
    hasMeaningfulChange: true,
  };
}

export function truncateTail(raw: string, maxChars: number): string {
  if (raw.length <= maxChars) {
    return raw;
  }

  return `...\n${raw.slice(raw.length - maxChars + 4)}`;
}

export function truncateHead(raw: string, maxChars: number): string {
  if (raw.length <= maxChars) {
    return raw;
  }

  return `${raw.slice(0, maxChars - 4)}\n...`;
}

export function escapeCodeFence(raw: string): string {
  return raw.replaceAll("```", "'''");
}

function isProgressBlock(block: string) {
  const lines = splitNormalizedLines(block).map((line) => line.trim()).filter(Boolean);
  const firstLine = lines[0];
  if (!firstLine) {
    return false;
  }

  if (lines.length === 1 && isProgressLine(firstLine)) {
    return true;
  }

  const trimmed = firstLine.trim();
  return (
    /^• (Searching|Searched|Explored|Reading|Inspecting|Checking|Running|Calling|Using|Thinking|Looking|Analyzing|Listing|Gathering)\b/i.test(
      trimmed,
    ) ||
    /^• I(?:'|’)m (checking|listing|searching|looking|inspecting|reading|running|analyzing)\b/i.test(
      trimmed,
    )
  );
}

function looksLikePathLikeLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return false;
  }

  return (
    /^(?:\.{1,2}|~)?\//.test(trimmed) ||
    /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\/?$/.test(trimmed)
  );
}

function looksLikeFilesystemLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  return (
    /^total \d+\b/i.test(trimmed) ||
    /^(drwx|d---|-[rwx-]{3,}|lrwx)\S*/i.test(trimmed) ||
    looksLikePathLikeLine(trimmed)
  );
}

function looksLikeShellCommandLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  return /^[#$]\s+\S/.test(trimmed);
}

function looksLikeOperationalTraceLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  return /^(Ran|Run|Running|Explored|Exploring|Searched|Searching|Reading|Inspecting|Checking|Calling|Using|Listing|Gathering)\b/i.test(
    trimmed,
  );
}

function isMostlyFilesystemBlock(lines: string[]) {
  if (lines.length === 0) {
    return false;
  }

  const filesystemLineCount = lines.filter(looksLikeFilesystemLine).length;
  return filesystemLineCount === lines.length || filesystemLineCount >= Math.max(2, lines.length - 1);
}

function isToolingBlock(block: string) {
  const lines = splitNormalizedLines(block).map((line) => line.trim()).filter(Boolean);
  const firstLine = lines[0];
  if (!firstLine) {
    return false;
  }

  if (isProgressBlock(block)) {
    return true;
  }

  if (looksLikeOperationalTraceLine(firstLine) || looksLikeShellCommandLine(firstLine)) {
    return true;
  }

  if (firstLine.startsWith("FILE:")) {
    return true;
  }

  if (looksLikeFilesystemLine(firstLine) || isMostlyFilesystemBlock(lines)) {
    return true;
  }

  if (looksLikePathLikeLine(firstLine) && lines.length <= 2) {
    return true;
  }

  return lines.some(
    (line) =>
      line.startsWith("FILE:") ||
      looksLikeOperationalTraceLine(line) ||
      looksLikeShellCommandLine(line) ||
      looksLikeFilesystemLine(line),
  );
}

function isResidualToolOutputBlock(block: string) {
  const lines = splitNormalizedLines(block).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) {
    return false;
  }

  const [line] = lines;
  if (!line) {
    return false;
  }

  return (
    /^_[^_]+_$/.test(line) ||
    /^`[^`]+`$/.test(line) ||
    looksLikePathLikeLine(line)
  );
}

export function extractFinalAnswer(raw: string) {
  const rawLines = splitNormalizedLines(raw);
  const isCodex = looksLikeCodexSnapshot(rawLines);
  const isClaude = looksLikeClaudeSnapshot(rawLines);
  const cleaned = cleanInteractionSnapshot(raw);
  if (!cleaned) {
    return "";
  }

  const blocks = cleaned.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  let startIndex = 0;
  let lastToolingIndex = -1;

  for (let index = 0; index < blocks.length; index += 1) {
    if (isToolingBlock(blocks[index] ?? "")) {
      lastToolingIndex = index;
    }
  }

  if (lastToolingIndex >= 0 && lastToolingIndex < blocks.length - 1) {
    startIndex = lastToolingIndex + 1;
    while (
      startIndex < blocks.length - 1 &&
      isResidualToolOutputBlock(blocks[startIndex] ?? "")
    ) {
      startIndex += 1;
    }
  } else {
    while (startIndex < blocks.length - 1 && isProgressBlock(blocks[startIndex] ?? "")) {
      startIndex += 1;
    }
  }

  const answer = blocks.slice(startIndex).join("\n\n").trim();
  const extracted = answer || cleaned;
  if (isCodex || isClaude) {
    return stripSingleLineAssistantEnvelope(extracted);
  }

  return extracted;
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

function normalizeBoundaryLine(line: string) {
  return line.trim().replace(/^(?::eight_spoked_asterisk:|[-*•◦·✽✶])\s+/, "");
}

function stripSingleLineAssistantEnvelope(text: string) {
  if (!text || text.includes("\n")) {
    return text;
  }

  return text.replace(/^(?::eight_spoked_asterisk:|[•◦·✽✶⏺])\s+/, "");
}

function collapseAdjacentDuplicateLines(raw: string) {
  const lines = raw.split("\n");
  const collapsed: string[] = [];
  let lastNonEmptyNormalized = "";

  for (const line of lines) {
    const normalized = normalizeBoundaryLine(line);
    if (normalized && normalized === lastNonEmptyNormalized) {
      if (collapsed.at(-1) === "") {
        collapsed.pop();
      }
      continue;
    }

    collapsed.push(line);
    if (normalized) {
      lastNonEmptyNormalized = normalized;
    }
  }

  return collapseBlankLines(collapsed).join("\n").trim();
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
  status: "queued" | "running" | "completed" | "timeout" | "error";
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

  if (params.status === "completed" || params.status === "timeout" || params.status === "error") {
    return previousBody;
  }

  return previousBody;
}

export function renderSlackInteraction(params: {
  status: "queued" | "running" | "completed" | "timeout" | "error";
  content: string;
  maxChars: number;
  queuePosition?: number;
  note?: string;
  responsePolicy?: "all" | "final";
}) {
  const trimmedContent = params.content.trim();
  const responsePolicy = params.responsePolicy ?? "final";
  const completedBody =
    params.status === "completed" && responsePolicy === "final"
      ? stripSingleLineAssistantEnvelope(extractFinalAnswer(trimmedContent))
      : trimmedContent;
  const body = completedBody
    ? params.status === "completed" || params.status === "timeout" || params.status === "error"
      ? truncateHead(completedBody, params.maxChars)
      : truncateTail(completedBody, params.maxChars)
    : "";

  if (params.status === "queued") {
    const queueNote =
      typeof params.queuePosition === "number" && params.queuePosition > 0
        ? `_Queued: ${params.queuePosition} ahead._`
        : "_Queued._";
    return body ? `${queueNote}\n\n${body}` : queueNote;
  }

  if (params.status === "running") {
    if (body) {
      return body;
    }

    return params.note ? `_${params.note}_` : "_Working..._";
  }

  if (params.status === "timeout") {
    return body ? `${body}\n\n_Timed out waiting for more output._` : "_Timed out waiting for visible output._";
  }

  if (params.status === "error") {
    return body ? `${body}\n\n_Error._` : "_Error._";
  }

  return body || "_Completed with no new visible output._";
}

export function renderTelegramInteraction(params: {
  status: "queued" | "running" | "completed" | "timeout" | "error";
  content: string;
  maxChars: number;
  queuePosition?: number;
  note?: string;
  responsePolicy?: "all" | "final";
}) {
  const trimmedContent = params.content.trim();
  const responsePolicy = params.responsePolicy ?? "final";
  const completedBody =
    params.status === "completed" && responsePolicy === "final"
      ? stripSingleLineAssistantEnvelope(extractFinalAnswer(trimmedContent))
      : trimmedContent;
  const body = completedBody
    ? params.status === "completed" || params.status === "timeout" || params.status === "error"
      ? truncateHead(completedBody, params.maxChars)
      : truncateTail(completedBody, params.maxChars)
    : "";

  if (params.status === "queued") {
    const queueNote =
      typeof params.queuePosition === "number" && params.queuePosition > 0
        ? `Queued: ${params.queuePosition} ahead.`
        : "Queued.";
    return body ? `${queueNote}\n\n${body}` : queueNote;
  }

  if (params.status === "running") {
    if (body) {
      return body;
    }

    return params.note ?? "Working...";
  }

  if (params.status === "timeout") {
    return body ? `${body}\n\nTimed out waiting for more output.` : "Timed out waiting for visible output.";
  }

  if (params.status === "error") {
    return body ? `${body}\n\nError.` : "Error.";
  }

  return body || "Completed with no new visible output.";
}

export function renderSlackTranscript(params: {
  agentId: string;
  sessionName: string;
  workspacePath: string;
  status: "queued" | "running" | "completed" | "timeout" | "error";
  snapshot: string;
  queuePosition?: number;
  maxChars: number;
  note?: string;
}) {
  const lines = [
    `muxbot`,
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

export const renderSlackSnapshot = renderSlackTranscript;
export const renderChannelInteraction = renderSlackInteraction;
export const renderChannelTranscript = renderSlackTranscript;
export const renderChannelSnapshot = renderSlackSnapshot;
