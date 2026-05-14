import type { MessageInputFormat, MessageRenderMode } from "../message/message-command.ts";

export type SlackBlock = Record<string, unknown>;
type SlackTableCell = Record<string, unknown>;

const SLACK_MAX_BLOCKS = 50;

function normalizeMarkdownLinks(text: string) {
  return text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
    const trimmedHref = href.trim();
    if (!trimmedHref) {
      return label;
    }
    return `<${trimmedHref}|${label}>`;
  });
}

function renderInlineMarkdownToSlackMrkdwn(text: string) {
  return normalizeMarkdownLinks(text)
    .replace(/~~([^~]+)~~/g, "~$1~")
    .replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, "*$1*");
}

function stripMarkdownInline(text: string) {
  return text
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1")
    .replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, "$1")
    .replace(/\*([^*\n][\s\S]*?[^*\n])\*/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .trim();
}

function normalizeSlackHeaderText(text: string) {
  const normalized = stripMarkdownInline(text);
  if (!normalized) {
    return "Untitled";
  }
  return normalized.slice(0, 150);
}

function buildSlackBlocksFallbackText(blocks: SlackBlock[]): string {
  for (const block of blocks) {
    if (typeof block !== "object" || !block) {
      continue;
    }
    const text = (block as { text?: { text?: string } }).text?.text;
    if (typeof text === "string" && text.trim()) {
      return stripMarkdownInline(text).replace(/\s+/g, " ").trim();
    }
    const elements = (block as { elements?: Array<{ text?: string }> }).elements;
    if (!Array.isArray(elements)) {
      continue;
    }
    for (const element of elements) {
      if (typeof element?.text === "string" && element.text.trim()) {
        return stripMarkdownInline(element.text).replace(/\s+/g, " ").trim();
      }
    }
    const rows = (block as { rows?: unknown[] }).rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      continue;
    }
    const firstRow = rows[0];
    if (!Array.isArray(firstRow)) {
      continue;
    }
    const rowText = firstRow
      .map((cell) => {
        if (!cell || typeof cell !== "object") {
          return "";
        }
        const rawText = (cell as { text?: string }).text;
        return typeof rawText === "string" ? stripMarkdownInline(rawText) : "";
      })
      .filter(Boolean)
      .join(" | ")
      .trim();
    if (rowText) {
      return rowText;
    }
  }
  return "Shared a Block Kit message";
}

function validateSlackBlocksArray(raw: unknown): SlackBlock[] {
  if (!Array.isArray(raw)) {
    throw new Error("Slack blocks input must be a JSON array");
  }
  if (raw.length === 0) {
    throw new Error("Slack blocks input cannot be empty");
  }
  if (raw.length > SLACK_MAX_BLOCKS) {
    throw new Error(`Slack blocks cannot exceed ${SLACK_MAX_BLOCKS} items`);
  }
  for (const block of raw) {
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      throw new Error("Each Slack block must be an object");
    }
    const type = (block as { type?: unknown }).type;
    if (typeof type !== "string" || !type.trim()) {
      throw new Error("Each Slack block must include a non-empty string type");
    }
  }
  return raw as SlackBlock[];
}

function parseSlackBlocksInput(text: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Slack blocks input must be valid JSON");
  }
  return validateSlackBlocksArray(parsed);
}

function renderMarkdownToSlackMrkdwn(markdown: string) {
  const normalized = markdown.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
  if (!normalized) {
    return "";
  }

  return normalized
    .split("\n")
    .map((line) => {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1]?.length ?? 1;
        const content = renderInlineMarkdownToSlackMrkdwn(headingMatch[2] ?? "");
        if (level <= 3) {
          return `*${content}*`;
        }
        return content;
      }

      const bulletMatch = line.match(/^\s*[-*+]\s+(.+)$/);
      if (bulletMatch) {
        return `• ${renderInlineMarkdownToSlackMrkdwn(bulletMatch[1] ?? "")}`;
      }

      const orderedMatch = line.match(/^\s*(\d+)\.\s+(.+)$/);
      if (orderedMatch) {
        return `${orderedMatch[1]}. ${renderInlineMarkdownToSlackMrkdwn(orderedMatch[2] ?? "")}`;
      }

      return renderInlineMarkdownToSlackMrkdwn(line);
    })
    .join("\n");
}

