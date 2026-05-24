import { TextStyle, type Style } from "zca-js";

type InlineStyle = TextStyle;

type LineStyle = {
  lineIndex: number;
  style: InlineStyle;
  indentSize?: number;
};

type Segment = {
  text: string;
  styles: InlineStyle[];
};

type InlineMarker = {
  pattern: RegExp;
  extractText: (match: RegExpExecArray) => string;
  resolveStyles?: (match: RegExpExecArray) => InlineStyle[];
  literal?: boolean;
};

type ResolvedInlineMatch = {
  match: RegExpExecArray;
  marker: InlineMarker;
  styles: InlineStyle[];
  text: string;
  priority: number;
};

type FenceMarker = {
  char: "`" | "~";
  length: number;
  indent: number;
};

type ActiveFence = FenceMarker & {
  quoteIndent: number;
};

const ESCAPE_SENTINEL_START = "\u0001";
const ESCAPE_SENTINEL_END = "\u0002";

const TAG_STYLE_MAP: Record<string, InlineStyle | null> = {
  red: TextStyle.Red,
  orange: TextStyle.Orange,
  yellow: TextStyle.Yellow,
  green: TextStyle.Green,
  small: TextStyle.Small,
  big: TextStyle.Big,
  underline: TextStyle.Underline,
};

const INLINE_MARKERS: InlineMarker[] = [
  {
    pattern: /`([^`\n]+)`/g,
    extractText: (match) => match[0],
    literal: true,
  },
  {
    pattern: /\\([*_~#\\{}>+\-`])/g,
    extractText: (match) => match[1],
    literal: true,
  },
  {
    pattern: new RegExp(`\\{(${Object.keys(TAG_STYLE_MAP).join("|")})\\}(.+?)\\{/\\1\\}`, "g"),
    extractText: (match) => match[2],
    resolveStyles: (match) => {
      const style = TAG_STYLE_MAP[match[1]];
      return style ? [style] : [];
    },
  },
  {
    pattern: /(?<!\*)\*\*\*(?=\S)([^\n]*?\S)(?<!\*)\*\*\*(?!\*)/g,
    extractText: (match) => match[1],
    resolveStyles: () => [TextStyle.Bold, TextStyle.Italic],
  },
  {
    pattern: /(?<!\*)\*\*(?![\s*])([^\n]*?\S)(?<!\*)\*\*(?!\*)/g,
    extractText: (match) => match[1],
    resolveStyles: () => [TextStyle.Bold],
  },
  {
    pattern: /(?<![\w_])__(?![\s_])([^\n]*?\S)(?<!_)__(?![\w_])/g,
    extractText: (match) => match[1],
    resolveStyles: () => [TextStyle.Bold],
  },
  {
    pattern: /(?<!~)~~(?=\S)([^\n]*?\S)(?<!~)~~(?!~)/g,
    extractText: (match) => match[1],
    resolveStyles: () => [TextStyle.StrikeThrough],
  },
  {
    pattern: /(?<!\*)\*(?![\s*])([^\n]*?\S)(?<!\*)\*(?!\*)/g,
    extractText: (match) => match[1],
    resolveStyles: () => [TextStyle.Italic],
  },
  {
    pattern: /(?<![\w_])_(?![\s_])([^\n]*?\S)(?<!_)_(?![\w_])/g,
    extractText: (match) => match[1],
    resolveStyles: () => [TextStyle.Italic],
  },
];

export function renderZaloPersonalMarkdown(input: string): { text: string; styles: Style[] } {
  const styles: Style[] = [];
  const escapeMap: string[] = [];
  const lineStyles: LineStyle[] = [];
  const processedLines: string[] = [];
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  let activeFence: ActiveFence | null = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex]!;
    const { text: unquotedLine, indent: quoteIndent } = stripQuotePrefix(rawLine);
    const outputLineIndex = processedLines.length;

    if (activeFence) {
      const codeLine = activeFence.quoteIndent > 0
        ? stripQuotePrefix(rawLine, activeFence.quoteIndent).text
        : rawLine;
      if (isClosingFence(codeLine, activeFence)) {
        activeFence = null;
        continue;
      }
      processedLines.push(escapeLiteralText(normalizeCodeBlockLeadingWhitespace(stripCodeFenceIndent(codeLine, activeFence.indent)), escapeMap));
      continue;
    }

    const openingFence = resolveOpeningFence(rawLine);
    if (openingFence) {
      if (!hasClosingFence(lines, lineIndex + 1, openingFence)) {
        processedLines.push(escapeLiteralText(openingFence.quoteIndent > 0 ? unquotedLine : rawLine, escapeMap));
        for (let fenceLineIndex = lineIndex + 1; fenceLineIndex < lines.length; fenceLineIndex += 1) {
          processedLines.push(escapeLiteralText(lines[fenceLineIndex]!, escapeMap));
        }
        break;
      }
      activeFence = openingFence;
      continue;
    }

    if (isIndentedCodeBlockLine(unquotedLine)) {
      if (quoteIndent > 0) {
        lineStyles.push({ lineIndex: outputLineIndex, style: TextStyle.Indent, indentSize: quoteIndent });
      }
      processedLines.push(escapeLiteralText(normalizeCodeBlockLeadingWhitespace(unquotedLine), escapeMap));
      continue;
    }

    processMarkdownLine(unquotedLine, quoteIndent, outputLineIndex, processedLines, lineStyles);
  }

  const segments = parseInlineSegments(processedLines.join("\n"));
  let text = "";
  for (const segment of segments) {
    const start = text.length;
    text += segment.text;
    for (const style of segment.styles) {
      styles.push({ start, len: segment.text.length, st: style } as Style);
    }
  }

  const unescaped = restoreEscapes(text, styles, escapeMap);
  text = unescaped.text;
  const finalLines = text.split("\n");
  let offset = 0;
  for (let lineIndex = 0; lineIndex < finalLines.length; lineIndex += 1) {
    const lineLength = finalLines[lineIndex]!.length;
    if (lineLength > 0) {
      pushLineStyles(styles, lineStyles, lineIndex, offset, lineLength);
    }
    offset += lineLength + 1;
  }
  return { text, styles };
}

