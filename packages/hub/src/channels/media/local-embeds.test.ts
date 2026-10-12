import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { localMediaKey, rewriteLocalEmbeds, sendMediaKeys } from "./local-embeds.js";

const REPORTED =
  "![Image](file:///home/sandbox/.clisbot/workspaces/default/artifacts/docs/its-24683-scoring/po-dev-effort-20261012.png)";
const NOTICE = "[Image not attached: po-dev-effort-20261012.png]";

describe("rewriteLocalEmbeds", () => {
  it("turns the reported image-only answer into a short notice naming the file", () => {
    assert.equal(rewriteLocalEmbeds(REPORTED), NOTICE);
  });

  it("keeps the answer around an embed, and drops one the message tool already posted", () => {
    const answer = `Scores are in.\n\n${REPORTED}\n\nPO effort is highest.`;
    assert.equal(
      rewriteLocalEmbeds(answer),
      `Scores are in.\n\n${NOTICE}\n\nPO effort is highest.`,
    );
    const delivered = new Set([
      "/home/sandbox/.clisbot/workspaces/default/artifacts/docs/its-24683-scoring/po-dev-effort-20261012.png",
    ]);
    assert.equal(
      rewriteLocalEmbeds(answer, { delivered }),
      "Scores are in.\n\nPO effort is highest.",
    );
    assert.equal(rewriteLocalEmbeds(REPORTED, { delivered }), "");
  });

  it("rewrites plain and angle-bracket local targets and file links, never remote images", () => {
    assert.equal(rewriteLocalEmbeds("![chart](/tmp/a b.png)"), "![chart](/tmp/a b.png)");
    assert.equal(rewriteLocalEmbeds("![chart](</tmp/a b.png>)"), "[Image not attached: a b.png]");
    // Only file: URLs and absolute paths: a relative target is left as written.
    assert.equal(rewriteLocalEmbeds("![x](artifacts/x.png)"), "![x](artifacts/x.png)");
    assert.equal(rewriteLocalEmbeds("![x](~/out/x.png)"), "[Image not attached: x.png]");
    assert.equal(
      rewriteLocalEmbeds("See [the report](file:///w/report.pdf)."),
      "See the report [file not attached: report.pdf].",
    );
    const remote = "![logo](https://example.com/logo.png) and [docs](https://example.com)";
    assert.equal(rewriteLocalEmbeds(remote), remote);
  });

  it("leaves plain paths, code and quoted lines alone", () => {
    const text = [
      "The file is at /home/me/out.png and file:///home/me/out.png.",
      "Use `![x](file:///a.png)` in the app.",
      "```md",
      "![x](file:///a.png)",
      "```",
      "> ![x](file:///quoted.png)",
    ].join("\n");
    assert.equal(rewriteLocalEmbeds(text), text);
  });

  it("holds back an embed still being streamed, so a split URL never shows", () => {
    const final = `Here:\n${REPORTED}\nDone.`;
    const drafts = [];
    for (let end = 1; end <= final.length; end += 7) {
      drafts.push(rewriteLocalEmbeds(final.slice(0, end), { partial: true }));
    }
    for (const draft of drafts) assert.equal(draft.includes("file:"), false, draft);
    assert.ok(drafts.some((draft) => draft.startsWith("Here:")));
    // The last draft and the final post read the same.
    assert.equal(rewriteLocalEmbeds(final, { partial: true }), rewriteLocalEmbeds(final));
    assert.equal(rewriteLocalEmbeds(final), `Here:\n${NOTICE}\nDone.`);
  });

  it("does not hold back an https image or ordinary brackets in a draft", () => {
    assert.equal(
      rewriteLocalEmbeds("see ![a](https://x.io/a.p", { partial: true }),
      "see ![a](https://x.io/a.p",
    );
    assert.equal(rewriteLocalEmbeds("a list [1]", { partial: true }), "a list [1]");
  });
});