function splitMarkdownTableCells(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line: string) {
  const cells = splitMarkdownTableCells(line);
  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell))
  );
}

function isMarkdownTableLine(line: string) {
  const trimmed = line.trim();
  return trimmed.includes("|") && splitMarkdownTableCells(trimmed).length >= 2;
}

function renderSlackTableRow(headers: string[], row: string[]) {
  if (headers.length === 2 && row.length >= 2) {
    return `*${renderInlineMarkdownToSlackMrkdwn(row[0] ?? "")}*: ${renderInlineMarkdownToSlackMrkdwn(row[1] ?? "")}`;
  }

  return headers
    .map((header, index) => {
      const value = row[index] ?? "";
      return `*${renderInlineMarkdownToSlackMrkdwn(header)}:* ${renderInlineMarkdownToSlackMrkdwn(value)}`;
    })
    .join(" • ");
}

function normalizeSlackTableCellText(text: string) {
  return stripMarkdownInline(text).slice(0, 3000);
}

function buildSlackTableCell(text: string): SlackTableCell {
  return {
    type: "raw_text",
    text: normalizeSlackTableCellText(text),
  };
}

function renderMarkdownTableToNativeSlackBlock(headers: string[], rows: string[][]): SlackBlock | null {
  if (headers.length === 0 || rows.length === 0) {
    return null;
  }

  return {
    type: "table",
    column_settings: headers.map((_header, index) => ({
      is_wrapped: index === 0,
    })),
    rows: [headers, ...rows].map((row) => row.map((cell) => buildSlackTableCell(cell))),
  };
}

function renderMarkdownTableToFallbackSlackBlock(headers: string[], rows: string[][]): SlackBlock | null {
  if (headers.length === 0 || rows.length === 0) {
    return null;
  }

  const text = rows
    .map((row) => renderSlackTableRow(headers, row))
    .filter(Boolean)
    .join("\n");
  if (!text.trim()) {
    return null;
  }

  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text,
    },
  };
}

