// COMPAT(clisbot-control-plane): targeted tests for the Slack mrkdwn-aware
// renderer (C5) — legitimate markdown renders as mrkdwn; XML-unsafe chars in
// text leaves are escaped; literal backslashes survive; no backslash-escaping
// of markup delimiters (the old `escapeSlackMrkdwn` defect).

import { describe, expect, it } from "vitest";
import { decodeSlackEntities, renderSlackMrkdwn } from "./mrkdwn.js";

describe("decodeSlackEntities", () => {
  it("decodes amp before interpreting the result", () => {
    expect(decodeSlackEntities("&amp;lt;")).toBe("&lt;");
  });

  it("keeps nested amp entities literal after one pass", () => {
    expect(decodeSlackEntities("&amp;amp;")).toBe("&amp;");
  });

  it("decodes standard Slack entities", () => {
    expect(decodeSlackEntities("&lt; &gt; &amp;")).toBe("< > &");
  });

  it("round-trips decoded wire text through mrkdwn rendering", () => {
    const wireText = "value &lt; 2 &amp; literal &lt; text";
    expect(renderSlackMrkdwn(decodeSlackEntities(wireText))).toBe(wireText);
  });
});

describe("renderSlackMrkdwn", () => {
  it("renders a code span as a real code span (no backslash escaping)", () => {
    expect(renderSlackMrkdwn("run `npm test` now")).toBe("run `npm test` now");
  });

  it("renders the exact failing screenshot input (code spans survive)", () => {
    const input =
      "Mình sẽ chạy đúng lệnh `ls ~/root`. Lệnh thất bại:\n" +
      "`ls: cannot access '/home/node/root': No such file or directory`";
    expect(renderSlackMrkdwn(input)).toBe(input);
  });

  it("renders a fenced code block with its language", () => {
    expect(renderSlackMrkdwn("```bash\necho hi\n```")).toBe("```bash\necho hi\n```");
  });

  it("escapes XML-unsafe chars inside code spans and fences", () => {
    expect(renderSlackMrkdwn("`a < b & c`")).toBe("`a &lt; b &amp; c`");
    expect(renderSlackMrkdwn("```\na < b & c\n```")).toBe("```\na &lt; b &amp; c\n```");
  });

  it("renders a markdown link as a Slack <url|label> link", () => {
    expect(renderSlackMrkdwn("see [docs](https://example.com)")).toBe(
      "see <https://example.com|docs>",
    );
  });

  it("renders bold, italic, and strikethrough", () => {
    expect(renderSlackMrkdwn("**bold** _em_ ~~strike~~")).toBe("*bold* _em_ ~strike~");
  });

  it("keeps a literal backslash the agent typed", () => {
    expect(renderSlackMrkdwn("use C:\\Users\\me")).toBe("use C:\\Users\\me");
  });

  it("escapes raw & and < in plain text (> needs no escaping in mrkdwn)", () => {
    expect(renderSlackMrkdwn("1 < 2 & 3 > 0")).toBe("1 &lt; 2 &amp; 3 > 0");
  });

  it("passes Slack native tokens through unescaped (the decided-state mention)", () => {
    expect(renderSlackMrkdwn("<@U8ZTVGJJF> ✅ Approved CodexBash")).toBe(
      "<@U8ZTVGJJF> ✅ Approved CodexBash",
    );
    expect(renderSlackMrkdwn("<!here> heads up")).toBe("<!here> heads up");
    expect(renderSlackMrkdwn("<#C07U0LDK6ER|general>")).toBe("<#C07U0LDK6ER|general>");
    expect(renderSlackMrkdwn("<https://x.com|link>")).toBe("<https://x.com|link>");
  });

  it("preserves entities already escaped by Slack", () => {
    expect(renderSlackMrkdwn("echo &lt;ready&gt; &amp; done")).toBe("echo &lt;ready> &amp; done");
  });

  it("does not mistake prose angle-brackets for Slack tokens", () => {
    expect(renderSlackMrkdwn("Use <div> and <@bot>")).toBe("Use &lt;div> and &lt;@bot>");
  });

  it("renders bullet and ordered lists", () => {
    expect(renderSlackMrkdwn("- one\n- two\n\n1. a\n2. b")).toBe("- one\n- two\n\n1. a\n2. b");
  });

  it("renders blockquotes with the > prefix on every line", () => {
    expect(renderSlackMrkdwn("> a quote\n> more")).toBe("> a quote\n> more");
  });

  it("keeps a single-line plain message byte-identical", () => {
    expect(renderSlackMrkdwn("plain answer")).toBe("plain answer");
  });
});
