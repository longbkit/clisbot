import { describe, expect, test } from "bun:test";
import { renderTelegramHtmlSafeFromMarkdown } from "../src/channels/telegram/html-safe.ts";

describe("renderTelegramHtmlSafeFromMarkdown", () => {
  test("renders common inline markdown and escapes raw html", () => {
    const rendered = renderTelegramHtmlSafeFromMarkdown(
      "Hello <team> **bold** *italic* `code` [site](https://example.com)",
    );

    expect(rendered).toBe(
      'Hello &lt;team&gt; <b>bold</b> <i>italic</i> <code>code</code> <a href="https://example.com">site</a>',
    );
  });

  test("auto-links plain safe urls in normal text", () => {
    const rendered = renderTelegramHtmlSafeFromMarkdown(
      "Doc: http://sandbox:6419/docs/architecture/decisions/2026-05-01-session-key-and-session-id-continuity-decision.md",
    );

    expect(rendered).toBe(
      'Doc: <a href="http://sandbox:6419/docs/architecture/decisions/2026-05-01-session-key-and-session-id-continuity-decision.md">http://sandbox:6419/docs/architecture/decisions/2026-05-01-session-key-and-session-id-continuity-decision.md</a>',
    );
  });

  test("keeps trailing punctuation outside plain auto-linked urls", () => {
    const rendered = renderTelegramHtmlSafeFromMarkdown(
      "See https://example.com/test(path)).",
    );

    expect(rendered).toBe(
      'See <a href="https://example.com/test(path)">https://example.com/test(path)</a>).',
    );
  });

  test("renders headings and lists into readable Telegram-safe html", () => {
    const rendered = renderTelegramHtmlSafeFromMarkdown([
      "## Status",
      "",
      "- item 1",
      "- item 2 with **bold**",
      "1. first",
      "2. second",
    ].join("\n"));

    expect(rendered).toBe([
      "<b>Status</b>",
      "",
      "• item 1",
      "• item 2 with <b>bold</b>",
      "1. first",
      "2. second",
    ].join("\n"));
  });

  test("renders fenced code blocks with a Telegram-safe language tag", () => {
    const rendered = renderTelegramHtmlSafeFromMarkdown([
      "Before code",
      "",
      "```ts",
      "const x = 1 < 2;",
      "console.log(x);",
      "```",
      "",
      "After code",
    ].join("\n"));

    expect(rendered).toBe([
      "Before code",
      '<pre><code class="language-ts">const x = 1 &lt; 2;\nconsole.log(x);</code></pre>',
      "After code",
    ].join("\n"));
  });

  test("keeps unsupported links as escaped plain text instead of emitting unsafe html", () => {
    const rendered = renderTelegramHtmlSafeFromMarkdown(
      "[bad](javascript:alert(1)) and [mail](mailto:test@example.com)",
    );

    expect(rendered).toBe(
      "[bad](javascript:alert(1)) and <a href=\"mailto:test@example.com\">mail</a>",
    );
  });

  test("renders blockquotes and strike formatting", () => {
    const rendered = renderTelegramHtmlSafeFromMarkdown([
      "> quoted line",
      "",
      "~~done~~",
    ].join("\n"));

    expect(rendered).toBe([
      "&gt; quoted line",
      "",
      "<s>done</s>",
    ].join("\n"));
  });

  test("does not treat snake_case or env-like names as italic markers", () => {
    const rendered = renderTelegramHtmlSafeFromMarkdown(
      "Use message_thread_id with TELEGRAM_BOT_TOKEN and /tmp/test_file.ts",
    );

    expect(rendered).toBe(
      "Use message_thread_id with TELEGRAM_BOT_TOKEN and /tmp/test_file.ts",
    );
  });

  test("renders fenced code blocks without a language tag safely", () => {
    const rendered = renderTelegramHtmlSafeFromMarkdown([
      "```",
      "plain <xml>",
      "```",
    ].join("\n"));

    expect(rendered).toBe("<pre><code>plain &lt;xml&gt;</code></pre>");
  });

  test("keeps unsupported table-like markdown as readable plain text", () => {
    const rendered = renderTelegramHtmlSafeFromMarkdown([
      "| Name | Status |",
      "| --- | --- |",
      "| api | ok |",
    ].join("\n"));

    expect(rendered).toBe([
      "| Name | Status |",
      "| --- | --- |",
      "| api | ok |",
    ].join("\n"));
  });

  test("normalizes repeated blank lines without dropping paragraph structure", () => {
    const rendered = renderTelegramHtmlSafeFromMarkdown([
      "First paragraph",
      "",
      "",
      "",
      "Second paragraph with **bold**",
    ].join("\n"));

    expect(rendered).toBe([
      "First paragraph",
      "",
      "Second paragraph with <b>bold</b>",
    ].join("\n"));
  });

  test("accepts tg deep links and renders them as safe anchors", () => {
    const rendered = renderTelegramHtmlSafeFromMarkdown(
      "[open chat](tg://resolve?domain=longluong2bot)",
    );

    expect(rendered).toBe(
      '<a href="tg://resolve?domain=longluong2bot">open chat</a>',
    );
  });

  test("keeps unsafe protocols as plain escaped text", () => {
    const rendered = renderTelegramHtmlSafeFromMarkdown(
      "[xss](javascript:alert(1)) [ok](https://example.com)",
    );

    expect(rendered).toBe(
      "[xss](javascript:alert(1)) <a href=\"https://example.com\">ok</a>",
    );
  });

  test("does not apply markdown formatting inside inline code", () => {
    const rendered = renderTelegramHtmlSafeFromMarkdown(
      "Use `**literal** _value_ <tag> https://example.com` here",
    );

    expect(rendered).toBe(
      "Use <code>**literal** _value_ &lt;tag&gt; https://example.com</code> here",
    );
  });

  test("renders italic markers with asterisks but leaves unmatched markers readable", () => {
    const rendered = renderTelegramHtmlSafeFromMarkdown(
      "This is *italic* but this is just * a star",
    );

    expect(rendered).toBe("This is <i>italic</i> but this is just * a star");
  });

  test("renders heading levels as section title, subsection, then flattened body", () => {
    const rendered = renderTelegramHtmlSafeFromMarkdown([
      "# H1",
      "## H2",
      "### H3",
      "#### H4",
      "##### H5",
      "###### H6",
    ].join("\n"));

    expect(rendered).toBe([
      "<b>H1</b>",
      "",
      "<b>H2</b>",
      "",
      "<b>H3</b>",
      "H4",
      "H5",
      "H6",
    ].join("\n"));
  });

  test("adds strong spacing around section headings and lighter spacing for subsections", () => {
    const rendered = renderTelegramHtmlSafeFromMarkdown([
      "Before",
      "## Section",
      "After section",
      "### Subsection",
      "After subsection",
    ].join("\n"));

    expect(rendered).toBe([
      "Before",
      "",
      "<b>Section</b>",
      "",
      "After section",
      "<b>Subsection</b>",
      "After subsection",
    ].join("\n"));
  });

  test("renders mixed ordered and unordered lists without losing line structure", () => {
    const rendered = renderTelegramHtmlSafeFromMarkdown([
      "1. first",
      "2. second",
      "- bullet",
      "- bullet with `code`",
    ].join("\n"));

    expect(rendered).toBe([
      "1. first",
      "2. second",
      "• bullet",
      "• bullet with <code>code</code>",
    ].join("\n"));
  });

  test("renders formatting inside blockquotes safely", () => {
    const rendered = renderTelegramHtmlSafeFromMarkdown("> **quoted** <tag>");

    expect(rendered).toBe("&gt; <b>quoted</b> &lt;tag&gt;");
  });

  test("treats unterminated fenced code blocks as code until the end", () => {
    const rendered = renderTelegramHtmlSafeFromMarkdown([
      "```ts",
      "const broken = true;",
    ].join("\n"));

    expect(rendered).toBe(
      '<pre><code class="language-ts">const broken = true;</code></pre>',
    );
  });

  test("keeps text before an unterminated fenced block and renders the tail as code", () => {
    const rendered = renderTelegramHtmlSafeFromMarkdown([
      "Before",
      "",
      "```bash",
      "bun run check",
      "bunx tsc --noEmit",
    ].join("\n"));

    expect(rendered).toBe([
      "Before",
      '<pre><code class="language-bash">bun run check\nbunx tsc --noEmit</code></pre>',
    ].join("\n"));
  });
});
