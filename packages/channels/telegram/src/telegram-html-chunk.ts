// COMPAT(clisbot-control-plane): Telegram channel format — HTML-aware chunk
// splitting (C5) — verbatim port of openclaw-private
// `extensions/telegram/src/format.ts`
// (`splitTelegramHtmlChunks` + `splitTelegramHtmlChunksRaw` + the split-index
// helpers). Kept tag-balance-aware: a long `<b>`/`<pre><code>` scope is closed
// and reopened around the 4000-char boundary so no chunk carries a dangling
// entity or unbalanced tag. The OpenClaw transcript-role-header protection
// wrapper is omitted (the in-repo vertical has no assistant-transcript pass).

import { tokenizeHtmlTags } from "./html-tags.js";
import { findTelegramHtmlEntityEnd } from "./format-html.js";

interface TelegramHtmlTag {
  name: string;
  openTag: string;
  closeTag: string;
}

function buildTelegramHtmlOpenPrefix(tags: TelegramHtmlTag[]): string {
  return tags.map((tag) => tag.openTag).join("");
}

function buildTelegramHtmlCloseSuffix(tags: TelegramHtmlTag[]): string {
  return tags
    .slice()
    .toReversed()
    .map((tag) => tag.closeTag)
    .join("");
}

function buildTelegramHtmlCloseSuffixLength(tags: TelegramHtmlTag[]): number {
  return tags.reduce((total, tag) => total + tag.closeTag.length, 0);
}

// Never return a split index that lands between a UTF-16 surrogate pair, or
// both chunks would carry a lone surrogate that re-encodes to U+FFFD. If the
// pair starts the segment, keep it whole so chunking still advances.
function clampToSurrogateBoundary(text: string, index: number): number {
  const high = text.charCodeAt(index - 1);
  const low = text.charCodeAt(index);
  const splitsPair =
    index > 0 && high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
  if (!splitsPair) {
    return index;
  }
  return index > 1 ? index - 1 : index + 1;
}

// Prefer a word/paragraph boundary inside the entity-safe window so long text
// runs break between words instead of mid-word. Whitespace never falls inside
// an HTML entity, so this keeps entities intact; the caller falls back to the
// entity-safe hard cut only when the window has no interior whitespace.
function findTelegramHtmlWordSafeSplitIndex(text: string, end: number): number {
  let lastNewline = 0;
  let lastWhitespace = 0;
  for (let index = 1; index < end; index += 1) {
    const char = text[index];
    if (char === "\n") {
      lastNewline = index + 1;
    } else if (char !== undefined && /\s/.test(char)) {
      lastWhitespace = index + 1;
    }
  }
  return lastNewline > 0 ? lastNewline : lastWhitespace;
}

function findTelegramHtmlSafeSplitIndex(text: string, maxLength: number): number {
  if (text.length <= maxLength) {
    return text.length;
  }
  const normalizedMaxLength = Math.max(1, Math.floor(maxLength));
  const entitySafeIndex = findTelegramHtmlEntitySafeSplitIndex(text, normalizedMaxLength);
  const wordSafeIndex = findTelegramHtmlWordSafeSplitIndex(text, entitySafeIndex);
  const splitIndex = wordSafeIndex > 0 ? wordSafeIndex : entitySafeIndex;
  return clampToSurrogateBoundary(text, splitIndex);
}

function findTelegramHtmlEntitySafeSplitIndex(text: string, normalizedMaxLength: number): number {
  const lastAmpersand = text.lastIndexOf("&", normalizedMaxLength - 1);
  if (lastAmpersand === -1) {
    return normalizedMaxLength;
  }
  const lastSemicolon = text.lastIndexOf(";", normalizedMaxLength - 1);
  if (lastAmpersand < lastSemicolon) {
    return normalizedMaxLength;
  }
  const entityEnd = findTelegramHtmlEntityEnd(text, lastAmpersand);
  if (entityEnd === -1 || entityEnd < normalizedMaxLength) {
    return normalizedMaxLength;
  }
  return lastAmpersand;
}

function popTelegramHtmlTag(tags: TelegramHtmlTag[], name: string): void {
  for (let index = tags.length - 1; index >= 0; index -= 1) {
    if (tags[index]?.name === name) {
      tags.splice(index, 1);
      return;
    }
  }
}

