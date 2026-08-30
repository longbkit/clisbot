// COMPAT(clisbot-control-plane): Telegram channel format — markdown →
// Bot API HTML front-end (C5) — port of the openclaw-private telegram
// `format.ts` pipeline
// (`markdownToTelegramHtml` → `markdownToIR` → `renderTelegramMarkdownIR` →
// `renderSupportedTelegramHtml`). The markdown→IR walker follows
// `packages/markdown-core/src/ir.ts`'s token walk (markdown-it configured the
// same way: html off, linkify on, strikethrough on, tables off) narrowed to
// the style set the Bot API `parse_mode: HTML` supports; the marker renderer
// follows `markdown-core/src/render.ts`'s boundary/stack algorithm. The
// assistant-transcript-role-header and file-reference wrapping passes are
// omitted (the in-repo vertical has neither surface). Verified byte-for-byte
// against OpenClaw's `markdownToTelegramHtml` on the cases in
// `format.test.ts`.
//
// markdown-it is the same parser OpenClaw's `markdownToIR` is built on, so
// the front-end is a faithful port, not a hand-rolled markdown parser.

import MarkdownIt from "markdown-it";
import { escapeTelegramHtml } from "./format-html.js";
import { renderSupportedTelegramHtml } from "./format-sanitize.js";

type MarkdownStyle =
  | "bold"
  | "italic"
  | "strikethrough"
  | "code"
  | "code_block"
  | "spoiler"
  | "blockquote";

export interface MarkdownIR {
  text: string;
  styles: Array<{ start: number; end: number; style: MarkdownStyle; language?: string }>;
  links: Array<{ start: number; end: number; href: string }>;
}

/** Structural view of markdown-it's `Token` (the `export =` module does not
 * re-export the `Token` class by name). Non-optional where the real `Token`
 * is non-optional, so a real `Token` is assignable here. */
interface MarkdownToken {
  type: string;
  tag: string;
  content: string;
  info: string;
  children: MarkdownToken[] | null;
  attrs: [string, string][] | null;
  level: number;
  map: [number, number] | null;
  markup: string;
}

interface ListState {
  type: "bullet" | "ordered";
  index: number;
  openLevel: number;
}

interface LinkState {
  href: string;
  labelStart: number;
}

interface RenderState {
  text: string;
  styles: MarkdownIR["styles"];
  openStyles: Array<{ style: MarkdownStyle; start: number }>;
  links: MarkdownIR["links"];
  linkStack: LinkState[];
  listStack: ListState[];
  blockquoteStack: Array<{ start: number }>;
}

function createMarkdownIt(): MarkdownIt {
  const md = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false });
  md.enable("strikethrough");
  md.disable("table");
  return md;
}

function getAttr(token: MarkdownToken, name: string): string | null {
  if (token.attrs) {
    for (const [key, value] of token.attrs) {
      if (key === name) {
        return value;
      }
    }
  }
  return null;
}

function openStyle(state: RenderState, style: MarkdownStyle): void {
  state.openStyles.push({ style, start: state.text.length });
}

function closeStyle(
  state: RenderState,
  style: MarkdownStyle,
  options?: { trimTrailingParagraphSeparator?: boolean },
): void {
  for (let index = state.openStyles.length - 1; index >= 0; index -= 1) {
    const open = state.openStyles[index];
    if (open?.style !== style) {
      continue;
    }
    state.openStyles.splice(index, 1);
    const end =
      options?.trimTrailingParagraphSeparator && state.text.endsWith("\n\n")
        ? state.text.length - 2
        : state.text.length;
    if (end > open.start) {
      state.styles.push({ start: open.start, end, style });
    }
    return;
  }
}

function appendParagraphSeparator(state: RenderState, token?: MarkdownToken): void {
  // Inside a list item the paragraph is the item's own line — no blank line.
  if (state.listStack.length > 0) {
    const currentList = state.listStack[state.listStack.length - 1];
    const directListParagraphLevel = (currentList?.openLevel ?? 0) + 2;
    if (token?.type === "paragraph_close" && token.level === directListParagraphLevel) {
      return;
    }
    return;
  }
  state.text += "\n\n";
}

