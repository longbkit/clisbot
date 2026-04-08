export const SLACK_SOFT_TEXT_LIMIT = 3000;
export const SLACK_RETRY_TEXT_LIMIT = 2000;

export function getSlackSafeMaxChars(configuredMaxChars: number) {
  return Math.min(configuredMaxChars, SLACK_SOFT_TEXT_LIMIT);
}

export function clampSlackText(text: string, maxChars = SLACK_SOFT_TEXT_LIMIT) {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, maxChars - 4))}\n...`;
}

function splitLongLine(line: string, maxChars: number) {
  if (line.length <= maxChars) {
    return [line];
  }

  const chunks: string[] = [];
  let remaining = line;

  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars);
    const splitAt = Math.max(window.lastIndexOf(" "), window.lastIndexOf("\t"));
    const boundary = splitAt > Math.floor(maxChars * 0.5) ? splitAt : maxChars;
    chunks.push(remaining.slice(0, boundary).trimEnd());
    remaining = remaining.slice(boundary).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function splitPlainTextBlock(block: string, maxChars: number): string[] {
  const trimmed = block.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.length <= maxChars) {
    return [trimmed];
  }

  const paragraphs = trimmed.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    const next = current.trim();
    if (next) {
      chunks.push(next);
    }
    current = "";
  };

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      pushCurrent();
    }

    if (paragraph.length <= maxChars) {
      current = paragraph;
      continue;
    }

    const lines = paragraph.split("\n");
    let lineChunk = "";
    for (const line of lines) {
      const lineVariants = splitLongLine(line, maxChars);
      for (const lineVariant of lineVariants) {
        const lineCandidate = lineChunk ? `${lineChunk}\n${lineVariant}` : lineVariant;
        if (lineCandidate.length <= maxChars) {
          lineChunk = lineCandidate;
          continue;
        }

        if (lineChunk) {
          chunks.push(lineChunk);
        }
        lineChunk = lineVariant;
      }
    }

    if (lineChunk) {
      chunks.push(lineChunk);
    }
  }

  pushCurrent();
  return chunks;
}

function splitFencedCodeBlock(block: string, maxChars: number): string[] {
  const trimmed = block.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.length <= maxChars) {
    return [trimmed];
  }

  const lines = trimmed.split("\n");
  const openingFence = lines[0] ?? "```";
  const closingFence = lines.at(-1) === "```" ? "```" : "";
  const contentLines = closingFence ? lines.slice(1, -1) : lines.slice(1);
  const framingLength =
    openingFence.length + (closingFence ? closingFence.length : 0) + (closingFence ? 2 : 1);
  const contentLimit = Math.max(32, maxChars - framingLength);
  const contentChunks = splitPlainTextBlock(contentLines.join("\n"), contentLimit);

  if (contentChunks.length === 0) {
    return [trimmed];
  }

  return contentChunks.map((content) =>
    closingFence ? `${openingFence}\n${content}\n${closingFence}` : `${openingFence}\n${content}`,
  );
}

function splitSlackBlock(block: string, maxChars: number): string[] {
  const trimmed = block.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("```")) {
    return splitFencedCodeBlock(trimmed, maxChars);
  }

  return splitPlainTextBlock(trimmed, maxChars);
}

export function splitSlackText(text: string, maxChars = SLACK_SOFT_TEXT_LIMIT) {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.length <= maxChars) {
    return [trimmed];
  }

  const blocks = trimmed.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    const next = current.trim();
    if (next) {
      chunks.push(next);
    }
    current = "";
  };

  for (const block of blocks) {
    const blockChunks = splitSlackBlock(block, maxChars);
    for (const blockChunk of blockChunks) {
      const candidate = current ? `${current}\n\n${blockChunk}` : blockChunk;
      if (candidate.length <= maxChars) {
        current = candidate;
        continue;
      }

      if (current) {
        pushCurrent();
      }

      if (blockChunk.length <= maxChars) {
        current = blockChunk;
        continue;
      }

      chunks.push(clampSlackText(blockChunk, maxChars));
    }
  }

  pushCurrent();
  return chunks;
}

export function isSlackMsgTooLongError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    data?: {
      error?: unknown;
    };
  };

  return candidate.data?.error === "msg_too_long";
}
