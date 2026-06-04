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
  looksLikePiSnapshot,
  mergeRenderedStreamBodies,
  renderMarkdownInteraction,
  renderChannelSnapshot,
  renderPlainInteraction,
  selectCompletedInteractionBody,
  selectSnapshotInteractionBody,
  truncateHead,
} from "../../src/runners/transcript/index.ts";

describe("snapshot shaping", () => {
  test("unwraps soft-wrapped tmux lines into cleaner rendered text", () => {
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

  test("keeps codex ellipsis timer lines in running snapshots", () => {
    const cleaned = cleanRunningInteractionSnapshot(`
› explain this codebase

• Exploring the workspace

• Working... (2m 4s • esc to interrupt)
    `);

    expect(cleaned).toContain("• Exploring the workspace");
    expect(cleaned).toContain("Working... (2m 4s • esc to interrupt)");
  });

  test("latest prompt extraction ignores the idle codex input prompt below a running timer", () => {
    const snapshot = [
      "Previous answer.",
      "",
      "› current request",
      "",
      "• Summarizing findings...",
      "",
      "• Working (5m 02s • esc to interrupt)",
      "",
      "› Write tests for @filename",
      "",
      "  gpt-5.5 high · ~/.clisbot/workspaces/default",
    ].join("\n");

    expect(deriveLatestPromptRunningInteractionSnapshot(snapshot)).toBe(
      ["• Summarizing findings...", "", "• Working (5m 02s • esc to interrupt)"].join("\n"),
    );
    expect(deriveLatestPromptInteractionSnapshot(snapshot)).toBe("• Summarizing findings...");
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
});

describe("pi chrome filtering", () => {
  describe("looksLikePiSnapshot()", () => {
    test("detects pi via 'Welcome to pi' marker", () => {
      expect(looksLikePiSnapshot(["Welcome to pi", "some user response"])).toBe(true);
    });

    test("detects pi via version line 'pi v1.2.3'", () => {
      expect(looksLikePiSnapshot(["pi v1.2.3", "some text"])).toBe(true);
    });

    test("detects pi via 'Type your message' marker", () => {
      expect(looksLikePiSnapshot(["Type your message", "more text"])).toBe(true);
    });

    test("detects pi via 'run /help for shortcuts' marker", () => {
      expect(looksLikePiSnapshot(["run /help for shortcuts", "more text"])).toBe(true);
    });

    test("does NOT classify snapshot as pi based on bare '>' alone", () => {
      expect(looksLikePiSnapshot([">", "some text"])).toBe(false);
    });

    test("returns false for gemini snapshot (not pi)", () => {
      expect(looksLikePiSnapshot(["Gemini CLI v1.0", "some text"])).toBe(false);
    });

    test("returns false for generic text with no pi markers", () => {
      expect(looksLikePiSnapshot(["Hello world"])).toBe(false);
    });

    test("bare '>' alongside pi marker is still detected as pi", () => {
      expect(looksLikePiSnapshot([">", "Welcome to pi"])).toBe(true)
    })

    test("snapshot with only bare '>' and non-pi content is NOT classified as pi", () => {
      expect(looksLikePiSnapshot([">", "bash heredoc output"])).toBe(false)
    })
  });

  describe("pi chrome line filtering via cleanInteractionSnapshot()", () => {
    const piHeader = "Welcome to pi\npi v1.2.3\n\n";

    test("Warning: lines are kept — startup blockers are caught at launch, not by normalization", () => {
      const cleaned = cleanInteractionSnapshot(`${piHeader}Warning: No models available\n\nActual response`);
      expect(cleaned).toContain("Warning: No models available");
      expect(cleaned).toContain("Actual response");
    });

    test("Note: lines are kept — startup blockers are caught at launch, not by normalization", () => {
      const cleaned = cleanInteractionSnapshot(`${piHeader}Note: Using provider X\n\nActual response`);
      expect(cleaned).toContain("Note: Using provider X");
      expect(cleaned).toContain("Actual response");
    });

    test("drops 'sh: fd: not found' error lines", () => {
      const cleaned = cleanInteractionSnapshot(`${piHeader}sh: fd: not found\n\nActual response`);
      expect(cleaned).not.toContain("fd: not found");
      expect(cleaned).toContain("Actual response");
    });

    test("drops 'fd: command not found' error lines", () => {
      const cleaned = cleanInteractionSnapshot(`${piHeader}fd: command not found\n\nActual response`);
      expect(cleaned).not.toContain("fd: command not found");
      expect(cleaned).toContain("Actual response");
    });

    test("drops box-drawing separator lines (─────)", () => {
      const cleaned = cleanInteractionSnapshot(`${piHeader}────────────────────────────────\n\nActual response`);
      expect(cleaned).not.toContain("────");
      expect(cleaned).toContain("Actual response");
    });

    test("drops box-drawing top border lines (╭──────╮)", () => {
      const cleaned = cleanInteractionSnapshot(`${piHeader}╭──────────────────────────────╮\n\nActual response`);
      expect(cleaned).not.toContain("╭");
      expect(cleaned).toContain("Actual response");
    });

    test("drops box-drawing side lines starting with │", () => {
      const cleaned = cleanInteractionSnapshot(`${piHeader}│ some content │\n\nActual response`);
      expect(cleaned).not.toContain("│ some content │");
      expect(cleaned).toContain("Actual response");
    });

    test("drops box-drawing bottom border lines (╰──────╯)", () => {
      const cleaned = cleanInteractionSnapshot(`${piHeader}╰──────────────────────────────╯\n\nActual response`);
      expect(cleaned).not.toContain("╰");
      expect(cleaned).toContain("Actual response");
    });

    test("drops 'Welcome to pi' header line", () => {
      const cleaned = cleanInteractionSnapshot(`${piHeader}Actual response`);
      expect(cleaned).not.toContain("Welcome to pi");
      expect(cleaned).toContain("Actual response");
    });

    test("drops 'pi v1.2.3' version line", () => {
      const cleaned = cleanInteractionSnapshot(`${piHeader}Actual response`);
      expect(cleaned).not.toContain("pi v1.2.3");
      expect(cleaned).toContain("Actual response");
    });

    test("drops bare '>' prompt marker line", () => {
      const cleaned = cleanInteractionSnapshot(`${piHeader}>\n\nActual response`);
      const lines = cleaned.split("\n");
      expect(lines).not.toContain(">");
      expect(cleaned).toContain("Actual response");
    });

    test("drops bare '> ' prompt marker line with trailing space", () => {
      const cleaned = cleanInteractionSnapshot(`${piHeader}> \n\nActual response`);
      const lines = cleaned.split("\n").map((l) => l.trimEnd());
      expect(lines).not.toContain(">");
      expect(cleaned).toContain("Actual response");
    });

    test("keeps actual user response text", () => {
      const cleaned = cleanInteractionSnapshot(`${piHeader}The answer to your question is 42.`);
      expect(cleaned).toContain("The answer to your question is 42.");
    });

    test("keeps code content", () => {
      const cleaned = cleanInteractionSnapshot(`${piHeader}console.log('test')`);
      expect(cleaned).toContain("console.log('test')");
    });

    test("keeps a URL containing 'warning' as substring (not at line start with colon)", () => {
      const cleaned = cleanInteractionSnapshot(`${piHeader}See https://example.com/warning-info for details.`);
      expect(cleaned).toContain("https://example.com/warning-info");
    });

    test('keeps "Warning:" lines that are legitimate AI response content', () => {
      const cleaned = cleanInteractionSnapshot(`${piHeader}Warning: this command is destructive\n\nResponse`)
      expect(cleaned).toContain('Warning: this command is destructive')
      expect(cleaned).toContain('Response')
    })

    test('keeps "Note:" lines that are legitimate AI response content', () => {
      const cleaned = cleanInteractionSnapshot(`${piHeader}Note: you need sudo privileges\n\nResponse`)
      expect(cleaned).toContain('Note: you need sudo privileges')
      expect(cleaned).toContain('Response')
    })

    test('drops pi prompt echo lines (> user message)', () => {
      const cleaned = cleanInteractionSnapshot(`${piHeader}> explain this code\n\nThe code does X`)
      expect(cleaned).not.toContain('> explain')
      expect(cleaned).toContain('The code does X')
    })

    test('drops pi prompt echo with indented continuation', () => {
      const cleaned = cleanInteractionSnapshot(`${piHeader}> what is pi\n  continuation line\n\nActual response`)
      expect(cleaned).not.toContain('> what is pi')
      expect(cleaned).not.toContain('continuation line')
      expect(cleaned).toContain('Actual response')
    })

    test('drops "Type your message" help-bar line', () => {
      const cleaned = cleanInteractionSnapshot(`${piHeader}Type your message\n\nResponse`)
      expect(cleaned).not.toContain('Type your message')
      expect(cleaned).toContain('Response')
    })

    test('drops "run /help" help-bar line', () => {
      const cleaned = cleanInteractionSnapshot(`${piHeader}run /help for shortcuts\n\nResponse`)
      expect(cleaned).not.toContain('run /help')
      expect(cleaned).toContain('Response')
    })
  });

  describe("integration — end-to-end", () => {
    test("pi snapshot with startup warnings and real response strips chrome, keeps response", () => {
      const cleaned = cleanInteractionSnapshot(`
Welcome to pi
pi v1.2.3

Warning: No models available
Note: Using provider fallback
sh: fd: not found
────────────────────────────────

The mitochondria is the powerhouse of the cell.
      `);
      expect(cleaned).not.toContain("fd: not found");
      expect(cleaned).not.toContain("────");
      expect(cleaned).toContain("The mitochondria is the powerhouse of the cell.");
    });

    test("codex snapshot is unaffected by pi filters (pi chrome patterns not dropped from codex)", () => {
      const cleaned = cleanInteractionSnapshot(`
› what is fd

• fd is a fast alternative to find.

Warning: this is a codex message containing Warning: in the body text.
      `);
      expect(cleaned).toContain("fd is a fast alternative to find.");
      expect(cleaned).toContain("Warning: this is a codex message containing Warning: in the body text.");
    });
  });
});