function resolveFenceLanguage(info: string | undefined): string | undefined {
  const language = info?.trim().split(/\s+/, 1)[0]?.trim();
  return language || undefined;
}

function handleLinkClose(state: RenderState): void {
  const link = state.linkStack.pop();
  if (link === undefined) {
    return;
  }
  const href = link.href.trim();
  if (href === "") {
    return;
  }
  state.links.push({ start: link.labelStart, end: state.text.length, href });
}

/** One markdown-it token walk → IR (text + style spans + link spans), the
 * `ir.ts` walker narrowed to the Bot API HTML style set. Trailing whitespace
 * is trimmed (the OpenClaw `markdownToIRWithMeta` tail step) except the tail
 * of a trailing code block, whose final newline is part of the block. */
export function markdownToTelegramIR(markdown: string): MarkdownIR {
  const state: RenderState = {
    text: "",
    styles: [],
    openStyles: [],
    links: [],
    linkStack: [],
    listStack: [],
    blockquoteStack: [],
  };
  const tokens = createMarkdownIt().parse(markdown ?? "", {});
  for (const token of tokens) {
    renderToken(token, state);
  }
  closeRemainingStyles(state);

  const trimmedLength = state.text.trimEnd().length;
  let codeBlockEnd = 0;
  for (const span of state.styles) {
    if (span.style !== "code_block") {
      continue;
    }
    if (span.end > codeBlockEnd) {
      codeBlockEnd = span.end;
    }
  }
  const finalLength = Math.max(trimmedLength, codeBlockEnd);
  const finalText =
    finalLength === state.text.length ? state.text : state.text.slice(0, finalLength);
  const styles = state.styles.filter((span) => span.end <= finalLength);
  return {
    text: finalText,
    styles,
    links: state.links.filter((link) => link.end <= finalLength),
  };
}

function closeRemainingStyles(state: RenderState): void {
  for (const open of state.openStyles.toReversed()) {
    if (state.text.length > open.start) {
      state.styles.push({ start: open.start, end: state.text.length, style: open.style });
    }
  }
  state.openStyles = [];
}

/** The inline emphasis pairs: `<style>_open` opens, `<style>_close` closes
 * (markdown-it token names → the Bot API HTML style set). */
const INLINE_STYLE_PAIRS: Record<string, MarkdownStyle> = {
  em_open: "italic",
  em_close: "italic",
  strong_open: "bold",
  strong_close: "bold",
  s_open: "strikethrough",
  s_close: "strikethrough",
  spoiler_open: "spoiler",
  spoiler_close: "spoiler",
};

/** The list token names (one handler keeps the block renderer small). */
const LIST_TOKEN_TYPES = new Set([
  "bullet_list_open",
  "bullet_list_close",
  "ordered_list_open",
  "ordered_list_close",
  "list_item_open",
  "list_item_close",
]);

/** The inline token names that are NOT emphasis pairs (text, breaks, code,
 * links, inline HTML). */
const INLINE_TOKEN_TYPES = new Set([
  "text",
  "softbreak",
  "hardbreak",
  "code_inline",
  "link_open",
  "link_close",
  "html_inline",
]);

function renderUnknownToken(token: MarkdownToken, state: RenderState): void {
  if (token.children) {
    for (const child of token.children) {
      renderToken(child, state);
    }
  }
}

/** One markdown-it token → the IR (the OpenClaw `ir.ts` walk narrowed to the
 * Bot API HTML style set). Dispatch: emphasis pairs by table, then list /
 * inline / block handlers. */
function renderToken(token: MarkdownToken, state: RenderState): void {
  const inlineStyle = INLINE_STYLE_PAIRS[token.type];
  if (inlineStyle !== undefined) {
    if (token.type.endsWith("_open")) openStyle(state, inlineStyle);
    else closeStyle(state, inlineStyle);
    return;
  }
  if (LIST_TOKEN_TYPES.has(token.type)) {
    renderListToken(token, state);
    return;
  }
  if (INLINE_TOKEN_TYPES.has(token.type)) {
    renderInlineToken(token, state);
    return;
  }
  renderBlockToken(token, state);
}

