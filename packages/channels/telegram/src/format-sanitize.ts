// COMPAT(clisbot-control-plane): Telegram channel format — Bot API HTML
// sanitizer + plain-text projection (C5), port of openclaw-private
// `extensions/telegram/src/format.ts` (`renderSupportedTelegramHtml`,
// `preserveSupportedTelegramHtmlTags`, `countTelegramHtmlVisibleCharacters`,
// `telegramHtmlToPlainTextFallback` and the tag-support tables), kept to the
// legacy Bot API `parse_mode: HTML` tag set. The transcript-role-header
// protection, file-reference wrapping, and raw-HTML escape pass
// (`escapeUnsupportedTelegramHtml` — the `textMode: "html"` surface) are
// omitted: the in-repo vertical has no assistant-transcript surface, file
// refs are not linkified by the front-end, and the raw-HTML mode is not in
// the drive surface (D-004).

import { tokenizeHtmlTags } from "./html-tags.js";
import { decodeTelegramHtmlEntities } from "./format-html.js";

const HTML_MODE_TAG_PATTERN = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^<>]*)>$/;
const ESCAPED_HTML_TAG_PATTERN = /&lt;(\/?)([a-zA-Z][a-zA-Z0-9-]*)(.*?)&gt;/g;
const TELEGRAM_HTML_ANCHOR_PATTERN =
  /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
const TELEGRAM_HTML_BREAK_PATTERN = /<br\s*\/?>/gi;
const TELEGRAM_HTML_TAG_PATTERN = /<[^>]*>/g;
const TELEGRAM_RICH_HTML_TABLE_PATTERN = /<table\b[^>]*>[\s\S]*?<\/table>/gi;
const TELEGRAM_RICH_HTML_TABLE_ROW_PATTERN = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const TELEGRAM_RICH_HTML_TABLE_CELL_PATTERN = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

const TELEGRAM_SIMPLE_HTML_TAGS = new Set([
  "b",
  "strong",
  "i",
  "em",
  "u",
  "ins",
  "s",
  "strike",
  "del",
  "code",
  "pre",
  "tg-spoiler",
]);
const TELEGRAM_ATTR_HTML_TAG_PATTERNS = new Map([
  ["a", /^\s+href="[^"]+"\s*$/],
  ["span", /^\s+class="tg-spoiler"\s*$/],
  ["tg-emoji", /^\s+emoji-id="[^"]+"\s*$/],
  ["tg-time", /^\s+unix="[1-9]\d*"(?:\s+format="(?:r|w?[dD]?[tT]?)")?\s*$/],
  ["blockquote", /^(\s+expandable)?\s*$/],
]);
const TELEGRAM_CODE_LANGUAGE_ATTR_PATTERN = /^\s+class="language-[^"]+"\s*$/;

interface TelegramHtmlTagSupport {
  simpleTags: ReadonlySet<string>;
  attrPatterns: ReadonlyMap<string, RegExp>;
}

const TELEGRAM_LEGACY_HTML_TAG_SUPPORT: TelegramHtmlTagSupport = {
  simpleTags: TELEGRAM_SIMPLE_HTML_TAGS,
  attrPatterns: TELEGRAM_ATTR_HTML_TAG_PATTERNS,
};

function normalizeLowercaseStringOrEmpty(value: string): string {
  return value.toLowerCase();
}

function popLastTagName(tags: string[], name: string): boolean {
  for (let index = tags.length - 1; index >= 0; index -= 1) {
    if (tags[index] === name) {
      tags.splice(index, 1);
      return true;
    }
  }
  return false;
}

function isSupportedTelegramHtmlTag(rawTag: string, support: TelegramHtmlTagSupport): boolean {
  const match = HTML_MODE_TAG_PATTERN.exec(rawTag);
  if (!match) {
    return false;
  }
  const closing = match[1] === "/";
  const name = normalizeLowercaseStringOrEmpty(match[2] ?? "");
  const attrs = match[3] ?? "";
  if (closing) {
    return attrs.trim() === "" && (support.simpleTags.has(name) || support.attrPatterns.has(name));
  }
  if (name === "code" && TELEGRAM_CODE_LANGUAGE_ATTR_PATTERN.test(attrs)) {
    return true;
  }
  if (support.attrPatterns.get(name)?.test(attrs)) {
    return true;
  }
  return support.simpleTags.has(name) && attrs.trim() === "";
}

function hasOpenTelegramHtmlTag(tags: readonly string[], name: string): boolean {
  return tags.includes(name);
}

function preserveTelegramHtmlTag(
  rawTag: string,
  openTags: string[],
  escapeTag: (rawTag: string) => string,
  support: TelegramHtmlTagSupport,
): string {
  const match = HTML_MODE_TAG_PATTERN.exec(rawTag);
  if (!match) {
    return escapeTag(rawTag);
  }
  const closing = match[1] === "/";
  const tagName = normalizeLowercaseStringOrEmpty(match[2] ?? "");
  const attrs = match[3] ?? "";
  if (!closing && tagName === "code" && TELEGRAM_CODE_LANGUAGE_ATTR_PATTERN.test(attrs)) {
    openTags.push(tagName);
    if (hasOpenTelegramHtmlTag(openTags, "pre")) {
      return rawTag;
    }
    return "<code>";
  }
  if (!isSupportedTelegramHtmlTag(rawTag, support)) {
    return escapeTag(rawTag);
  }
  if (closing) {
    return popLastTagName(openTags, tagName) ? rawTag : escapeTag(rawTag);
  }
  if (rawTag.trimEnd().endsWith("/>")) {
    return rawTag;
  }
  openTags.push(tagName);
  return rawTag;
}

