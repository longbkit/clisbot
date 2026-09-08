// Fusion-owned regression goldens for the Telegram formatter. The expected
// values were captured from OpenClaw's `markdownToTelegramHtml` /
// `splitTelegramHtmlChunks` / `telegramHtmlToPlainTextFallback` on 2026-08-27
// while `format.ts` was a local rewrite. `format.ts` is now the upstream source
// (`format.test.ts` / `format.wrap-md.test.ts` are the upstream suites); this
// file stays as an independent check that the restored formatter still answers
// the live Telegram cases the rewrite was captured against.
import { describe, expect, it } from "vitest";
import {
  countTelegramHtmlVisibleCharacters,
  escapeTelegramHtml,
  markdownToTelegramHtml,
  splitTelegramHtmlChunks,
  telegramHtmlToPlainTextFallback,
} from "./format.js";

describe("markdownToTelegramHtml (C5 front-end)", () => {
  it("renders basic inline formatting", () => {
    expect(markdownToTelegramHtml("hi _there_ **boss** `code`")).toBe(
      "hi <i>there</i> <b>boss</b> <code>code</code>",
    );
  });

  it("renders links as Telegram-safe HTML", () => {
    expect(markdownToTelegramHtml("see [docs](https://example.com)")).toBe(
      'see <a href="https://example.com">docs</a>',
    );
  });

  it("preserves supported Telegram HTML (raw input passes through)", () => {
    expect(markdownToTelegramHtml("<b>yes</b>")).toBe("<b>yes</b>");
  });

  it("escapes unsupported raw HTML", () => {
    expect(markdownToTelegramHtml("<script>nope</script>")).toBe(
      "&lt;script&gt;nope&lt;/script&gt;",
    );
  });

  it("escapes unsafe characters", () => {
    expect(markdownToTelegramHtml("a & b < c")).toBe("a &amp; b &lt; c");
  });

  it("renders paragraphs with blank lines", () => {
    expect(markdownToTelegramHtml("first\n\nsecond")).toBe("first\n\nsecond");
  });

  it("renders bullet lists with Telegram bullets", () => {
    expect(markdownToTelegramHtml("- one\n- two")).toBe("• one\n• two");
  });

  it("renders ordered lists with numbering", () => {
    expect(markdownToTelegramHtml("2. two\n3. three")).toBe("2. two\n3. three");
  });

  it("flattens headings to plain text", () => {
    expect(markdownToTelegramHtml("# Title")).toBe("Title");
  });

  it("renders fenced code blocks with the language class", () => {
    expect(markdownToTelegramHtml('```bash\necho "hello"\n```')).toBe(
      '<pre><code class="language-bash">echo "hello"\n</code></pre>',
    );
  });

  it("renders a code block without a language", () => {
    expect(markdownToTelegramHtml("```\ncode\n```")).toBe("<pre><code>code\n</code></pre>");
  });

  it("escapes HTML-looking text inside inline code", () => {
    expect(markdownToTelegramHtml("`<b>literal</b>`")).toBe(
      "<code>&lt;b&gt;literal&lt;/b&gt;</code>",
    );
  });

  it("nests bold wrapping a link", () => {
    expect(markdownToTelegramHtml("**bold [link](https://example.com) text**")).toBe(
      '<b>bold <a href="https://example.com">link</a> text</b>',
    );
  });

  it("renders strikethrough", () => {
    expect(markdownToTelegramHtml("~~strike~~ ok")).toBe("<s>strike</s> ok");
  });

  it("renders blockquotes with inline formatting", () => {
    expect(markdownToTelegramHtml("> **bold** quote")).toBe(
      "<blockquote><b>bold</b> quote</blockquote>",
    );
  });

  it("renders multiline blockquotes as a single Telegram blockquote", () => {
    expect(markdownToTelegramHtml("> first\n> second")).toBe(
      "<blockquote>first\nsecond</blockquote>",
    );
  });

  it("autolinks raw URLs", () => {
    expect(markdownToTelegramHtml("vis it https://auto.link now")).toBe(
      'vis it <a href="https://auto.link">https://auto.link</a> now',
    );
  });

  it("leaves non-URL bracket text as literal markdown", () => {
    expect(markdownToTelegramHtml("a [x](not a link)")).toBe("a [x](not a link)");
  });

  it("separates a heading from surrounding text with blank lines", () => {
    expect(markdownToTelegramHtml("# Title\n\ntext")).toBe("Title\n\ntext");
  });

  it("indents nested list items", () => {
    expect(markdownToTelegramHtml("- a\n  - nested\n- b")).toBe("• a\n  • nested\n• b");
  });

  it("separates a trailing paragraph from a list", () => {
    expect(markdownToTelegramHtml("- one\n- two\n\ntail")).toBe("• one\n• two\n\ntail");
  });

  it("renders spoiler delimiters as Telegram spoiler tags", () => {
    expect(markdownToTelegramHtml("the answer is ||42||")).toBe(
      "the answer is <tg-spoiler>42</tg-spoiler>",
    );
    expect(markdownToTelegramHtml("||**secret** text||")).toBe(
      "<tg-spoiler><b>secret</b> text</tg-spoiler>",
    );
  });

  it("does not treat unpaired delimiters as spoilers", () => {
    expect(markdownToTelegramHtml("before || after")).toBe("before || after");
  });

  it("renders thematic breaks as the OpenClaw rule text", () => {
    expect(markdownToTelegramHtml("hr\n---\ntail")).toBe("hr\n\ntail");
    expect(markdownToTelegramHtml("---\nbold")).toBe("───\n\nbold");
  });

  it("flattens nested blockquotes into one blockquote span", () => {
    expect(markdownToTelegramHtml("> **Q**\n> A\n>\n> > nested")).toBe(
      "<blockquote><b>Q</b>\nA\n\nnested</blockquote>",
    );
  });

  it("escapes ampersands and quotes in link hrefs", () => {
    expect(markdownToTelegramHtml("see [a](https://x.com/p?q=1&z=2#h)")).toBe(
      'see <a href="https://x.com/p?q=1&amp;z=2#h">a</a>',
    );
  });

  it("combines emphasis, code, strike, and spoiler on one line", () => {
    expect(markdownToTelegramHtml("**bold** _it_ `code` ~~strike~~ ||spoiler||")).toBe(
      "<b>bold</b> <i>it</i> <code>code</code> <s>strike</s> <tg-spoiler>spoiler</tg-spoiler>",
    );
  });

  it("renders code spans and single-backtick lines without leaking backslashes", () => {
    const input =
      "Mình sẽ chạy đúng lệnh `ls ~/root`. Lệnh thất bại:\n`ls: cannot access '/home/node/root': No such file or directory`";
    expect(markdownToTelegramHtml(input)).toBe(
      "Mình sẽ chạy đúng lệnh <code>ls ~/root</code>. Lệnh thất bại:\n<code>ls: cannot access '/home/node/root': No such file or directory</code>",
    );
  });
});

