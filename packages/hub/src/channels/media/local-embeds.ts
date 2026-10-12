// Local-file Markdown in channel-bound text. An Agent that made an image writes
// `![Chart](file:///home/me/artifacts/chart.png)` because its own app renders it;
// a channel receives the raw Markdown and the user can open none of it. Files
// leave through the `message` tool's media params (docs/features/channels/README.md,
// "Outbound files"), never through a text parse, so this module never reads or
// uploads anything: it only rewrites what the text would show.
//
// - An embed or `file:` link whose file the `message` tool already delivered is
//   removed: the image is in the conversation, the Markdown would be noise.
// - Any other local embed or `file:` link becomes a short notice naming the file,
//   so the answer around it survives and nobody is told an image was sent. An
//   embed cut off before its `)` (an interrupted turn) counts as one.
// - `http(s)` images, plain paths written as text, fenced and indented code,
//   inline code and quoted lines stay as written.
// - A streamed draft holds back an embed that has not closed yet, so a split
//   `![Chart](file:///ho` never flashes on screen.
//
// Destinations are read the CommonMark way (balanced parentheses, `<…>`, an
// optional title), so `chart(1).png` keeps its name.

import { paragraphCodeSpans, type LineRange } from "./code-spans.js";

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_DRIVE = /^[a-z]:[\\/]/i;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

export interface LocalEmbedOptions {
  /** Files the `message` tool delivered this turn, as `localMediaKey`s. */
  delivered?: ReadonlySet<string> | undefined;
  /** A streamed draft: hold back an embed that has not closed yet. */
  partial?: boolean | undefined;
}

/**
 * The comparable form of a local file reference: `file:` URLs decoded to their
 * path, other paths as written. `null` for a remote URL (`https:`, `data:`, …).
 */
export function localMediaKey(target: string): string | null {
  const trimmed = target.trim().replace(/^<|>$/g, "");
  if (trimmed === "") return null;
  if (/^file:/i.test(trimmed)) {
    const path = trimmed.replace(/^file:(\/\/[^/]*)?/i, "");
    try {
      return decodeURI(path);
    } catch {
      return path;
    }
  }
  if (URL_SCHEME.test(trimmed) && !WINDOWS_DRIVE.test(trimmed)) return null;
  return trimmed;
}

function fileName(key: string): string {
  const parts = key.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? key;
}

/** One `[label](destination)` read from `line` at `start` (the `[`). */
type ParsedLink =
  | { kind: "closed"; label: string; target: string; end: number }
  | { kind: "open"; label: string; target: string };

function readLabel(line: string, start: number): { label: string; next: number } | null {
  for (let index = start + 1; index < line.length; index += 1) {
    if (line[index] === "\\") index += 1;
    else if (line[index] === "]") return { label: line.slice(start + 1, index), next: index + 1 };
  }
  return null;
}

/** The destination after `(`: `<…>`, or a run with balanced parentheses. */
function readTarget(line: string, from: number): { target: string; next: number; open: boolean } {
  if (line[from] === "<") {
    const close = line.indexOf(">", from);
    if (close < 0) return { target: line.slice(from + 1), next: line.length, open: true };
    return { target: line.slice(from + 1, close), next: close + 1, open: false };
  }
  let depth = 0;
  let index = from;
  for (; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === "\\") index += 1;
    else if (char === "(") depth += 1;
    else if (char === ")" && depth === 0) break;
    else if (char === ")") depth -= 1;
    else if (/\s/.test(char)) break;
  }
  return { target: line.slice(from, index), next: index, open: index >= line.length };
}

/** Skips an optional `"title"`, `'title'` or `(title)` and spaces; -1 when it never closes. */
function skipTitle(line: string, from: number): number {
  let index = from;
  while (line[index] === " " || line[index] === "\t") index += 1;
  const opener = line[index];
  const closer = opener === "(" ? ")" : opener;
  if (opener !== '"' && opener !== "'" && opener !== "(") return index;
  const close = line.indexOf(closer!, index + 1);
  if (close < 0) return -1;
  index = close + 1;
  while (line[index] === " " || line[index] === "\t") index += 1;
  return index;
}