function stripTelegramHtmlForPlainText(html: string): string {
  return decodeTelegramHtmlEntities(
    html.replace(TELEGRAM_HTML_BREAK_PATTERN, "\n").replace(TELEGRAM_HTML_TAG_PATTERN, ""),
  );
}

export function countTelegramHtmlVisibleCharacters(html: string): number {
  // Telegram limits UTF-16 caption characters after stripping markup and
  // decoding entities.
  return stripTelegramHtmlForPlainText(html).length;
}

function encodePlainTextForTelegramHtmlStrip(text: string): string {
  return text.replace(/[&<>]/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      default:
        return char;
    }
  });
}

export function telegramHtmlToPlainTextFallback(html: string): string {
  const withPlainTables = html.replace(TELEGRAM_RICH_HTML_TABLE_PATTERN, (tableHtml) => {
    const rows = parseTelegramRichHtmlTableRows(tableHtml);
    return rows.map((row) => row.join(" | ")).join("\n");
  });
  TELEGRAM_HTML_ANCHOR_PATTERN.lastIndex = 0;
  const withPlainLinks = withPlainTables.replace(
    TELEGRAM_HTML_ANCHOR_PATTERN,
    (
      _match: string,
      doubleQuotedHref: string | undefined,
      singleQuotedHref: string | undefined,
      unquotedHref: string | undefined,
      labelHtml: string,
    ) => {
      const href = decodeTelegramHtmlEntities(
        doubleQuotedHref ?? singleQuotedHref ?? unquotedHref ?? "",
      ).trim();
      const label = stripTelegramHtmlForPlainText(labelHtml).trim();
      if (!href) {
        return encodePlainTextForTelegramHtmlStrip(label);
      }
      return encodePlainTextForTelegramHtmlStrip(
        !label || label === href ? href : `${label} (${href})`,
      );
    },
  );
  return stripTelegramHtmlForPlainText(withPlainLinks);
}

function promoteEscapedSupportedTelegramTags(
  text: string,
  openTags: string[],
  support: TelegramHtmlTagSupport,
): string {
  ESCAPED_HTML_TAG_PATTERN.lastIndex = 0;
  return text.replace(
    ESCAPED_HTML_TAG_PATTERN,
    (match, closing: string, name: string, attrs: string) =>
      preserveTelegramHtmlTag(
        `<${closing ?? ""}${name ?? ""}${attrs ?? ""}>`,
        openTags,
        () => match,
        support,
      ),
  );
}

function preserveSupportedTelegramHtmlTags(html: string): string {
  let codeDepth = 0;
  let preDepth = 0;
  let result = "";
  let lastIndex = 0;
  const openEscapedTags: string[] = [];

  for (const tag of tokenizeHtmlTags(html)) {
    const tagStart = tag.start;
    const tagEnd = tag.end;
    const tagName = tag.name;
    const isClosing = tag.closing;
    const textBefore = html.slice(lastIndex, tagStart);
    result +=
      codeDepth > 0 || preDepth > 0
        ? textBefore
        : promoteEscapedSupportedTelegramTags(
            textBefore,
            openEscapedTags,
            TELEGRAM_LEGACY_HTML_TAG_SUPPORT,
          );

    if (tagName === "code") {
      codeDepth = isClosing ? Math.max(0, codeDepth - 1) : codeDepth + 1;
    } else if (tagName === "pre") {
      preDepth = isClosing ? Math.max(0, preDepth - 1) : preDepth + 1;
    }

    result += html.slice(tagStart, tagEnd);
    lastIndex = tagEnd;
  }

  const remainingText = html.slice(lastIndex);
  result +=
    codeDepth > 0 || preDepth > 0
      ? remainingText
      : promoteEscapedSupportedTelegramTags(
          remainingText,
          openEscapedTags,
          TELEGRAM_LEGACY_HTML_TAG_SUPPORT,
        );
  return result;
}

/** Keep only Bot API `parse_mode: HTML`-legal tags/attrs; escape the rest so a
 * stray tag in agent output cannot break the whole send. */
export function renderSupportedTelegramHtml(html: string): string {
  return preserveSupportedTelegramHtmlTags(html);
}

function parseTelegramHtmlColspan(attrs: string): number {
  const raw = /(?:^|\s)colspan\s*=\s*(['"]?)\s*(\d+)\s*\1(?=\s|$)/i.exec(attrs)?.[2];
  const value = raw ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(value) && value > 1 ? Math.min(value, 21) : 1;
}

function parseTelegramRichHtmlTableRows(tableHtml: string): string[][] {
  const rows: string[][] = [];
  TELEGRAM_RICH_HTML_TABLE_ROW_PATTERN.lastIndex = 0;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = TELEGRAM_RICH_HTML_TABLE_ROW_PATTERN.exec(tableHtml)) !== null) {
    const rowHtml = rowMatch[1] ?? "";
    const row: string[] = [];
    TELEGRAM_RICH_HTML_TABLE_CELL_PATTERN.lastIndex = 0;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = TELEGRAM_RICH_HTML_TABLE_CELL_PATTERN.exec(rowHtml)) !== null) {
      const attrs = cellMatch[2] ?? "";
      const text = telegramHtmlToPlainTextFallback(cellMatch[3] ?? "")
        .replace(/\s+/g, " ")
        .trim();
      row.push(text, ...Array.from({ length: parseTelegramHtmlColspan(attrs) - 1 }, () => ""));
    }
    if (row.length) {
      rows.push(row);
    }
  }
  return rows;
}
