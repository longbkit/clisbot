import {
  cleanInteractionSnapshot,
  isProgressLine,
  looksLikeClaudeSnapshot,
  looksLikeCodexSnapshot,
  looksLikeGeminiSnapshot,
  splitNormalizedLines,
} from "./transcript-normalization.ts";

export function stripSingleLineAssistantEnvelope(text: string) {
  if (!text || text.includes("\n")) {
    return text;
  }

  return text.replace(/^(?::eight_spoked_asterisk:|[•◦·✽✶⏺])\s+/, "");
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

  return (
    /^• (Searching|Searched|Explored|Reading|Inspecting|Checking|Running|Calling|Using|Thinking|Looking|Analyzing|Listing|Gathering)\b/i.test(
      firstLine,
    ) ||
    /^• I(?:'|’)m (checking|listing|searching|looking|inspecting|reading|running|analyzing)\b/i.test(
      firstLine,
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
  return Boolean(trimmed) && /^[#$]\s+\S/.test(trimmed);
}

function looksLikeOperationalTraceLine(line: string) {
  const trimmed = line.trim();
  return Boolean(trimmed) && /^(Ran|Run|Running|Explored|Exploring|Searched|Searching|Reading|Inspecting|Checking|Calling|Using|Listing|Gathering)\b/i.test(
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

  return /^_[^_]+_$/.test(line) || /^`[^`]+`$/.test(line) || looksLikePathLikeLine(line);
}

function isShortAtomicAnswerBlock(block: string) {
  const lines = splitNormalizedLines(block).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) {
    return false;
  }

  const [line] = lines;
  if (!line) {
    return false;
  }

  if (
    /^[-*•◦·✽✶⏺]\s/.test(line) ||
    /^\d+\.\s/.test(line) ||
    line.startsWith("#") ||
    looksLikePathLikeLine(line) ||
    /^[#$]\s+\S/.test(line)
  ) {
    return false;
  }

  return line.length <= 24;
}

export function extractFinalAnswer(raw: string) {
  const rawLines = splitNormalizedLines(raw);
  const isCodex = looksLikeCodexSnapshot(rawLines);
  const isClaude = looksLikeClaudeSnapshot(rawLines);
  const isGemini = looksLikeGeminiSnapshot(rawLines);
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
    while (startIndex < blocks.length - 1 && isResidualToolOutputBlock(blocks[startIndex] ?? "")) {
      startIndex += 1;
    }
  } else {
    while (startIndex < blocks.length - 1 && isProgressBlock(blocks[startIndex] ?? "")) {
      startIndex += 1;
    }
  }

  const answerBlocks = blocks.slice(startIndex);
  if (answerBlocks.length > 1 && answerBlocks.every(isShortAtomicAnswerBlock)) {
    const lastAnswer = answerBlocks.at(-1)?.trim() ?? "";
    if (lastAnswer) {
      return isCodex || isClaude || isGemini
        ? stripSingleLineAssistantEnvelope(lastAnswer)
        : lastAnswer;
    }
  }

  const answer = answerBlocks.join("\n\n").trim();
  const extracted = answer || cleaned;
  if (isCodex || isClaude || isGemini) {
    return stripSingleLineAssistantEnvelope(extracted);
  }

  return extracted;
}
