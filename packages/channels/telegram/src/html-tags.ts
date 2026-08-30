// COMPAT(clisbot-control-plane): Telegram channel format — HTML tag
// tokenization for the C5 HTML chunk splitter: port of openclaw-private
// `packages/markdown-core/src/html-tags.ts` (`tokenizeHtmlTags`), sticky-regex
// loop instead of a slice-per-tag. The `HTML_TAG_RE` grammar is inlined (copied
// from markdown-it's `lib/common/html_re.js`) so the vertical stays
// self-contained and does not depend on a specific markdown-it internal path.

interface HtmlTagToken {
  raw: string;
  start: number;
  end: number;
  name: string;
  closing: boolean;
  selfClosing: boolean;
}

// Quote-aware HTML open/close tag grammar (markdown-it's `HTML_TAG_RE`).
// Sticky (no `^` — the `y` flag anchors the match at `lastIndex`, where the
// caller places each `<`), so it runs against the full string without a
// per-tag slice (the port's slice-per-tag shape was O(n) per tag).
const HTML_TAG_RE = new RegExp(
  "(?:" +
    "<[A-Za-z][A-Za-z0-9\\-]*(?:\\s+[a-zA-Z_:][a-zA-Z0-9:._-]*(?:\\s*=\\s*(?:[^\"'=<>`\\x00-\\x20]+|\"[^\"]*\"|'[^']*'))?)*\\s*\\/?>" +
    "|</[A-Za-z][A-Za-z0-9\\-]*\\s*>" +
    "|<!---->|<!--(?:-?[^>-])(?:-?[^-])*-->" +
    "|<[?].*?[?]>" +
    "|<![A-Z]+\\s+[^>]*>" +
    "|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>" +
    ")",
  "y",
);

function htmlTagName(rawTag: string, closing: boolean): string {
  let end = closing ? 2 : 1;
  while (end < rawTag.length) {
    const code = rawTag.charCodeAt(end);
    const isAsciiLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    const isDigit = code >= 48 && code <= 57;
    if (!isAsciiLetter && !isDigit && code !== 45) {
      break;
    }
    end += 1;
  }
  return rawTag.slice(closing ? 2 : 1, end).toLowerCase();
}

/** Tokenizes valid open/close HTML tags with markdown-it's quote-aware grammar. */
export function* tokenizeHtmlTags(html: string): Generator<HtmlTagToken> {
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start < 0) {
      return;
    }
    HTML_TAG_RE.lastIndex = start;
    const match = HTML_TAG_RE.exec(html);
    if (!match) {
      cursor = start + 1;
      continue;
    }
    const raw = match[0];
    const closing = raw.startsWith("</");
    const end = start + raw.length;
    const name = htmlTagName(raw, closing);
    if (!name) {
      cursor = end;
      continue;
    }
    yield {
      raw,
      start,
      end,
      name,
      closing,
      selfClosing: !closing && raw.trimEnd().endsWith("/>"),
    };
    cursor = end;
  }
}