function processMarkdownLine(
  line: string,
  quoteIndent: number,
  outputLineIndex: number,
  processedLines: string[],
  lineStyles: LineStyle[],
) {
  const { text: markdownLine, size: markdownPadding } = stripOptionalMarkdownPadding(line);
  const heading = markdownLine.match(/^(#{1,4})\s(.*)$/);
  if (heading) {
    lineStyles.push({ lineIndex: outputLineIndex, style: TextStyle.Bold });
    if (heading[1]!.length === 1) {
      lineStyles.push({ lineIndex: outputLineIndex, style: TextStyle.Big });
    }
    if (quoteIndent > 0) {
      lineStyles.push({ lineIndex: outputLineIndex, style: TextStyle.Indent, indentSize: quoteIndent });
    }
    processedLines.push(heading[2]!);
    return;
  }

  const indentMatch = markdownLine.match(/^(\s+)(.*)$/);
  const indentLevel = indentMatch ? clampIndent(indentMatch[1]!.length) : 0;
  const content = indentMatch ? indentMatch[2]! : markdownLine;
  const totalIndent = Math.min(5, quoteIndent + indentLevel);
  const ordered = content.match(/^(\d+)\.\s(.*)$/);
  const unordered = content.match(/^[-*+]\s(.*)$/);

  if (ordered || unordered) {
    if (totalIndent > 0) {
      lineStyles.push({ lineIndex: outputLineIndex, style: TextStyle.Indent, indentSize: totalIndent });
    }
    if (ordered) {
      processedLines.push(`${ordered[1]}. ${ordered[2]}`);
      return;
    }
    lineStyles.push({ lineIndex: outputLineIndex, style: TextStyle.UnorderedList });
    processedLines.push(unordered![1]!);
    return;
  }

  if (totalIndent > 0) {
    lineStyles.push({ lineIndex: outputLineIndex, style: TextStyle.Indent, indentSize: totalIndent });
    processedLines.push(content);
    return;
  }

  processedLines.push(markdownPadding > 0 ? line : markdownLine);
}

function parseInlineSegments(text: string, inheritedStyles: InlineStyle[] = []): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const next = findNextInlineMatch(text, cursor);
    if (!next) {
      pushSegment(segments, text.slice(cursor), inheritedStyles);
      break;
    }
    if ((next.match.index ?? 0) > cursor) {
      pushSegment(segments, text.slice(cursor, next.match.index), inheritedStyles);
    }
    const styles = [...inheritedStyles, ...next.styles];
    if (next.marker.literal) {
      pushSegment(segments, next.text, styles);
    } else {
      segments.push(...parseInlineSegments(next.text, styles));
    }
    cursor = (next.match.index ?? 0) + next.match[0].length;
  }
  return segments;
}

function findNextInlineMatch(text: string, startIndex: number): ResolvedInlineMatch | null {
  let best: ResolvedInlineMatch | null = null;
  for (const [priority, marker] of INLINE_MARKERS.entries()) {
    const regex = new RegExp(marker.pattern.source, marker.pattern.flags);
    regex.lastIndex = startIndex;
    const match = regex.exec(text);
    if (!match) continue;
    if (best && (match.index > (best.match.index ?? 0) || (match.index === best.match.index && priority > best.priority))) {
      continue;
    }
    best = { match, marker, text: marker.extractText(match), styles: marker.resolveStyles?.(match) ?? [], priority };
  }
  return best;
}

