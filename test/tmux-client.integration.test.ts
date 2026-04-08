import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TmuxClient } from "../src/runners/tmux/client.ts";

describe("TmuxClient", () => {
  let socketDir = "";

  afterEach(async () => {
    if (socketDir) {
      const socketPath = join(socketDir, "muxbot.sock");
      await Bun.spawn(["tmux", "-S", socketPath, "kill-server"], {
        stdout: "ignore",
        stderr: "ignore",
      }).exited;
      rmSync(socketDir, { recursive: true, force: true });
    }
  });

  test("creates a session, sends text, and captures output", async () => {
    socketDir = mkdtempSync(join(tmpdir(), "muxbot-socket-"));
    const socketPath = join(socketDir, "muxbot.sock");
    const client = new TmuxClient(socketPath);
    const sessionName = "echo-test";

    await client.newSession({
      sessionName,
      cwd: socketDir,
      command: "cat",
    });

    await client.sendLiteral(sessionName, "hello from muxbot");
    await Bun.sleep(100);
    await client.sendKey(sessionName, "Enter");
    await Bun.sleep(300);

    const pane = await client.capturePane(sessionName, 20);
    expect(pane).toContain("hello from muxbot");

    await client.killSession(sessionName);
  }, 10000);

  test("creates a transient window and captures its pane output", async () => {
    socketDir = mkdtempSync(join(tmpdir(), "muxbot-socket-"));
    const socketPath = join(socketDir, "muxbot.sock");
    const client = new TmuxClient(socketPath);
    const sessionName = "window-test";

    await client.newSession({
      sessionName,
      cwd: socketDir,
      command: "cat",
    });

    const paneId = await client.newWindow({
      sessionName,
      cwd: socketDir,
      name: "cmd",
      command: "bash -lc 'printf \"transient-window-output\\n\"; exec sleep 3600'",
    });

    await Bun.sleep(800);
    const pane = await client.captureTarget(paneId, 20);
    expect(pane).toContain("transient-window-output");

    await client.killPane(paneId);
    await client.killSession(sessionName);
  }, 10000);

  test("finds and reuses a named window target", async () => {
    socketDir = mkdtempSync(join(tmpdir(), "muxbot-socket-"));
    const socketPath = join(socketDir, "muxbot.sock");
    const client = new TmuxClient(socketPath);
    const sessionName = "reuse-window-test";

    await client.newSession({
      sessionName,
      cwd: socketDir,
      command: "cat",
    });

    const paneId = await client.newWindow({
      sessionName,
      cwd: socketDir,
      name: "bash",
      command: "env PS1= HISTFILE=/dev/null bash --noprofile --norc -i",
    });

    const foundPaneId = await client.findPaneByWindowName(sessionName, "bash");
    expect(foundPaneId).toBe(paneId);

    await client.sendLiteralTarget(paneId, "printf reused-window-output");
    await Bun.sleep(100);
    await client.sendKeyTarget(paneId, "Enter");
    await Bun.sleep(300);

    const pane = await client.captureTarget(paneId, 20);
    expect(pane).toContain("reused-window-output");

    await client.killPane(paneId);
    await client.killSession(sessionName);
  }, 10000);
});