function parseLink(line: string, start: number): ParsedLink | null {
  const label = readLabel(line, start);
  if (label === null) return null;
  if (line[label.next] !== "(") return null;
  let from = label.next + 1;
  while (line[from] === " ") from += 1;
  const destination = readTarget(line, from);
  if (destination.open) return { kind: "open", label: label.label, target: destination.target };
  const after = skipTitle(line, destination.next);
  if (after < 0) return { kind: "open", label: label.label, target: destination.target };
  if (after >= line.length) return { kind: "open", label: label.label, target: destination.target };
  if (line[after] !== ")") return null;
  return { kind: "closed", label: label.label, target: destination.target, end: after + 1 };
}

interface RewriteContext {
  delivered: ReadonlySet<string>;
  /** The line may still grow: an unclosed local link is held back, not rewritten. */
  growing: boolean;
}

/**
 * An image the channel certainly cannot show: a `file:` URL or an absolute
 * path. A relative target is left as written; it is not what the report showed
 * and may be meant as text.
 */
function localImageKey(target: string): string | null {
  const key = localMediaKey(target);
  if (key === null) return null;
  const absolute = key.startsWith("/") || key.startsWith("~/") || WINDOWS_DRIVE.test(key);
  return absolute ? key : null;
}

function imageReplacement(target: string, delivered: ReadonlySet<string>): string | null {
  const key = localImageKey(target);
  if (key === null) return null;
  if (delivered.has(key)) return "";
  return `[Image not attached: ${fileName(key)}]`;
}

function fileLinkReplacement(label: string, target: string, delivered: ReadonlySet<string>) {
  const key = localMediaKey(target) ?? target;
  const name = fileName(key);
  if (delivered.has(key)) return label;
  if (label === "" || label === name || label === key || label === target)
    return `[File not attached: ${name}]`;
  return `${label} [file not attached: ${name}]`;
}

const FILE_PREFIX = "file:";

/** A target being typed that is, or may still become, a `file:` URL. */
function mayBeFileTarget(target: string): boolean {
  const lower = target.replace(/^</, "").toLowerCase();
  return lower.startsWith(FILE_PREFIX) || (lower !== "" && FILE_PREFIX.startsWith(lower));
}

/** An image target being typed that may still be a local one; never a remote one. */
function mayBeLocalImage(target: string): boolean {
  const bare = target.replace(/^</, "");
  return bare === "" || /^[/~]/.test(bare) || WINDOWS_DRIVE.test(bare) || mayBeFileTarget(bare);
}

/**
 * The rewrite of one link at `start`: `[text, nextIndex]`, `"hold"` to cut the
 * line there (a draft's unclosed local link), or `null` to leave it.
 */
function rewriteAt(
  prose: string,
  start: number,
  image: boolean,
  context: RewriteContext,
): [string, number] | "hold" | null {
  const link = parseLink(prose, start + (image ? 1 : 0));
  if (link === null) {
    // `![alt` or `[label](` still being typed at the end of a draft.
    if (!context.growing) return null;
    const tail = prose.slice(start);
    if (image && !/\]/.test(tail)) return "hold";
    if (tail.endsWith("](")) return "hold";
    return null;
  }
  const local = image ? localImageKey(link.target) !== null : /^<?file:/i.test(link.target);
  if (link.kind === "open") {
    const pending = image ? mayBeLocalImage(link.target) : mayBeFileTarget(link.target);
    if (context.growing && pending) return "hold";
    if (!local) return null;
  }
  if (!local) return null;
  const end = link.kind === "closed" ? link.end : prose.length;
  const text = image
    ? (imageReplacement(link.target, context.delivered) ?? prose.slice(start, end))
    : fileLinkReplacement(link.label, link.target, context.delivered);
  return [text, end];
}

/** Rewrites the links of prose with no code in it. */
function rewriteProse(prose: string, context: RewriteContext): string {
  let out = "";
  let index = 0;
  while (index < prose.length) {
    const char = prose[index];
    const image = char === "!" && prose[index + 1] === "[";
    if (!image && char !== "[") {
      out += char;
      index += 1;
      continue;
    }
    const result = rewriteAt(prose, index, image, context);
    if (result === "hold") return out;
    if (result === null) {
      out += char;
      index += 1;
      continue;
    }
    out += result[0];
    index = result[1];
  }
  return out;
}

/** Rewrites one prose line outside its code-span `ranges` (sorted, disjoint). */
function rewriteLine(line: string, ranges: readonly LineRange[], context: RewriteContext): string {
  let out = "";
  let cursor = 0;
  for (const [start, end] of ranges) {
    out += rewriteProse(line.slice(cursor, start), { ...context, growing: false });
    out += line.slice(start, end);
    cursor = end;
  }
  // Only prose that reaches the end of the line can still grow.
  return out + rewriteProse(line.slice(cursor), context);
}

