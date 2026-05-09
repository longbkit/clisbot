import { describe, expect, test } from "bun:test";
import type { TmuxClient } from "../../src/runners/tmux/client.ts";
import {
  acceptTmuxStartupContinuePromptIfPresent,
  captureTmuxSessionIdentity,
  acceptTmuxTrustPromptIfPresent,
  submitTmuxSessionInput,
  TmuxBootstrapSessionLostError,
  tmuxPaneHasCodexUpdatePrompt,
  tmuxPaneHasTrustPrompt,
  waitForTmuxSessionBootstrap,
} from "../../src/runners/tmux/session-handshake.ts";
import { monitorTmuxRun } from "../../src/runners/tmux/run-monitor.ts";

describe("tmux runner latency behavior", () => {
  test("waitForTmuxSessionBootstrap returns before the full startup budget once output appears", async () => {
    let captureCount = 0;
    const fakeTmux = {
      async capturePane() {
        captureCount += 1;
        return captureCount >= 2 ? "READY" : "";
      },
    } as unknown as TmuxClient;

    const startedAt = Date.now();
    const result = await waitForTmuxSessionBootstrap({
      tmux: fakeTmux,
      sessionName: "test-session",
      captureLines: 80,
      startupDelayMs: 500,
    });
    const elapsedMs = Date.now() - startedAt;

    expect(result).toEqual({
      status: "ready",
      snapshot: "READY",
    });
    expect(captureCount).toBe(2);
    expect(elapsedMs).toBeLessThan(400);
  });

  test("waitForTmuxSessionBootstrap honors a ready pattern instead of the first non-empty pane", async () => {
    let captureCount = 0;
    const fakeTmux = {
      async capturePane() {
        captureCount += 1;
        if (captureCount === 1) {
          return "Waiting for authentication...";
        }
        if (captureCount === 2) {
          return "Still booting...";
        }
        return "Type your message or @path/to/file";
      },
    } as unknown as TmuxClient;

    const result = await waitForTmuxSessionBootstrap({
      tmux: fakeTmux,
      sessionName: "test-session",
      captureLines: 80,
      startupDelayMs: 500,
      readyPattern: "Type your message or @path/to/file",
    });

    expect(result.status).toBe("ready");
    expect(result.snapshot).toContain("Type your message or @path/to/file");
    expect(captureCount).toBe(3);
  });

  test("waitForTmuxSessionBootstrap ignores a stale prompt when newer startup output follows it", async () => {
    let captureCount = 0;
    const fakeTmux = {
      async capturePane() {
        captureCount += 1;
        if (captureCount === 1) {
          return [
            "Previous answer",
            "› old request",
            "",
            "Starting Codex...",
          ].join("\n");
        }
        return [
          "Previous answer",
          "› old request",
          "",
          "Starting Codex...",
          "",
          "› ",
          "gpt-5.4 high · /tmp/workspaces/codex",
        ].join("\n");
      },
    } as unknown as TmuxClient;

    const result = await waitForTmuxSessionBootstrap({
      tmux: fakeTmux,
      sessionName: "test-session",
      captureLines: 80,
      startupDelayMs: 500,
      readyPattern: "(?:^|\\s)›\\s",
    });

    expect(result.status).toBe("ready");
    expect(result.snapshot).toContain("gpt-5.4 high");
    expect(captureCount).toBe(2);
  });

  test("waitForTmuxSessionBootstrap stops early on a configured startup blocker", async () => {
    let captureCount = 0;
    const fakeTmux = {
      async capturePane() {
        captureCount += 1;
        return "Please visit the following URL to authorize the application:";
      },
    } as unknown as TmuxClient;

    const result = await waitForTmuxSessionBootstrap({
      tmux: fakeTmux,
      sessionName: "test-session",
      captureLines: 80,
      startupDelayMs: 500,
      readyPattern: "Type your message or @path/to/file",
      blockers: [
        {
          pattern: "Please visit the following URL to authorize the application",
          message: "auth required",
        },
      ],
    });

    expect(result).toEqual({
      status: "blocked",
      snapshot: "Please visit the following URL to authorize the application:",
      message: "auth required",
    });
    expect(captureCount).toBe(1);
  });

  test("waitForTmuxSessionBootstrap returns timeout when ready pattern never appears", async () => {
    const fakeTmux = {
      async capturePane() {
        return "Still booting...";
      },
    } as unknown as TmuxClient;

    const result = await waitForTmuxSessionBootstrap({
      tmux: fakeTmux,
      sessionName: "test-session",
      captureLines: 80,
      startupDelayMs: 150,
      readyPattern: "Type your message or @path/to/file",
    });

    expect(result).toEqual({
      status: "timeout",
      snapshot: "Still booting...",
    });
  });

  test("waitForTmuxSessionBootstrap dismisses Gemini trust prompts before ready-pattern matching", async () => {
    let captureCount = 0;
    let trustDismissed = false;
    let enterCount = 0;
    const fakeTmux = {
      async capturePane() {
        captureCount += 1;
        if (!trustDismissed) {
          return [
            "Skipping project agents due to untrusted folder. To enable, ensure that the project root is trusted.",
            "Do you trust the files in this folder?",
            "1. Trust folder (default)",
          ].join("\n");
        }
        return "Type your message or @path/to/file";
      },
      async sendKey(_sessionName: string, key: string) {
        if (key === "Enter") {
          enterCount += 1;
          trustDismissed = true;
        }
      },
    } as unknown as TmuxClient;

    const result = await waitForTmuxSessionBootstrap({
      tmux: fakeTmux,
      sessionName: "test-session",
      captureLines: 80,
      startupDelayMs: 500,
      trustWorkspace: true,
      readyPattern: "Type your message or @path/to/file",
    });

    expect(result).toEqual({
      status: "ready",
      snapshot: "Type your message or @path/to/file",
    });
    expect(enterCount).toBe(1);
    expect(captureCount).toBeGreaterThanOrEqual(2);
  });

  test("waitForTmuxSessionBootstrap tolerates transient no-current-target races", async () => {
    let captureCount = 0;
    const fakeTmux = {
      async capturePane() {
        captureCount += 1;
        if (captureCount === 1) {
          throw new Error("tmux capture-pane failed with code 1: no current target");
        }
        return "READY";
      },
    } as unknown as TmuxClient;

    const result = await waitForTmuxSessionBootstrap({
      tmux: fakeTmux,
      sessionName: "test-session",
      captureLines: 80,
      startupDelayMs: 500,
    });

    expect(result).toEqual({
      status: "ready",
      snapshot: "READY",
    });
  });

  test("acceptTmuxTrustPromptIfPresent tolerates transient no-current-target races", async () => {
    let captureCount = 0;
    let enterCount = 0;
    const fakeTmux = {
      async capturePane() {
        captureCount += 1;
        if (captureCount === 1) {
          return [
            "Quick safety check:",
            "❯ 1. Yes, I trust this folder",
            "Enter to confirm · Esc to cancel",
          ].join("\n");
        }
        if (captureCount === 2) {
          throw new Error("tmux capture-pane failed with code 1: no current target");
        }
        return "READY";
      },
      async sendKey(_sessionName: string, key: string) {
        if (key === "Enter") {
          enterCount += 1;
        }
      },
    } as unknown as TmuxClient;

    await acceptTmuxTrustPromptIfPresent({
      tmux: fakeTmux,
      sessionName: "test-session",
      captureLines: 80,
      startupDelayMs: 500,
    });

    expect(enterCount).toBe(1);
    expect(captureCount).toBeGreaterThanOrEqual(3);
  });

  test("acceptTmuxTrustPromptIfPresent throws when tmux server disappears", async () => {
    let captureCount = 0;
    const fakeTmux = {
      async capturePane() {
        captureCount += 1;
        if (captureCount === 1) {
          return [
            "Quick safety check:",
            "❯ 1. Yes, I trust this folder",
            "Enter to confirm · Esc to cancel",
          ].join("\n");
        }
        throw new Error(
          "tmux capture-pane failed with code 1: error connecting to /tmp/clisbot.sock (No such file or directory)",
        );
      },
      async sendKey() {
        return;
      },
    } as unknown as TmuxClient;

    await expect(
      acceptTmuxTrustPromptIfPresent({
        tmux: fakeTmux,
        sessionName: "test-session",
        captureLines: 80,
        startupDelayMs: 500,
      }),
    ).rejects.toBeInstanceOf(TmuxBootstrapSessionLostError);
  });

  test("tmuxPaneHasTrustPrompt ignores stale trust text left above a later Codex prompt", () => {
    const snapshot = [
      "Do you trust the contents of this directory?",
      "Press enter to continue",
      "",
      "╭────────────────────────────────────────────╮",
      "│ >_ OpenAI Codex (v0.121.0)                 │",
      "╰────────────────────────────────────────────╯",
      "",
      "› Explain this codebase",
      "",
      "  gpt-5.4 high · /tmp/workspaces/codex",
    ].join("\n");

    expect(tmuxPaneHasTrustPrompt(snapshot)).toBe(false);
  });

  test("waitForTmuxSessionBootstrap ignores stale trust text once a later prompt is visible", async () => {
    let captureCount = 0;
    const staleSnapshot = [
      "Do you trust the contents of this directory?",
      "Press enter to continue",
      "",
      "╭────────────────────────────────────────────╮",
      "│ >_ OpenAI Codex (v0.121.0)                 │",
      "╰────────────────────────────────────────────╯",
      "",
      "› Explain this codebase",
      "",
      "  gpt-5.4 high · /tmp/workspaces/codex",
    ].join("\n");
    const fakeTmux = {
      async capturePane() {
        captureCount += 1;
        return captureCount === 1 ? staleSnapshot : "READY";
      },
      async sendKey() {
        throw new Error("trust dismissal should not be attempted for stale trust text");
      },
    } as unknown as TmuxClient;

    const result = await waitForTmuxSessionBootstrap({
      tmux: fakeTmux,
      sessionName: "test-session",
      captureLines: 80,
      startupDelayMs: 500,
      trustWorkspace: true,
    });

    expect(result).toEqual({
      status: "ready",
      snapshot: staleSnapshot,
    });
  });

  test("acceptTmuxTrustPromptIfPresent returns when trust text is stale history only", async () => {
    let captureCount = 0;
    const snapshot = [
      "Do you trust the contents of this directory?",
      "Press enter to continue",
      "",
      "╭────────────────────────────────────────────╮",
      "│ >_ OpenAI Codex (v0.121.0)                 │",
      "╰────────────────────────────────────────────╯",
      "",
      "› Explain this codebase",
      "",
      "  gpt-5.4 high · /tmp/workspaces/codex",
    ].join("\n");
    const fakeTmux = {
      async capturePane() {
        captureCount += 1;
        return snapshot;
      },
      async sendKey() {
        throw new Error("trust dismissal should not be attempted for stale trust text");
      },
    } as unknown as TmuxClient;

    await acceptTmuxTrustPromptIfPresent({
      tmux: fakeTmux,
      sessionName: "test-session",
      captureLines: 80,
      startupDelayMs: 500,
    });

    expect(captureCount).toBe(1);
  });

  test("acceptTmuxStartupContinuePromptIfPresent accepts a Codex update prompt even when trustWorkspace is false", async () => {
    let captureCount = 0;
    let enterCount = 0;
    const updatePrompt = [
      "✨ Update available! 0.129.0 → 0.130.0",
      "",
      "Release notes: https://github.com/openai/codex/releases/latest",
      "",
      "› 1. Update now (runs `npm install -g @openai/codex`)",
      "  2. Skip",
      "  3. Skip until next version",
      "",
      "Press enter to continue",
    ].join("\n");
    const fakeTmux = {
      async capturePane() {
        captureCount += 1;
        return captureCount === 1 ? updatePrompt : "READY";
      },
      async sendKey(_sessionName: string, key: string) {
        if (key === "Enter") {
          enterCount += 1;
        }
      },
    } as unknown as TmuxClient;

    expect(tmuxPaneHasCodexUpdatePrompt(updatePrompt)).toBe(true);
    expect(tmuxPaneHasTrustPrompt(updatePrompt)).toBe(false);

    await acceptTmuxStartupContinuePromptIfPresent({
      tmux: fakeTmux,
      sessionName: "test-session",
      captureLines: 80,
      startupDelayMs: 500,
      trustWorkspace: false,
    });

    expect(enterCount).toBe(1);
    expect(captureCount).toBe(3);
  });

});