function renderInlineToken(token: MarkdownToken, state: RenderState): void {
  switch (token.type) {
    case "text":
      state.text += token.content;
      break;
    case "softbreak":
    case "hardbreak":
      state.text += "\n";
      break;
    case "code_inline":
      if (token.content) {
        state.styles.push({
          start: state.text.length,
          end: state.text.length + token.content.length,
          style: "code",
        });
        state.text += token.content;
      }
      break;
    case "link_open": {
      state.linkStack.push({
        href: getAttr(token, "href") ?? "",
        labelStart: state.text.length,
      });
      break;
    }
    case "link_close":
      handleLinkClose(state);
      break;
    case "html_inline":
      state.text += token.content;
      break;
    default:
      renderUnknownToken(token, state);
      break;
  }
}

/** The list tokens: open/close + item marker emission (the OpenClaw walk's
 * list half, kept as one handler). */
function renderListToken(token: MarkdownToken, state: RenderState): void {
  switch (token.type) {
    case "bullet_list_open":
      renderListOpenPrefix(state);
      state.listStack.push({ type: "bullet", index: 0, openLevel: token.level });
      break;
    case "bullet_list_close":
      renderListCloseSuffix(state);
      break;
    case "ordered_list_open": {
      renderListOpenPrefix(state);
      const start = Number(getAttr(token, "start") ?? "1");
      state.listStack.push({ type: "ordered", index: start - 1, openLevel: token.level });
      break;
    }
    case "ordered_list_close":
      renderListCloseSuffix(state);
      break;
    case "list_item_open": {
      const top = state.listStack[state.listStack.length - 1];
      if (top === undefined) {
        break;
      }
      top.index += 1;
      const indent = "  ".repeat(Math.max(0, state.listStack.length - 1));
      state.text += indent;
      state.text += top.type === "ordered" ? `${top.index}. ` : "• ";
      break;
    }
    case "list_item_close":
      if (!state.text.endsWith("\n")) {
        state.text += "\n";
      }
      break;
    default:
      renderUnknownToken(token, state);
      break;
  }
}

/** A list open: a newline when text is already open (the item marker follows
 * on the same line). */
function renderListOpenPrefix(state: RenderState): void {
  if (state.listStack.length > 0 && !state.text.endsWith("\n")) {
    state.text += "\n";
  }
}

/** A list close: when the outermost list ends, separate it from the
 * following text with a newline (unless a blank line is already there). */
function renderListCloseSuffix(state: RenderState): void {
  state.listStack.pop();
  if (state.listStack.length === 0 && !state.text.endsWith("\n\n")) {
    state.text += "\n";
  }
}

/** The block tokens: paragraphs, headings, blockquotes, hr, code, blocks. */
function renderBlockToken(token: MarkdownToken, state: RenderState): void {
  switch (token.type) {
    case "inline":
      if (token.children) {
        renderInlineChildren(token.children, state);
      }
      break;
    case "paragraph_close":
      appendParagraphSeparator(state, token);
      break;
    case "heading_open":
      break;
    case "heading_close":
      // Headings are flattened to plain text (`headingStyle: "none"`).
      state.text += "\n\n";
      break;
    case "blockquote_open":
      // Nested blockquotes are flattened: the innermost quote carries the
      // blockquote style, and deeper levels only extend that same span, so
      // the IR has a single blockquote style wrapping the whole quote.
      state.blockquoteStack.push({ start: state.text.length });
      if (state.blockquoteStack.length === 1) {
        openStyle(state, "blockquote");
      }
      break;
    case "blockquote_close": {
      state.blockquoteStack.pop();
      if (state.blockquoteStack.length === 0) {
        closeStyle(state, "blockquote", { trimTrailingParagraphSeparator: true });
      }
      break;
    }
    case "hr":
      // Thematic break → OpenClaw's default horizontal-rule text + blank line.
      state.text += "───\n\n";
      break;
    case "code_block":
      renderCodeBlock(state, token.content, token.info, "indented");
      break;
    case "fence":
      renderCodeBlock(state, token.content, token.info, "fenced");
      break;
    case "html_block":
      state.text += token.content;
      break;
    default:
      renderUnknownToken(token, state);
      break;
  }
}