export function splitTelegramHtmlChunksRaw(html: string, limit: number): string[] {
  if (!html) {
    return [];
  }
  const normalizedLimit = Math.max(1, Math.floor(limit));
  if (html.length <= normalizedLimit) {
    return [html];
  }

  const chunks: string[] = [];
  const openTags: TelegramHtmlTag[] = [];
  const suppressedTagNames: string[] = [];
  let current = "";
  let chunkHasPayload = false;

  const resetCurrent = () => {
    current = buildTelegramHtmlOpenPrefix(openTags);
    chunkHasPayload = false;
  };

  const flushCurrent = () => {
    if (!chunkHasPayload) {
      return;
    }
    chunks.push(`${current}${buildTelegramHtmlCloseSuffix(openTags)}`);
    resetCurrent();
  };

  const appendText = (segment: string) => {
    let remaining = segment;
    while (remaining.length > 0) {
      const available =
        normalizedLimit - current.length - buildTelegramHtmlCloseSuffixLength(openTags);
      if (available <= 0) {
        if (!chunkHasPayload) {
          // Preserve the matching closes separately when tag overhead alone
          // fills a chunk. Dropping only this active scope keeps later tags
          // balanced while the affected text degrades to plain HTML content.
          suppressedTagNames.push(...openTags.map((tag) => tag.name));
          openTags.length = 0;
          resetCurrent();
          continue;
        }
        flushCurrent();
        continue;
      }
      if (remaining.length <= available) {
        current += remaining;
        chunkHasPayload = true;
        break;
      }
      const splitAt = findTelegramHtmlSafeSplitIndex(remaining, available);
      if (splitAt <= 0) {
        if (!chunkHasPayload) {
          throw new Error(
            `Telegram HTML chunk limit exceeded by leading entity (limit=${normalizedLimit})`,
          );
        }
        flushCurrent();
        continue;
      }
      current += remaining.slice(0, splitAt);
      chunkHasPayload = true;
      remaining = remaining.slice(splitAt);
      flushCurrent();
    }
  };

  resetCurrent();
  let lastIndex = 0;
  for (const tag of tokenizeHtmlTags(html)) {
    const tagStart = tag.start;
    const tagEnd = tag.end;
    appendText(html.slice(lastIndex, tagStart));

    const rawTag = tag.raw;
    const isClosing = tag.closing;
    const tagName = tag.name;
    const isSelfClosing = !isClosing && rawTag.trimEnd().endsWith("/>");

    if (!isClosing) {
      const nextCloseLength = isSelfClosing ? 0 : `</${tagName}>`.length;
      if (
        chunkHasPayload &&
        current.length +
          rawTag.length +
          buildTelegramHtmlCloseSuffixLength(openTags) +
          nextCloseLength >
          normalizedLimit
      ) {
        flushCurrent();
      }
    }

    const closesOpenTag = isClosing && openTags.some((openTag) => openTag.name === tagName);
    const closesSuppressedTag =
      isClosing && !closesOpenTag && popSuppressedTagName(suppressedTagNames, tagName);
    if (!closesSuppressedTag) {
      current += rawTag;
    }
    if (isSelfClosing) {
      chunkHasPayload = true;
    }
    if (isClosing) {
      popTelegramHtmlTag(openTags, tagName);
    } else if (!isSelfClosing) {
      openTags.push({
        name: tagName,
        openTag: rawTag,
        closeTag: `</${tagName}>`,
      });
    }
    lastIndex = tagEnd;
  }

  appendText(html.slice(lastIndex));
  flushCurrent();
  return chunks.length > 0 ? chunks : [html];
}

function popSuppressedTagName(names: string[], name: string): boolean {
  for (let index = names.length - 1; index >= 0; index -= 1) {
    if (names[index] === name) {
      names.splice(index, 1);
      return true;
    }
  }
  return false;
}

/** Split Telegram HTML at `limit` chars, keeping every chunk's tags balanced. */
export function splitTelegramHtmlChunks(html: string, limit: number): string[] {
  return splitTelegramHtmlChunksRaw(html, limit);
}