describe("rewriteLocalEmbeds review regressions", () => {
  it("a final answer cut off inside an embed shows the notice, never the URL", () => {
    assert.equal(
      rewriteLocalEmbeds("Here: ![x](file:///tmp/chart.png"),
      "Here: [Image not attached: chart.png]",
    );
    assert.equal(
      rewriteLocalEmbeds("See [report](file:///tmp/r.pdf"),
      "See report [file not attached: r.pdf]",
    );
    // A remote image cut off is left as written.
    assert.equal(rewriteLocalEmbeds("![x](https://x.io/a.png"), "![x](https://x.io/a.png");
  });

  it("keeps a filename with balanced parentheses and the text after it", () => {
    assert.equal(
      rewriteLocalEmbeds("![x](file:///tmp/chart(1).png) next"),
      "[Image not attached: chart(1).png] next",
    );
    assert.equal(
      rewriteLocalEmbeds('![x](</tmp/my chart.png> "title") ok'),
      "[Image not attached: my chart.png] ok",
    );
  });

  it("leaves a four-backtick fence holding a three-backtick line as written", () => {
    const text = ["````md", "```", "![x](file:///a.png)", "```", "````", "after"].join("\n");
    assert.equal(rewriteLocalEmbeds(text), text);
    const tilde = ["~~~", "```", "![x](file:///a.png)", "~~~"].join("\n");
    assert.equal(rewriteLocalEmbeds(tilde), tilde);
  });

  it("leaves indented code as written, but not an indented paragraph continuation", () => {
    const code = ["Example:", "", "    ![x](file:///a.png)", "", "Done."].join("\n");
    assert.equal(rewriteLocalEmbeds(code), code);
    assert.equal(
      rewriteLocalEmbeds("Chart below\n    ![x](file:///a.png)"),
      "Chart below\n    [Image not attached: a.png]",
    );
  });
});

describe("rewriteLocalEmbeds code spans", () => {
  it("leaves a double-backtick span holding a single backtick as written", () => {
    const text = "Use ``a ` ![x](file:///tmp/a.png)`` as text.";
    assert.equal(rewriteLocalEmbeds(text), text);
    assert.equal(rewriteLocalEmbeds(text, { partial: true }), text);
  });

  it("leaves a code span that crosses lines as written", () => {
    const text = "Use `example\n![x](file:///tmp/a.png)\nend` here.";
    assert.equal(rewriteLocalEmbeds(text), text);
    assert.equal(rewriteLocalEmbeds(text, { partial: true }), text);
  });

  it("still rewrites around a span, and after a backtick run that never closes", () => {
    assert.equal(
      rewriteLocalEmbeds("`code` then ![x](file:///tmp/a.png)"),
      "`code` then [Image not attached: a.png]",
    );
    // A final answer: an unclosed run is literal text, so the embed after it is prose.
    assert.equal(
      rewriteLocalEmbeds("a ` b ![x](file:///tmp/a.png)"),
      "a ` b [Image not attached: a.png]",
    );
    // A span does not cross a blank line.
    assert.equal(
      rewriteLocalEmbeds("open `\n\n![x](file:///tmp/a.png) `"),
      "open `\n\n[Image not attached: a.png] `",
    );
  });

  it("a draft keeps a span still being streamed as typed, and the final agrees once it closes", () => {
    const final = "Try `![x](file:///tmp/a.png)` in the app.";
    for (let end = 1; end <= final.length; end += 1) {
      const draft = rewriteLocalEmbeds(final.slice(0, end), { partial: true });
      assert.ok(final.startsWith(draft), draft);
    }
    assert.equal(rewriteLocalEmbeds(final), final);
  });
});

describe("sendMediaKeys", () => {
  it("collects local files from every send media param, never remote ones", () => {
    assert.deepEqual(
      sendMediaKeys({
        media: "file:///w/a.png",
        attachments: [{ media: "/w/b.pdf" }, { path: "/w/c.png" }, "/w/d.png"],
        mediaUrls: ["https://x.io/e.png"],
      }),
      ["/w/a.png", "/w/b.pdf", "/w/c.png", "/w/d.png"],
    );
    assert.equal(localMediaKey("file:///w/a%20b.png"), "/w/a b.png");
    assert.equal(localMediaKey("data:image/png;base64,AA"), null);
    assert.equal(localMediaKey("C:\\w\\a.png"), "C:\\w\\a.png");
  });
});