/** Render an inline token's children, injecting `||...||` spoiler spans into
 * the text tokens first (the OpenClaw `applySpoilerTokens` pass — markdown-it
 * has no native spoiler, so the front-end splits `||`-delimited text and
 * emits spoiler open/close around the even-numbered runs). */
function renderInlineChildren(children: MarkdownToken[], state: RenderState): void {
  const spoilerOpenCount =
    countSpoilerDelimiters(children) - (countSpoilerDelimiters(children) % 2);
  let consumed = 0;
  for (const child of children) {
    if (child.type !== "text" || !child.content.includes("||")) {
      renderToken(child, state);
      continue;
    }
    let index = 0;
    const content = child.content;
    while (index < content.length) {
      const next = content.indexOf("||", index);
      if (next === -1) {
        state.text += content.slice(index);
        break;
      }
      if (consumed >= spoilerOpenCount) {
        state.text += content.slice(index);
        break;
      }
      state.text += content.slice(index, next);
      consumed += 1;
      if (consumed % 2 === 1) {
        openStyle(state, "spoiler");
      } else {
        closeStyle(state, "spoiler");
      }
      index = next + 2;
    }
  }
}

function countSpoilerDelimiters(children: MarkdownToken[]): number {
  let total = 0;
  for (const child of children) {
    const content = child.type === "text" ? child.content : "";
    let index = 0;
    while (index < content.length) {
      const next = content.indexOf("||", index);
      if (next === -1) {
        break;
      }
      total += 1;
      index = next + 2;
    }
  }
  return total;
}

function renderCodeBlock(
  state: RenderState,
  content: string,
  info: string | undefined,
  origin: "fenced" | "indented",
): void {
  let code = content;
  if (!code.endsWith("\n")) {
    code = `${code}\n`;
  }
  const language = resolveFenceLanguage(info);
  state.styles.push({
    start: state.text.length,
    end: state.text.length + code.length,
    style: "code_block",
    ...(language !== undefined ? { language } : {}),
  });
  state.text += code;
  // A code block not in a list gets a blank line after it, so following
  // paragraphs stay separated.
  if (state.listStack.length === 0) {
    state.text += "\n";
  }
  void origin;
}

// Style open-order rank (lower opens first, so LIFO closes stay valid for
// spans sharing a start boundary): blockquote wraps code_block wraps code
// wraps inline emphasis — matching OpenClaw's STRUCTURAL-first ordering.
const STYLE_RANK = new Map<MarkdownStyle, number>([
  ["blockquote", 0],
  ["code_block", 1],
  ["code", 2],
  ["bold", 3],
  ["italic", 4],
  ["strikethrough", 5],
  ["spoiler", 6],
]);