function restoreEscapes(text: string, styles: Style[], escapeMap: string[]) {
  if (escapeMap.length === 0) {
    return { text, styles };
  }
  const regex = new RegExp(`${ESCAPE_SENTINEL_START}(\\d+)${ESCAPE_SENTINEL_END}`, "g");
  const shifts: Array<{ pos: number; delta: number }> = [];
  let delta = 0;
  for (const match of text.matchAll(regex)) {
    const escapeIndex = Number.parseInt(match[1]!, 10);
    delta += match[0].length - escapeMap[escapeIndex]!.length;
    shifts.push({ pos: (match.index ?? 0) + match[0].length, delta });
  }
  for (const style of styles) adjustStyleForShifts(style, shifts);
  return {
    text: text.replace(regex, (_match, index) => escapeMap[Number.parseInt(index, 10)]!),
    styles,
  };
}

function adjustStyleForShifts(style: Style, shifts: Array<{ pos: number; delta: number }>) {
  let startDelta = 0;
  let endDelta = 0;
  const end = style.start + style.len;
  for (const shift of shifts) {
    if (shift.pos <= style.start) startDelta = shift.delta;
    if (shift.pos <= end) endDelta = shift.delta;
  }
  style.start -= startDelta;
  style.len -= endDelta - startDelta;
}

function pushLineStyles(styles: Style[], lineStyles: LineStyle[], lineIndex: number, offset: number, len: number) {
  for (const lineStyle of lineStyles) {
    if (lineStyle.lineIndex !== lineIndex) continue;
    if (lineStyle.style === TextStyle.Indent) {
      styles.push({ start: offset, len, st: TextStyle.Indent, indentSize: lineStyle.indentSize });
    } else {
      styles.push({ start: offset, len, st: lineStyle.style as Exclude<TextStyle, TextStyle.Indent> });
    }
  }
}

function pushSegment(segments: Segment[], text: string, styles: InlineStyle[]) {
  if (!text) return;
  const last = segments.at(-1);
  if (last && sameStyles(last.styles, styles)) {
    last.text += text;
    return;
  }
  segments.push({ text, styles: [...styles] });
}

function sameStyles(left: InlineStyle[], right: InlineStyle[]) {
  return left.length === right.length && left.every((style, index) => style === right[index]);
}

function escapeLiteralText(input: string, escapeMap: string[]) {
  return input.replace(/[\\*_~{}`]/g, (ch) => {
    const index = escapeMap.length;
    escapeMap.push(ch);
    return `${ESCAPE_SENTINEL_START}${index}${ESCAPE_SENTINEL_END}`;
  });
}

function stripQuotePrefix(line: string, maxDepth = Number.POSITIVE_INFINITY) {
  let cursor = 0;
  while (cursor < line.length && cursor < 3 && line[cursor] === " ") cursor += 1;
  let indent = 0;
  let consumed = cursor;
  while (indent < maxDepth && consumed < line.length && line[consumed] === ">") {
    indent += 1;
    consumed += 1;
    if (line[consumed] === " ") consumed += 1;
  }
  return indent === 0 ? { text: line, indent: 0 } : { text: line.slice(consumed), indent: Math.min(5, indent) };
}

function resolveOpeningFence(line: string): ActiveFence | null {
  const direct = parseFenceMarker(line);
  if (direct) return { ...direct, quoteIndent: 0 };
  const quoted = stripQuotePrefix(line);
  const quotedFence = quoted.indent > 0 ? parseFenceMarker(quoted.text) : null;
  return quotedFence ? { ...quotedFence, quoteIndent: quoted.indent } : null;
}

function hasClosingFence(lines: string[], startIndex: number, fence: ActiveFence) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = fence.quoteIndent > 0 ? stripQuotePrefix(lines[index]!, fence.quoteIndent).text : lines[index]!;
    if (isClosingFence(line, fence)) return true;
  }
  return false;
}

function parseFenceMarker(line: string): FenceMarker | null {
  const match = line.match(/^([ ]{0,3})(`{3,}|~{3,})(.*)$/);
  if (!match) return null;
  const marker = match[2]!;
  const char = marker[0];
  return char === "`" || char === "~" ? { char, length: marker.length, indent: match[1]!.length } : null;
}

function isClosingFence(line: string, fence: FenceMarker) {
  const match = line.match(/^([ ]{0,3})(`{3,}|~{3,})[ \t]*$/);
  return Boolean(match && match[2]![0] === fence.char && match[2]!.length >= fence.length);
}

function stripOptionalMarkdownPadding(line: string) {
  const match = line.match(/^( {1,3})(?=\S)/);
  return match ? { text: line.slice(match[1]!.length), size: match[1]!.length } : { text: line, size: 0 };
}

function normalizeCodeBlockLeadingWhitespace(line: string) {
  return line.replace(/^[ \t]+/, (leading) => leading.replace(/\t/g, "\u00A0\u00A0\u00A0\u00A0").replace(/ /g, "\u00A0"));
}

function isIndentedCodeBlockLine(line: string) {
  return /^(?: {4,}|\t)/.test(line);
}

function stripCodeFenceIndent(line: string, indent: number) {
  let cursor = 0;
  while (cursor < line.length && cursor < indent && line[cursor] === " ") cursor += 1;
  return line.slice(cursor);
}

function clampIndent(spaceCount: number) {
  return Math.min(5, Math.max(1, Math.floor(spaceCount / 2)));
}