function renderMarkdownToSlackBlocks(markdown: string) {
  const normalized = markdown.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
  if (!normalized) {
    return [];
  }

  const blocks: SlackBlock[] = [];
  const lines = normalized.split("\n");
  const firstHeadingLineIndex = lines.findIndex((line) => /^(#{1,6})\s+.+$/.test(line));
  const paragraph: string[] = [];
  const codeLines: string[] = [];
  let inCodeFence = false;
  let hasVisibleContent = false;
  let hasSeenHeading = false;
  let majorHeadingCount = 0;
  let hasNativeTableBlock = false;

  const pushBlock = (block: SlackBlock) => {
    blocks.push(block);
    hasVisibleContent = true;
  };

  const pushDividerIfNeeded = () => {
    if (!hasVisibleContent) {
      return;
    }
    const lastBlock = blocks[blocks.length - 1];
    if ((lastBlock as { type?: string } | undefined)?.type === "divider") {
      return;
    }
    blocks.push({ type: "divider" });
  };

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    const text = paragraph.join("\n").trim();
    if (text) {
      const shouldRenderAsPreamble =
        !hasSeenHeading && firstHeadingLineIndex > 0 && blocks.length === 0;
      pushBlock({
        ...(shouldRenderAsPreamble
          ? {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text,
                },
              ],
            }
          : {
              type: "section",
              text: {
                type: "mrkdwn",
                text,
              },
            }),
      });
    }
    paragraph.length = 0;
  };

  const flushCodeFence = () => {
    if (codeLines.length === 0) {
      return;
    }
    pushBlock({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `\`\`\`\n${codeLines.join("\n")}\n\`\`\``,
      },
    });
    codeLines.length = 0;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const fenceMatch = line.match(/^```([^\n`]*)$/);
    if (fenceMatch) {
      if (inCodeFence) {
        flushCodeFence();
        inCodeFence = false;
      } else {
        flushParagraph();
        inCodeFence = true;
      }
      continue;
    }

    if (inCodeFence) {
      codeLines.push(line);
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      continue;
    }

    const nextLine = lines[lineIndex + 1] ?? "";
    if (isMarkdownTableLine(line) && isMarkdownTableSeparator(nextLine)) {
      flushParagraph();
      const headers = splitMarkdownTableCells(line);
      const rows: string[][] = [];
      lineIndex += 2;
      while (lineIndex < lines.length) {
        const tableLine = lines[lineIndex] ?? "";
        if (!tableLine.trim() || !isMarkdownTableLine(tableLine)) {
          lineIndex -= 1;
          break;
        }
        rows.push(splitMarkdownTableCells(tableLine));
        lineIndex += 1;
      }
      const tableBlock = !hasNativeTableBlock
        ? renderMarkdownTableToNativeSlackBlock(headers, rows)
        : renderMarkdownTableToFallbackSlackBlock(headers, rows);
      if (tableBlock) {
        pushBlock(tableBlock);
        if ((tableBlock as { type?: string }).type === "table") {
          hasNativeTableBlock = true;
        }
      }
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      hasSeenHeading = true;
      const level = headingMatch[1]?.length ?? 1;
      const content = headingMatch[2] ?? "";
      if (level <= 2) {
        if (majorHeadingCount > 0) {
          pushDividerIfNeeded();
        }
        pushBlock({
          type: "header",
          text: {
            type: "plain_text",
            text: normalizeSlackHeaderText(content),
          },
        });
        majorHeadingCount += 1;
      } else if (level === 3) {
        pushBlock({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${renderInlineMarkdownToSlackMrkdwn(content)}*`,
          },
        });
      } else {
        paragraph.push(`*${renderInlineMarkdownToSlackMrkdwn(content)}*`);
      }
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bulletMatch) {
      paragraph.push(`• ${renderInlineMarkdownToSlackMrkdwn(bulletMatch[1] ?? "")}`);
      continue;
    }

    const orderedMatch = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      paragraph.push(
        `${orderedMatch[1]}. ${renderInlineMarkdownToSlackMrkdwn(orderedMatch[2] ?? "")}`,
      );
      continue;
    }

    paragraph.push(renderInlineMarkdownToSlackMrkdwn(line));
  }

  if (inCodeFence) {
    flushCodeFence();
  }
  flushParagraph();
  return blocks;
}

export type SlackResolvedMessageContent = {
  text: string;
  blocks?: SlackBlock[];
  apiText?: string;
};

export function resolveSlackMessageContent(params: {
  text: string;
  inputFormat: MessageInputFormat;
  renderMode: MessageRenderMode;
}): SlackResolvedMessageContent {
  const { text, inputFormat, renderMode } = params;

  if (inputFormat === "blocks") {
    if (renderMode !== "none" && renderMode !== "blocks") {
      throw new Error("Slack blocks input supports only --render none or --render blocks");
    }
    const blocks = parseSlackBlocksInput(text);
    const fallbackText = buildSlackBlocksFallbackText(blocks);
    return {
      text: fallbackText,
      blocks,
      apiText: fallbackText,
    };
  }

  if (inputFormat === "html") {
    throw new Error("Slack does not support HTML input; use --input md, mrkdwn, plain, or blocks");
  }

  if (renderMode === "blocks") {
    const blocks = renderMarkdownToSlackBlocks(text);
    const fallbackText = buildSlackBlocksFallbackText(blocks);
    return {
      text: fallbackText,
      blocks,
      apiText: fallbackText,
    };
  }

  if (renderMode === "html") {
    throw new Error("Slack does not support --render html");
  }

  if (inputFormat === "mrkdwn" || renderMode === "mrkdwn") {
    return { text };
  }

  if (inputFormat === "md" || renderMode === "native") {
    return {
      text: renderMarkdownToSlackMrkdwn(text),
    };
  }

  return { text };
}