function buildCodeBlockOpen(language: string | undefined): string {
  if (!language) {
    return "<pre><code>";
  }
  const safeLanguage = language.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<pre><code class="language-${safeLanguage}">`;
}

/** The open/close markers due at one text position (link spans plus style
 * spans starting there). */
type OpeningItem =
  | { end: number; open: string; close: string; kind: "link" }
  | { end: number; open: string; close: string; kind: "style"; style: MarkdownStyle };

/** The markers that open at `pos`: links first, then styles — the link href
 * goes through `escapeHtmlAttr` so `&`/`"` stay legal in Bot API HTML. */
function collectOpeningItems(
  pos: number,
  linkStarts: Map<number, MarkdownIR["links"]>,
  startsAt: Map<number, MarkdownIR["styles"]>,
  styleMarkers: Record<MarkdownStyle, { open: string; close: string }>,
): OpeningItem[] {
  const items: OpeningItem[] = [];
  for (const link of linkStarts.get(pos) ?? []) {
    items.push({
      end: link.end,
      open: `<a href="${escapeHtmlAttr(link.href)}">`,
      close: "</a>",
      kind: "link",
    });
  }
  for (const span of startsAt.get(pos) ?? []) {
    const marker = styleMarkers[span.style];
    items.push({
      end: span.end,
      open: span.style === "code_block" ? buildCodeBlockOpen(span.language) : marker.open,
      close: marker.close,
      kind: "style",
      style: span.style,
    });
  }
  return items;
}

/** Outer spans open first so LIFO closes stay valid for spans sharing a
 * start boundary: longer end wins, then links before styles, then structural
 * rank (`STYLE_RANK`). */
function compareOpeningItems(a: OpeningItem, b: OpeningItem): number {
  if (a.end !== b.end) {
    return b.end - a.end;
  }
  if (a.kind !== b.kind) {
    return a.kind === "link" ? -1 : 1;
  }
  if (a.kind === "style" && b.kind === "style") {
    const rankA = STYLE_RANK.get(a.style) ?? 0;
    const rankB = STYLE_RANK.get(b.style) ?? 0;
    if (rankA !== rankB) {
      return rankA - rankB;
    }
  }
  return 0;
}

/** Render the IR to Bot API HTML with the marker-boundary algorithm of
 * `markdown-core/src/render.ts` (close at boundary before open; open outer
 * spans first so LIFO closes stay valid). */
export function renderTelegramMarkdownIR(ir: MarkdownIR): string {
  const text = ir.text;
  if (!text) {
    return "";
  }

  const styleMarkers: Record<MarkdownStyle, { open: string; close: string }> = {
    bold: { open: "<b>", close: "</b>" },
    italic: { open: "<i>", close: "</i>" },
    strikethrough: { open: "<s>", close: "</s>" },
    code: { open: "<code>", close: "</code>" },
    code_block: { open: "<pre><code>", close: "</code></pre>" },
    spoiler: { open: "<tg-spoiler>", close: "</tg-spoiler>" },
    blockquote: { open: "<blockquote>", close: "</blockquote>" },
  };

  const boundaries = new Set<number>([0, text.length]);
  const startsAt = new Map<number, MarkdownIR["styles"]>();
  for (const span of ir.styles) {
    if (span.start === span.end) {
      continue;
    }
    boundaries.add(span.start);
    boundaries.add(span.end);
    const bucket = startsAt.get(span.start);
    if (bucket) {
      bucket.push(span);
    } else {
      startsAt.set(span.start, [span]);
    }
  }
  const linkStarts = new Map<number, MarkdownIR["links"]>();
  for (const link of ir.links) {
    if (link.start === link.end) {
      continue;
    }
    boundaries.add(link.start);
    boundaries.add(link.end);
    const bucket = linkStarts.get(link.start);
    if (bucket) {
      bucket.push(link);
    } else {
      linkStarts.set(link.start, [link]);
    }
  }

  const points = [...boundaries].toSorted((a, b) => a - b);
  const stack: { close: string; end: number }[] = [];
  let out = "";

  for (const [i, pos] of points.entries()) {
    while (stack.length && stack[stack.length - 1]?.end === pos) {
      const item = stack.pop();
      if (item) {
        out += item.close;
      }
    }

    const openingItems = collectOpeningItems(pos, linkStarts, startsAt, styleMarkers);

    if (openingItems.length > 0) {
      openingItems.sort(compareOpeningItems);
      for (const item of openingItems) {
        out += item.open;
        stack.push({ close: item.close, end: item.end });
      }
    }

    const next = points[i + 1];
    if (next === undefined) {
      break;
    }
    if (next > pos) {
      out += escapeTelegramHtml(text.slice(pos, next));
    }
  }

  return out;
}

/** Escape `&`, `<`, `>` for Bot API HTML mode — re-exported from the
 * format-html leaf so this module's public name stays stable. */
export { escapeTelegramHtml } from "./format-html.js";

/** Escape for a Bot API HTML attribute value (adds `"` → `&quot;`). */
function escapeHtmlAttr(text: string): string {
  return escapeTelegramHtml(text).replace(/"/g, "&quot;");
}

/** Sanitize IR-rendered HTML down to the Bot API `parse_mode: HTML` tag set
 * (the OpenClaw `renderSupportedTelegramHtml` step). */
export function sanitizeTelegramHtml(html: string): string {
  return renderSupportedTelegramHtml(html);
}

/** Markdown → Bot API `parse_mode: HTML` text: parse, render to HTML, then
 * keep only the Bot API-legal tags (everything else is escaped so it cannot
 * break the send). */
export function markdownToTelegramHtml(markdown: string): string {
  const ir = markdownToTelegramIR(markdown);
  const html = renderTelegramMarkdownIR(ir);
  return sanitizeTelegramHtml(html);
}
