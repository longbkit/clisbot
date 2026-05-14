import { describe, expect, test } from "bun:test";
import {
  appendInteractionText,
  cleanInteractionSnapshot,
  cleanRunningInteractionSnapshot,
  deriveBoundedRunningRewritePreview,
  deriveLatestPromptInteractionSnapshot,
  deriveLatestPromptRunningInteractionSnapshot,
  deriveMeaningfulPaneSnapshot,
  deriveInteractionText,
  deriveRunningInteractionText,
  extractFinalAnswer,
  extractRenderedIncrement,
  mergeRenderedStreamBodies,
  renderMarkdownInteraction,
  renderChannelSnapshot,
  renderPlainInteraction,
  selectCompletedInteractionBody,
  selectSnapshotInteractionBody,
  truncateHead,
} from "../../src/runners/transcript/index.ts";

describe("snapshot shaping", () => {
  test("returns a bounded tail excerpt for an initial snapshot while preserving the full snapshot", () => {
    const snapshot = ["one", "two", "three", "four", "five"].join("\n");
    const shaped = deriveMeaningfulPaneSnapshot({
      snapshot,
      maxLines: 3,
    });

    expect(shaped.hasMeaningfulChange).toBe(true);
    expect(shaped.fullSnapshot).toBe(snapshot);
    expect(shaped.displaySnapshot).toBe(["...", "three", "four", "five"].join("\n"));
  });

  test("focuses updates on the changed pane region instead of replaying the whole pane", () => {
    const previousSnapshot = [
      "header",
      "task: scanning repo",
      "step 1",
      "step 2",
      "ready",
    ].join("\n");
    const snapshot = [
      "header",
      "task: scanning repo",
      "step 1",
      "step 2",
      "running command",
      "ready",
    ].join("\n");

    const shaped = deriveMeaningfulPaneSnapshot({
      previousSnapshot,
      snapshot,
      contextLines: 1,
      maxLines: 4,
    });

    expect(shaped.hasMeaningfulChange).toBe(true);
    expect(shaped.fullSnapshot).toBe(snapshot);
    expect(shaped.displaySnapshot).toBe(["...", "step 2", "running command", "ready"].join("\n"));
  });

  test("keeps the remaining context when later pane lines disappear", () => {
    const shaped = deriveMeaningfulPaneSnapshot({
      previousSnapshot: ["line 1", "line 2", "line 3"].join("\n"),
      snapshot: "line 1",
    });

    expect(shaped.hasMeaningfulChange).toBe(true);
    expect(shaped.fullSnapshot).toBe("line 1");
    expect(shaped.displaySnapshot).toBe("line 1");
  });

  test("strips codex chrome while keeping meaningful content", () => {
    const cleaned = cleanInteractionSnapshot(`
Welcome to Codex, OpenAI's command-line coding agent

› list all files

  in this workspace please

  gpt-5.4 high · 97% left · ~/.clisbot/workspaces/default

╭────────────────────────────────────────────╮
│ >_ OpenAI Codex (v0.118.0)                 │
│                                            │
│ model:     gpt-5.4 high   /model to change │
│ directory: ~/.clisbot/workspaces/default │
╰────────────────────────────────────────────╯

  Tip: New Build faster with the Codex App.

• I'm listing the files in the current workspace.
• No files are present in /Users/longluong/.clisbot/workspaces/default.
    `);

    expect(cleaned).not.toContain("OpenAI Codex");
    expect(cleaned).not.toContain("Tip:");
    expect(cleaned).not.toContain("› list all files");
    expect(cleaned).not.toContain("in this workspace please");
    expect(cleaned).toContain("I'm listing the files in the current workspace.");
    expect(cleaned).toContain("No files are present");
  });

  test("derives only the current interaction text relative to the baseline pane", () => {
    const baseline = `
› hello

• Fine.
    `;
    const current = `
› hello

• Fine.

› list all files

• I'm listing the files in the current workspace.
• No files are present in /Users/longluong/.clisbot/workspaces/default.
    `;

    const derived = deriveInteractionText(baseline, current);
    expect(derived).not.toContain("Fine.");
    expect(derived).toContain("I'm listing the files in the current workspace.");
    expect(derived).toContain("No files are present");
  });

  test("derives only newly appended content when the pane scrolls", () => {
    const baseline = `
What changed today vs. yesterday

- Today: commentary.
- Yesterday: launch summaries.

If you want, I can turn this into a short table.
    `;
    const current = `
- Today: commentary.
- Yesterday: launch summaries.

If you want, I can turn this into a short table.

# Gemma 4 Coverage: April 4 vs April 3, 2026

On April 4, 2026, coverage was mostly follow-on analysis.

- Today focused on licensing.
- Yesterday focused on launch facts.
    `;

    expect(deriveInteractionText(baseline, current)).toBe(
      [
        "# Gemma 4 Coverage: April 4 vs April 3, 2026",
        "",
        "On April 4, 2026, coverage was mostly follow-on analysis.",
        "",
        "- Today focused on licensing.",
        "- Yesterday focused on launch facts.",
      ].join("\n"),
    );
  });

  test("derives newly appended content when the old snapshot appears later in the current pane", () => {
    const baseline = `
older context
What changed today vs. yesterday

- Today: commentary.
- Yesterday: launch summaries.

If you want, I can turn this into a short table.
    `;
    const current = `
stale header line
older context
What changed today vs. yesterday

- Today: commentary.
- Yesterday: launch summaries.

If you want, I can turn this into a short table.

# Repo Overview

This project maps channel messages into tmux-backed agents.
    `;

    expect(deriveInteractionText(baseline, current)).toBe(
      ["# Repo Overview", "", "This project maps channel messages into tmux-backed agents."].join(
        "\n",
      ),
    );
  });

  test("derives the current codex prompt tail without older pane content", () => {
    const snapshot = [
      "Previous answer from an older request.",
      "",
      "Done.",
      "",
      "› new request",
      "",
      "New draft line.",
      "",
      "• Working... (2m 4s • esc to interrupt)",
    ].join("\n");

    expect(deriveLatestPromptRunningInteractionSnapshot(snapshot)).toBe(
      ["New draft line.", "", "• Working... (2m 4s • esc to interrupt)"].join("\n"),
    );
    expect(deriveLatestPromptInteractionSnapshot(snapshot)).toBe("New draft line.");
  });

  test("deriveRunningInteractionText ignores pane redraw content that is not a real append", () => {
    const previous = [
      "Em đã thêm regression test cho cả 2 case trên. Verify đã pass:",
      "- `bun test test/text/text.test.ts test/interaction-processing/interaction-processing.test.ts`",
      "- `bun x tsc --noEmit`",
    ].join("\n");
    const current = [
      "732 + }); 733 + 734 test(\"completed interaction truncation preserves the beginning of the final answer\", () => {",
      "- `bun x tsc --noEmit`",
    ].join("\n");

    expect(deriveRunningInteractionText(previous, current)).toBe("");
  });

  test("deriveRunningInteractionText keeps only appended text when the pane window shifts", () => {
    const previous = ["line 1", "line 2", "line 3"].join("\n");
    const current = ["older line", "line 1", "line 2", "line 3", "line 4"].join("\n");

    expect(deriveRunningInteractionText(previous, current)).toBe("line 4");
  });

  test("appendInteractionText keeps cumulative output without duplicating the overlap", () => {
    expect(
      appendInteractionText(
        ["line 1", "line 2"].join("\n"),
        ["line 2", "line 3"].join("\n"),
      ),
    ).toBe(["line 1", "line 2", "line 3"].join("\n"));
  });

  test("deriveBoundedRunningRewritePreview keeps unchanged context for a small rewrite", () => {
    const previous = [
      "Reviewing the code path.",
      "The queue renderer owns the visible state.",
      "Working... 1s",
    ].join("\n");
    const current = [
      "Reviewing the code path.",
      "The queue renderer owns the visible state.",
      "Working... 2s",
    ].join("\n");

    expect(
      deriveBoundedRunningRewritePreview({
        previousSnapshot: previous,
        snapshot: current,
        maxLines: 8,
      }),
    ).toBe(current);
  });

  test("deriveBoundedRunningRewritePreview keeps the latest full-context tail for a large rewrite", () => {
    const previous = ["draft 1", "draft 2"].join("\n");
    const current = [
      "final 1",
      "final 2",
      "final 3",
      "final 4",
      "final 5",
    ].join("\n");

    expect(
      deriveBoundedRunningRewritePreview({
        previousSnapshot: previous,
        snapshot: current,
        maxLines: 2,
      }),
    ).toBe([
      "...[3 more lines]",
      "final 4",
      "final 5",
    ].join("\n"));
  });

  test("deriveBoundedRunningRewritePreview suppresses delete-only rewrites", () => {
    const previous = ["final 1", "final 2", "final 3", "final 4"].join("\n");
    const current = ["final 1", "final 2", "final 3"].join("\n");

    expect(
      deriveBoundedRunningRewritePreview({
        previousSnapshot: previous,
        snapshot: current,
        maxLines: 2,
      }),
    ).toBe("");
  });

});
