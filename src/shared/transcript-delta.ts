import {
  cleanInteractionSnapshot,
  collapseBlankLines,
  normalizePaneText,
  splitNormalizedLines,
  trimBlankLines,
} from "./transcript-normalization.ts";

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

export function extractScrolledAppend(previous: string, current: string) {
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

export function deriveRunningInteractionText(previousSnapshot: string, currentSnapshot: string) {
  const previous = cleanInteractionSnapshot(previousSnapshot);
  const current = cleanInteractionSnapshot(currentSnapshot);

  if (!current || current === previous) {
    return "";
  }

  if (!previous) {
    return current;
  }

  return extractScrolledAppend(previous, current);
}

export function deriveInteractionText(initialSnapshot: string, currentSnapshot: string) {
  const previous = cleanInteractionSnapshot(initialSnapshot);
  const current = cleanInteractionSnapshot(currentSnapshot);
  return extractScrolledAppend(previous, current) || diffText(previous, current);
}

export function appendInteractionText(currentBody: string, nextDelta: string) {
  const trimmedCurrent = currentBody.trim();
  const trimmedDelta = nextDelta.trim();

  if (!trimmedDelta) {
    return trimmedCurrent;
  }

  if (!trimmedCurrent) {
    return trimmedDelta;
  }

  const currentLines = trimmedCurrent.split("\n");
  const deltaLines = trimmedDelta.split("\n");
  const maxOverlap = Math.min(currentLines.length, deltaLines.length, 8);
  let overlap = 0;

  for (let size = maxOverlap; size > 0; size -= 1) {
    const currentSuffix = currentLines.slice(currentLines.length - size).join("\n");
    const deltaPrefix = deltaLines.slice(0, size).join("\n");
    if (currentSuffix === deltaPrefix) {
      overlap = size;
      break;
    }
  }

  return [...currentLines, ...deltaLines.slice(overlap)].join("\n").trim();
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

export { cleanInteractionSnapshot, normalizePaneText };