describe("escapeTelegramHtml", () => {
  it("escapes ampersand, lt, gt", () => {
    expect(escapeTelegramHtml("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });
});

describe("splitTelegramHtmlChunks (C5 chunker)", () => {
  it("keeps one chunk under the limit", () => {
    expect(splitTelegramHtmlChunks("<b>short</b>", 4000)).toEqual(["<b>short</b>"]);
  });

  it("splits long nested HTML without breaking balanced tags", () => {
    const chunks = splitTelegramHtmlChunks(`<b>${"A\n".repeat(2500)}</b>`, 4000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
      expect(chunk).toMatch(/^<b>[\s\S]*<\/b>$/);
    }
  });

  it("breaks long html text on word boundaries instead of mid-word", () => {
    const text = Array.from({ length: 12 }, () => "abcde").join(" ");
    const chunks = splitTelegramHtmlChunks(text, 13);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(13);
      for (const token of chunk.trim().split(/\s+/)) {
        expect(token).toBe("abcde");
      }
    }
    expect(chunks.join("")).toBe(text);
  });

  it("hard-cuts a single word longer than the limit", () => {
    const chunks = splitTelegramHtmlChunks("A".repeat(30), 10);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(10);
    }
    expect(chunks.join("")).toBe("A".repeat(30));
  });

  it("keeps astral chars whole across the chunk boundary", () => {
    const input = `${"A".repeat(9)}😀${"B".repeat(20)}`;
    const chunks = splitTelegramHtmlChunks(input, 10);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(input);
    for (const chunk of chunks) {
      expect(containsLoneSurrogate(chunk)).toBe(false);
    }
  });

  it("treats malformed leading ampersands as plain text", () => {
    const chunks = splitTelegramHtmlChunks(`&${"A".repeat(5000)}`, 4000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    }
  });

  it("delivers content as plain text when tag overhead fills the chunk", () => {
    const chunks = splitTelegramHtmlChunks("<b><i><u>x</u></i></b>", 10);
    expect(chunks).toEqual(["x"]);
  });
});

describe("telegramHtmlToPlainTextFallback + countTelegramHtmlVisibleCharacters", () => {
  it("projects links, code, and br to readable text", () => {
    const html =
      'Created: <a href="https://example.com/a?x=1&amp;y=2">Task &amp; One</a> <code>file.md</code> <br> <b>done</b>';
    expect(telegramHtmlToPlainTextFallback(html)).toBe(
      "Created: Task & One (https://example.com/a?x=1&y=2) file.md \n done",
    );
  });

  it("counts visible characters after stripping tags", () => {
    expect(countTelegramHtmlVisibleCharacters("<b>hello</b>")).toBe(5);
    expect(countTelegramHtmlVisibleCharacters("a&amp;b")).toBe(3);
  });
});

function containsLoneSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const isHigh = code >= 0xd800 && code <= 0xdbff;
    const isLow = code >= 0xdc00 && code <= 0xdfff;
    if (isHigh) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (isLow) {
      return true;
    }
  }
  return false;
}
