import { describe, expect, test } from "bun:test";
import {
  appendInteractionText,
  cleanInteractionSnapshot,
  cleanRunningInteractionSnapshot,
  deriveBoundedRunningRewritePreview,
  deriveMeaningfulPaneSnapshot,
  deriveInteractionText,
  deriveRunningInteractionText,
  extractFinalAnswer,
  extractSlackIncrement,
  mergeSlackStreamBodies,
  renderSlackInteraction,
  renderSlackSnapshot,
  renderTelegramInteraction,
  selectSlackCompletionBody,
  selectSlackSnapshotBody,
  truncateHead,
} from "../src/shared/transcript.ts";

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

  test("deriveRunningInteractionText ignores pane redraw content that is not a real append", () => {
    const previous = [
      "Em đã thêm regression test cho cả 2 case trên. Verify đã pass:",
      "- `bun test test/text.test.ts test/interaction-processing.test.ts`",
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

  test("unwraps soft-wrapped tmux lines into cleaner Slack text", () => {
    const cleaned = cleanInteractionSnapshot(`
• As of April 4, 2026, I’m not seeing a new official Google update on Gemma 4
  today. The main official launch was on April 2, 2026, and April 3 had broader
  media pickup.
    `);

    expect(cleaned).toContain(
      "• As of April 4, 2026, I’m not seeing a new official Google update on Gemma 4 today. The main official launch was on April 2, 2026, and April 3 had broader media pickup.",
    );
    expect(cleaned).not.toContain("\n  today.");
  });

  test("unwraps codex markdown blocks into direct markdown text", () => {
    const cleaned = cleanInteractionSnapshot(`
› compare Gemma 4 coverage

• # Gemma 4 Coverage: April 4 vs April 3, 2026

  On April 4, 2026, Gemma 4 coverage was mostly follow-on analysis.

  - Today focused on licensing and local deployment.
  - Yesterday focused on launch facts.

  ## Sources

  - Google blog

  (https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/)
    `);

    expect(cleaned).toStartWith("# Gemma 4 Coverage: April 4 vs April 3, 2026");
    expect(cleaned).toContain("## Sources");
    expect(cleaned).toContain(
      "- Google blog (https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/)",
    );
    expect(cleaned).not.toContain("• # Gemma");
  });

  test("joins wrapped word fragments without inserting spaces", () => {
    const cleaned = cleanInteractionSnapshot(`
• - Bun’s latest stable release is v1.3.11, according to the official Bun homep
    age: https://bun.sh/
  - Node.js’s latest LTS major version is 24 (Krypton), and the latest release
    in that LTS line is v24.14.1.
    `);

    expect(cleaned).toContain("official Bun homepage: https://bun.sh/");
    expect(cleaned).toContain("Node.js’s latest LTS major version");
    expect(cleaned).not.toContain("homep age");
  });

  test("drops codex footer timing lines", () => {
    const cleaned = cleanInteractionSnapshot(`
› search the web

• Searching the web

• Working (11s • esc to interrupt)

4s esc to interrupt

• Final answer.
    `);

    expect(cleaned).toContain("• Searching the web");
    expect(cleaned).toContain("• Final answer.");
    expect(cleaned).not.toContain("esc to interrupt");
  });

  test("drops wrapped interrupt status footer lines during running snapshots", () => {
    const cleaned = cleanInteractionSnapshot(`
› explain this codebase

• Exploring the workspace

◦ Working (3s • esc to interrupt)

5s • esc to interrupt)

8s • esc to interrupt)

• The workspace contains a Bun service and tmux-backed runner integration.
    `);

    expect(cleaned).toContain("• Exploring the workspace");
    expect(cleaned).toContain("• The workspace contains a Bun service and tmux-backed runner integration.");
    expect(cleaned).not.toContain("Working (3s");
    expect(cleaned).not.toContain("5s • esc to interrupt");
    expect(cleaned).not.toContain("8s • esc to interrupt");
  });

  test("keeps codex timer lines in running snapshots", () => {
    const cleaned = cleanRunningInteractionSnapshot(`
› explain this codebase

• Exploring the workspace

◦ Working (3m 12s • esc to interrupt)

• The workspace contains a Bun service and tmux-backed runner integration.
    `);

    expect(cleaned).toContain("• Exploring the workspace");
    expect(cleaned).toContain("• The workspace contains a Bun service and tmux-backed runner integration.");
    expect(cleaned).toContain("Working (3m 12s • esc to interrupt)");
  });

  test("strips gemini chrome while keeping meaningful content", () => {
    const cleaned = cleanInteractionSnapshot(`
 ▝▜▄     Gemini CLI v0.37.1
   ▝▜▄
  ▗▟▀    Signed in with Google /auth
 ▝▀      Plan: Gemini Code Assist for individuals /upgrade

╭──────────────────────────────────────────────────────────────────────────────╮
│ We're making changes to Gemini CLI that may impact your workflow.            │
│ What's Changing: We are adding more robust detection of policy-violating use │
│ cases and restricting models for free tier users.                            │
│ How it affects you: If you need use of Gemini pro models you will need to    │
│ upgrade to a supported paid plan.                                            │
│ Read more: https://goo.gle/geminicli-updates                                 │
╰──────────────────────────────────────────────────────────────────────────────╯

> say hi in one word

⠼ Thinking... (esc to cancel, 56s)                             ? for shortcuts
────────────────────────────────────────────────────────────────────────────────
 YOLO Ctrl+Y                                                           6 skills
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
 *   Type your message or @path/to/file
▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
 workspace (/directory)      branch      sandbox                         /model
 ~/projects/clisbot          main        no sandbox      gemini-3-flash-preview

Hi
    `);

    expect(cleaned).toBe("Hi");
  });

  test("drops gemini timer lines with minute precision from settled snapshots", () => {
    const cleaned = cleanInteractionSnapshot(`
 ▝▜▄     Gemini CLI v0.37.1

> say hi in one word

Thinking... (esc to cancel, 3m 12s)

Hi
    `);

    expect(cleaned).toBe("Hi");
  });

  test("strips Gemini trust-screen chrome while keeping the answer", () => {
    const cleaned = cleanInteractionSnapshot(`
 ▝▜▄     Gemini CLI v0.37.1

Skipping project agents due to untrusted folder. To enable, ensure that the project root is trusted.

Do you trust the files in this folder?

Trusting a folder allows Gemini CLI to load its local configurations, including custom commands, hooks, MCP servers, agent skills, and settings. These configurations could execute code on your behalf or change the behavior of the CLI.

1. Trust folder (default)
2. Trust parent folder (workspaces)
3. Don't trust

Trusted. Ready.

Hi
    `);

    expect(cleaned).toBe("Trusted. Ready.\n\nHi");
  });

  test("strips claude chrome and prompt echo while keeping the answer", () => {
    const cleaned = cleanInteractionSnapshot(`
╭─── Claude Code v2.1.92 ───────────────────────────────────────────────────────────────────╮
│                                    │ Tips for getting started                             │
│            Welcome back!           │ Ask Claude to create a new app or clone a repository │
│                                    │ ──────────────────────────────────────────────────── │
│               ▐▛███▜▌              │ Recent activity                                      │
│              ▝▜█████▛▘             │ No recent activity                                   │
│                ▘▘ ▝▝               │                                                      │
│                                    │                                                      │
│   Sonnet 4.6 · API Usage Billing   │                                                      │
│   ~/.clisbot/workspaces/claude   │                                                      │
╰───────────────────────────────────────────────────────────────────────────────────────────╯

❯ reply with exactly PONG and nothing else.

⏺ PONG

──────────────────────────────────────────────────────────────────────────────────────────────
❯
──────────────────────────────────────────────────────────────────────────────────────────────
   Sonnet 4.6 | claude | 164 (23%) | $0.01 | 11s                          ◐ medium · /effort
  ⏵⏵ bypass permissions on (shift+tab to cycle)
    `);

    expect(cleaned).toBe("PONG");
  });

  test("drops claude progress noise during running snapshots", () => {
    const cleaned = cleanInteractionSnapshot(`
 ▐▛███▜▌   Claude Code v2.1.92
▝▜█████▛▘  Sonnet 4.6 · API Usage Billing
  ▘▘ ▝▝    ~/.clisbot/workspaces/claude

❯ hi em

Burrowing

Read 7 files, recalled 1 memory (ctrl+o to expand)

AGENTS.md

⏺ chào em. anh đây.

──────────────────────────────────────────────────────────────────────────────────────────────
❯
──────────────────────────────────────────────────────────────────────────────────────────────
   Sonnet 4.6 | claude | 78.0K (29%) | $0.27 | 24s                1 MCP server failed · /mcp
  ⏵⏵ bypass permissions on (shift+tab to cycle)
    `);

    expect(cleaned).toBe("chào em. anh đây.");
  });

  test("drops claude worked-for footer lines from settled snapshots", () => {
    const cleaned = cleanInteractionSnapshot(`
 ▐▛███▜▌   Claude Code v2.1.92
▝▜█████▛▘  Sonnet 4.6 · API Usage Billing
  ▘▘ ▝▝    ~/.clisbot/workspaces/claude

⏺ item 089: abcdefghijklmnopqrstuvwxyz
  item 090: abcdefghijklmnopqrstuvwxyz

Worked for 36s
    `);

    expect(cleaned).toBe(
      ["item 089: abcdefghijklmnopqrstuvwxyz", "item 090: abcdefghijklmnopqrstuvwxyz"].join("\n"),
    );
  });

  test("drops claude worked-for footer lines with minute precision from settled snapshots", () => {
    const cleaned = cleanInteractionSnapshot(`
 ▐▛███▜▌   Claude Code v2.1.92
▝▜█████▛▘  Sonnet 4.6 · API Usage Billing
  ▘▘ ▝▝    ~/.clisbot/workspaces/claude

⏺ item 089: abcdefghijklmnopqrstuvwxyz
  item 090: abcdefghijklmnopqrstuvwxyz

Worked for 3m 12s
    `);

    expect(cleaned).toBe(
      ["item 089: abcdefghijklmnopqrstuvwxyz", "item 090: abcdefghijklmnopqrstuvwxyz"].join("\n"),
    );
  });

  test("drops claude cooked-for footer lines from settled snapshots", () => {
    const cleaned = cleanInteractionSnapshot(`
 ▐▛███▜▌   Claude Code v2.1.92
▝▜█████▛▘  Sonnet 4.6 · API Usage Billing
  ▘▘ ▝▝    ~/.clisbot/workspaces/claude

⏺ item 089: abcdefghijklmnopqrstuvwxyz
  item 090: abcdefghijklmnopqrstuvwxyz

✻ Cooked for 50s
    `);

    expect(cleaned).toBe(
      ["item 089: abcdefghijklmnopqrstuvwxyz", "item 090: abcdefghijklmnopqrstuvwxyz"].join("\n"),
    );
  });

  test("keeps claude worked-for footer lines in running snapshots", () => {
    const cleaned = cleanRunningInteractionSnapshot(`
 ▐▛███▜▌   Claude Code v2.1.92
▝▜█████▛▘  Sonnet 4.6 · API Usage Billing
  ▘▘ ▝▝    ~/.clisbot/workspaces/claude

⏺ item 089: abcdefghijklmnopqrstuvwxyz
  item 090: abcdefghijklmnopqrstuvwxyz

Worked for 3m 12s
    `);

    expect(cleaned).toContain("item 089: abcdefghijklmnopqrstuvwxyz");
    expect(cleaned).toContain("Worked for 3m 12s");
  });

  test("keeps claude tool progress detail but strips ui-only hints", () => {
    const cleaned = cleanInteractionSnapshot(`
 ▐▛███▜▌   Claude Code v2.1.92
▝▜█████▛▘  Sonnet 4.6 · API Usage Billing
  ▘▘ ▝▝    ~/.clisbot/workspaces/claude

❯ tìm tin tức việt nam

⏺ web-explorer(gather Vietnam news)
  ⎿  Initializing…
     (ctrl+b ctrl+b (twice) to run in background)

· Flummoxing… (30s · ↓ 476 tokens · thought for 4s)
    `);

    expect(cleaned).toBe(
      [
        "web-explorer(gather Vietnam news)",
        "Initializing…",
        "",
        "• Flummoxing… (30s · ↓ 476 tokens · thought for 4s)",
      ].join("\n"),
    );
  });

  test("keeps claude tool lines after the prompt instead of stripping them as prompt continuation", () => {
    const cleaned = cleanInteractionSnapshot(`
 ▐▛███▜▌   Claude Code v2.1.92
▝▜█████▛▘  Sonnet 4.6 · API Usage Billing
  ▘▘ ▝▝    ~/.clisbot/workspaces/claude

❯ tìm tin tức việt nam

  Read 7 files (ctrl+o to expand)

  Web Search("tin tức Việt Nam hôm nay 2026")

✽ Effecting… (thought for 3s)
    `);

    expect(cleaned).toBe(
      ['Web Search("tin tức Việt Nam hôm nay 2026")', "", "✽ Effecting… (thought for 3s)"].join(
        "\n",
      ),
    );
  });

  test("drops wrapped claude prompt continuation lines before the first blank separator", () => {
    const cleaned = cleanInteractionSnapshot(`
 ▐▛███▜▌   Claude Code v2.1.92
▝▜█████▛▘  Sonnet 4.6 · API Usage Billing
  ▘▘ ▝▝    ~/.clisbot/workspaces/claude

❯ Reply with exactly 120 lines. Each line must be in the format \`item NNN:
abcdefghijklmnopqrstuvwxyz\` where NNN starts at 001 and increments by 1. No intro. No code
fence. No extra text.

⏺ item 001: abcdefghijklmnopqrstuvwxyz
  item 002: abcdefghijklmnopqrstuvwxyz
    `);

    expect(cleaned).toBe(
      ["item 001: abcdefghijklmnopqrstuvwxyz", "item 002: abcdefghijklmnopqrstuvwxyz"].join("\n"),
    );
  });

  test("treats standalone claude gerund progress frames as non-meaningful output", () => {
    const cleaned = cleanInteractionSnapshot(`
 ▐▛███▜▌   Claude Code v2.1.92
▝▜█████▛▘  Sonnet 4.6 · API Usage Billing
  ▘▘ ▝▝    ~/.clisbot/workspaces/claude

❯ hi em

Scampering

:eight_spoked_asterisk: Tomfoolering

Searched for 1 pattern, read 5 files (ctrl+o to expand)
    `);

    expect(cleaned).toBe("");
  });

  test("collapses duplicated progress redraw lines inside one cleaned snapshot", () => {
    const cleaned = cleanInteractionSnapshot(`
✽ Finagling

Finagling

Finagling

Finagling
    `);

    expect(cleaned).toBe("✽ Finagling");
  });

  test("renders metadata and truncated snapshot", () => {
    const rendered = renderSlackSnapshot({
      agentId: "default",
      sessionName: "default",
      workspacePath: "/tmp/workspace",
      status: "running",
      snapshot: "a".repeat(5000),
      maxChars: 100,
    });

    expect(rendered).toContain("agent: default");
    expect(rendered).toContain("status: running");
    expect(rendered).toContain("```");
    expect(rendered.length).toBeLessThan(4300);
  });

  test("renders chat-first Slack interaction text without metadata", () => {
    expect(
      renderSlackInteraction({
        status: "queued",
        content: "",
        maxChars: 200,
        queuePosition: 2,
      }),
    ).toBe("_Queued: 2 ahead._");

    expect(
      renderSlackInteraction({
        status: "running",
        content: "Thinking...\nFound the issue.",
        maxChars: 200,
      }),
    ).toBe("Thinking...\nFound the issue.\n\n_Working..._");

    expect(
      renderTelegramInteraction({
        status: "running",
        content: "Thinking...\nFound the issue.",
        maxChars: 200,
      }),
    ).toBe("Thinking...\nFound the issue.\n\nWorking...");

    expect(
      renderSlackInteraction({
        status: "detached",
        content: "Still working through the repository.",
        maxChars: 200,
        note:
          "This session has been running for over 15 minutes. clisbot left it running and will post the final result here when it completes. Use `/attach` for live updates, `/watch every <duration>` for periodic updates, or `/stop` to interrupt it.",
        allowTranscriptInspection: true,
      }),
    ).toBe(
      "Still working through the repository.\n\n_This session has been running for over 15 minutes. clisbot left it running and will post the final result here when it completes. Use `/attach` for live updates, `/watch every <duration>` for periodic updates, or `/stop` to interrupt it. You can also use `/transcript` to inspect the current session snapshot._",
    );
  });

  test("does not append a second generic error footer when the body already starts with Error", () => {
    expect(
      renderSlackInteraction({
        status: "error",
        content: "Error: Runtime stopped before the active run finished startup.",
        maxChars: 200,
      }),
    ).toBe("Error: Runtime stopped before the active run finished startup.");

    expect(
      renderTelegramInteraction({
        status: "error",
        content: "Error: Runtime stopped before the active run finished startup.",
        maxChars: 200,
      }),
    ).toBe("Error: Runtime stopped before the active run finished startup.");
  });

  test("renders concise unlabeled errors as a single Error line", () => {
    expect(
      renderSlackInteraction({
        status: "error",
        content: "Runtime stopped before the active run finished startup.",
        maxChars: 200,
      }),
    ).toBe("Error: Runtime stopped before the active run finished startup.");

    expect(
      renderTelegramInteraction({
        status: "error",
        content: "Runtime stopped before the active run finished startup.",
        maxChars: 200,
      }),
    ).toBe("Error: Runtime stopped before the active run finished startup.");
  });

  test("keeps detached note transcript-free when transcript inspection is disabled", () => {
    expect(
      renderSlackInteraction({
        status: "detached",
        content: "Still working through the repository.",
        maxChars: 200,
        note:
          "This session has been running for over 15 minutes. clisbot left it running and will post the final result here when it completes. Use `/attach` for live updates, `/watch every <duration>` for periodic updates, or `/stop` to interrupt it.",
        allowTranscriptInspection: false,
      }),
    ).toBe(
      "Still working through the repository.\n\n_This session has been running for over 15 minutes. clisbot left it running and will post the final result here when it completes. Use `/attach` for live updates, `/watch every <duration>` for periodic updates, or `/stop` to interrupt it._",
    );
  });

  test("extracts the final answer and drops leading progress blocks on completion", () => {
    const extracted = extractFinalAnswer(`
• I’m checking the latest web results for Gemma 4 and comparing coverage from April 4, 2026 versus April 3, 2026.

• Searching the web

• Searched Gemma 4 news April 4 2026

• Searching the web

• Searched Reuters Gemma 4 April 2026

• As of April 4, 2026, I’m not seeing a new official Google update on Gemma 4 today.

What changed today vs. yesterday

- Today: mostly follow-on analysis.
- Yesterday: broader launch coverage.
    `);

    expect(extracted).toStartWith("• As of April 4, 2026");
    expect(extracted).not.toContain("Searching the web");
    expect(extracted).not.toContain("I’m checking the latest web results");
  });

  test("extracts the final answer and drops standalone claude gerund progress blocks", () => {
    const extracted = extractFinalAnswer(`
Determining

PONG
    `);

    expect(extracted).toBe("PONG");
  });

  test("extracts a codex single-line final answer without the assistant bullet prefix", () => {
    const extracted = extractFinalAnswer(`
› Reply with exactly PONG and nothing else.

• PONG
    `);

    expect(extracted).toBe("PONG");
  });

  test("extracts the final answer and drops codex tool and file blocks on completion", () => {
    const extracted = extractFinalAnswer(`
Mình đang nạp context của workspace trước đã: đọc SOUL.md, USER.md, các memory gần đây, rồi
sẽ trả lời trong đúng ngữ cảnh của phiên này.

Ran pwd
 /Users/longluong/.clisbot/workspace/default

Explored List ls -1

Ran for f in SOUL.md USER.md MEMORY.md memory/2026-04-05.md memory/2026-04-04.md
 FILE:SOUL.md --- 125 lines

_Good luck out there. Make it count._

Hey. Anh vừa lên phiên này nên đang ở trạng thái fresh.

Trong workspace này còn BOOTSTRAP.md, nghĩa là mình đang ở lần khởi động đầu. Nên câu đầu
tiên đúng ra là: mình là ai, còn em là ai?

Cho anh 2 mẩu là đủ để bắt đầu:

1. Em muốn gọi anh là gì?
2. Anh nên gọi em là gì?
    `);

    expect(extracted).toStartWith("Hey. Anh vừa lên phiên này");
    expect(extracted).toContain("Cho anh 2 mẩu là đủ để bắt đầu:");
    expect(extracted).not.toContain("Mình đang nạp context");
    expect(extracted).not.toContain("Ran pwd");
    expect(extracted).not.toContain("Explored List ls -1");
    expect(extracted).not.toContain("FILE:SOUL.md");
    expect(extracted).not.toContain("Good luck out there");
  });

  test("extracts the final answer after generic shell command and filesystem blocks", () => {
    const extracted = extractFinalAnswer(`
Preparing workspace.

$ pwd
/Users/longluong/.clisbot/workspace/default

$ ls
README.md
src
package.json

The workspace is ready.

Next, I can inspect the source tree or run tests.
    `);

    expect(extracted).toBe(
      ["The workspace is ready.", "", "Next, I can inspect the source tree or run tests."].join(
        "\n",
      ),
    );
  });

  test("extracts the final answer after generic path-list trace blocks", () => {
    const extracted = extractFinalAnswer(`
Scanning candidate files.

src/index.ts
src/shared/transcript.ts
docs/features/runners/README.md

The duplicate came from settlement merging rather than tmux capture.
    `);

    expect(extracted).toBe("The duplicate came from settlement merging rather than tmux capture.");
  });

  test("completed interaction truncation preserves the beginning of the final answer", () => {
    const rendered = renderSlackInteraction({
      status: "completed",
      content: `
• Searching the web

• Searched Gemma 4 news April 4 2026

• As of April 4, 2026, I’m not seeing a new official Google update on Gemma 4 today.

What changed today vs. yesterday

- Today: mostly follow-on analysis.
- Yesterday: broader launch coverage.
      `,
      maxChars: 120,
    });

    expect(rendered).toStartWith("• As of April 4, 2026");
    expect(rendered).not.toContain("Searching the web");
    expect(rendered.endsWith("\n...")).toBe(true);
  });

  test("completed interaction can preserve streamed content when response policy is all", () => {
    const rendered = renderSlackInteraction({
      status: "completed",
      content: [
        "• Searching the web",
        "",
        "# Codebase Overview",
        "",
        "This workspace is currently empty.",
      ].join("\n"),
      maxChars: 200,
      responsePolicy: "all",
    });

    expect(rendered).toContain("• Searching the web");
    expect(rendered).toContain("# Codebase Overview");
  });

  test("completed interaction strips a codex single-line assistant bullet in final mode", () => {
    const rendered = renderSlackInteraction({
      status: "completed",
      content: "• PONG",
      maxChars: 200,
      responsePolicy: "final",
    });

    expect(rendered).toBe("PONG");
  });

  test("completed interaction drops delivery report lines before the final answer", () => {
    const rendered = renderSlackInteraction({
      status: "completed",
      content: [
        "Đã gửi câu trả lời vào Slack.",
        "",
        "• Waited for background terminal",
        "",
        "• Sent.",
        "",
        "4",
        "",
        "Sent the repo summary to Slack.",
      ].join("\n"),
      maxChars: 200,
      responsePolicy: "final",
    });

    expect(rendered).toBe("4");
  });

  test("completed interaction keeps only the last short queued answer block", () => {
    const rendered = renderSlackInteraction({
      status: "completed",
      content: [
        "• Waited for background terminal",
        "",
        "• Sent.",
        "",
        "4",
        "",
        "Sent.",
        "",
        "6",
        "",
        "Sent.",
        "",
        "8",
      ].join("\n"),
      maxChars: 200,
      responsePolicy: "final",
    });

    expect(rendered).toBe("8");
  });

  test("truncateHead keeps the start of long content", () => {
    const rendered = truncateHead("abcdefghij", 8);
    expect(rendered).toBe("abcd\n...");
  });

  test("extracts only appended content when snapshots overlap", () => {
    const previous = [
      "Welcome to Codex",
      "",
      "› Reply with exactly PONG and nothing else.",
      "",
      "• thinking",
    ].join("\n");
    const current = [
      "",
      "› Reply with exactly PONG and nothing else.",
      "",
      "• thinking",
      "",
      "• PONG",
    ].join("\n");

    expect(extractSlackIncrement(previous, current)).toBe("• PONG");
  });

  test("returns only the final delta when response policy keeps streamed replies", () => {
    const completion = selectSlackCompletionBody({
      previousBody: [
        "• Searching the web",
        "",
        "# Codebase Overview",
        "",
        "This workspace is currently empty.",
      ].join("\n"),
      finalBody: [
        "• Searching the web",
        "",
        "# Codebase Overview",
        "",
        "This workspace is currently empty.",
        "",
        "- No source files are present.",
      ].join("\n"),
      response: "all",
    });

    expect(completion).toBe("- No source files are present.");
  });

  test("extracts normalized line deltas when progress markers change", () => {
    const delta = extractSlackIncrement(
      [
        "* Recombobulating...",
        "",
        "web-explorer(gather Vietnam news)",
      ].join("\n"),
      [
        ":eight_spoked_asterisk: Recombobulating...",
        "",
        "web-explorer(gather Vietnam news)",
        "",
        "Initializing…",
      ].join("\n"),
    );

    expect(delta).toBe("Initializing…");
  });

  test("merges streamed bodies without duplicating the boundary line when indentation differs", () => {
    const merged = mergeSlackStreamBodies(
      [
        "Searched https://vnexpress.net/doi-sim-sang-dien-thoai-moi-phai-xac-thuc-khuon-mat-5058317.html",
        "",
        " Tính đến trưa thứ bảy, 4/4/2026 giờ Việt Nam, vài tin Việt Nam đáng chú ý là:",
      ].join("\n"),
      [
        "Tính đến trưa thứ bảy, 4/4/2026 giờ Việt Nam, vài tin Việt Nam đáng chú ý là:",
        "",
        "- Kinh tế quý I tăng mạnh",
      ].join("\n"),
    );

    expect(merged).toBe(
      [
        "Searched https://vnexpress.net/doi-sim-sang-dien-thoai-moi-phai-xac-thuc-khuon-mat-5058317.html",
        "",
        "Tính đến trưa thứ bảy, 4/4/2026 giờ Việt Nam, vài tin Việt Nam đáng chú ý là:",
        "",
        "- Kinh tế quý I tăng mạnh",
      ].join("\n"),
    );
  });

  test("merges repeated progress updates without accumulating duplicate lines", () => {
    const merged = mergeSlackStreamBodies(
      [
        "* Recombobulating...",
        "",
        "* Recombobulating...",
      ].join("\n"),
      [
        ":eight_spoked_asterisk: Recombobulating...",
        "",
        "• Recombobulating...",
      ].join("\n"),
    );

    expect(merged).toBe("* Recombobulating...");
  });

  test("dedupes repeated progress lines even when the first streamed delta is already noisy", () => {
    const merged = mergeSlackStreamBodies(
      "",
      [
        "Creating",
        "",
        ":eight_spoked_asterisk: Creating",
        "",
        "Creating",
      ].join("\n"),
    );

    expect(merged).toBe("Creating");
  });

  test("dedupes claude progress markers that use the ✽ glyph", () => {
    const merged = mergeSlackStreamBodies(
      "Quantumizing",
      [
        "✽ Quantumizing",
        "",
        ":eight_spoked_asterisk: Quantumizing",
      ].join("\n"),
    );

    expect(merged).toBe("✽ Quantumizing");
  });

  test("suppresses completion replay when the final body was already streamed", () => {
    const completion = selectSlackCompletionBody({
      previousBody: [
        "# Codebase Overview",
        "",
        "This workspace is currently empty.",
      ].join("\n"),
      finalBody: [
        "# Codebase Overview",
        "",
        "This workspace is currently empty.",
      ].join("\n"),
      response: "all",
    });

    expect(completion).toBe("");
  });

  test("keeps the full final body when response policy is final", () => {
    const completion = selectSlackCompletionBody({
      previousBody: "• Searching the web",
      finalBody: [
        "# Codebase Overview",
        "",
        "This workspace is currently empty.",
      ].join("\n"),
      response: "final",
    });

    expect(completion).toBe(
      ["# Codebase Overview", "", "This workspace is currently empty."].join("\n"),
    );
  });

  test("keeps only the newly appended body while running", () => {
    const body = selectSlackSnapshotBody({
      status: "running",
      initialSnapshot: "line 1\nline 2",
      snapshot: "line 1\nline 2\nline 3",
      previousBody: "line 2",
    });

    expect(body).toBe("line 3");
  });

  test("reuses the last meaningful body when completion adds no new content", () => {
    const body = selectSlackSnapshotBody({
      status: "completed",
      initialSnapshot: "line 1\nline 2\nline 3",
      snapshot: "line 1\nline 2\nline 3",
      previousBody: "line 3",
    });

    expect(body).toBe("line 3");
  });
});