/** Line kinds Markdown shows literally: fenced and indented code. */
function codeLines(lines: readonly string[]): boolean[] {
  const literal: boolean[] = [];
  let fence: { char: string; length: number } | null = null;
  let previousBlank = true;
  let inIndented = false;
  for (const line of lines) {
    const blank = line.trim() === "";
    if (fence !== null) {
      literal.push(true);
      const close = FENCE_OPEN.exec(line);
      const run = close?.[1];
      if (run && run[0] === fence.char && run.length >= fence.length && line.trim() === run)
        fence = null;
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open !== null) {
      fence = { char: open[1]![0]!, length: open[1]!.length };
      literal.push(true);
      inIndented = false;
      previousBlank = false;
      continue;
    }
    // Indented code cannot interrupt a paragraph: it starts after a blank line.
    const indented = /^( {4}|\t)/.test(line);
    inIndented = !blank && indented && (inIndented || previousBlank) ? true : blank && inIndented;
    literal.push(inIndented && !blank);
    previousBlank = blank;
  }
  return literal;
}

/** Rewrites local-file Markdown in channel-bound text; see the file comment. */
export function rewriteLocalEmbeds(text: string, options: LocalEmbedOptions = {}): string {
  const delivered = options.delivered ?? new Set<string>();
  const lines = text.split("\n");
  // Code and quoted lines are examples, never something the Agent meant to show.
  const literal = codeLines(lines).map((code, index) => code || /^\s*>/.test(lines[index]!));
  const spans = codeSpansByLine(lines, literal, options.partial === true);
  const out: string[] = [];
  lines.forEach((line, index) => {
    if (literal[index]) {
      out.push(line);
      return;
    }
    const growing = options.partial === true && index === lines.length - 1;
    const rewritten = rewriteLine(line, spans[index]!, { delivered, growing });
    // A line that only held a delivered image goes, rather than leaving a gap.
    if (rewritten.trim() === "" && line.trim() !== "") return;
    out.push(rewritten);
  });
  const result = out.join("\n");
  return result === text ? text : result.replace(/\n{3,}/g, "\n\n").trimEnd();
}

/**
 * Code-span ranges per line. A span can cross lines inside a paragraph, which
 * ends at a blank or literal line; a draft's last paragraph may hold an open one.
 */
function codeSpansByLine(
  lines: readonly string[],
  literal: readonly boolean[],
  partial: boolean,
): LineRange[][] {
  const spans: LineRange[][] = lines.map(() => []);
  let start = 0;
  while (start < lines.length) {
    if (literal[start] || lines[start]!.trim() === "") {
      start += 1;
      continue;
    }
    let end = start;
    while (end < lines.length && !literal[end] && lines[end]!.trim() !== "") end += 1;
    const paragraph = paragraphCodeSpans(lines.slice(start, end), partial && end === lines.length);
    paragraph.forEach((ranges, offset) => {
      spans[start + offset] = ranges;
    });
    start = end;
  }
  return spans;
}

const SEND_MEDIA_KEYS = ["media", "mediaUrl", "path", "filePath", "fileUrl", "image"] as const;
const ATTACHMENT_MEDIA_KEYS = ["media", "mediaUrl", "path", "filePath", "url"] as const;

function stringsAt(source: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.flatMap((key) => {
    const value = source[key];
    return typeof value === "string" && value.trim() !== "" ? [value] : [];
  });
}

/** The local files a `message` `send` carries, as `localMediaKey`s. */
export function sendMediaKeys(args: Record<string, unknown>): string[] {
  const sources = [...stringsAt(args, SEND_MEDIA_KEYS)];
  const urls = args["mediaUrls"];
  if (Array.isArray(urls)) sources.push(...urls.filter((url) => typeof url === "string"));
  const attachments = args["attachments"];
  if (Array.isArray(attachments)) {
    for (const attachment of attachments) {
      if (typeof attachment === "string") sources.push(attachment);
      else if (attachment !== null && typeof attachment === "object")
        sources.push(...stringsAt(attachment as Record<string, unknown>, ATTACHMENT_MEDIA_KEYS));
    }
  }
  return sources.flatMap((source) => {
    const key = localMediaKey(source);
    return key === null ? [] : [key];
  });
}
