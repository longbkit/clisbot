import { randomUUID } from "node:crypto";
import { commandExists, runCommand } from "../../shared/process.ts";

const MAIN_WINDOW_NAME = "main";
const TMUX_NOT_FOUND_CODE = "ENOENT";
const TMUX_SERVER_DEFAULTS = [
  ["exit-empty", "off"],
  ["destroy-unattached", "off"],
] as const;

type TmuxExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type TmuxPaneState = {
  cursorX: number;
  cursorY: number;
  historySize: number;
};

export class TmuxClient {
  constructor(private readonly socketPath: string) {}

  private async exec(args: string[], options: { cwd?: string } = {}): Promise<TmuxExecResult> {
    if (!commandExists("tmux")) {
      throw new Error(
        "tmux is not installed or not available on PATH. Install tmux and restart clisbot.",
      );
    }
    try {
      return await runCommand("tmux", ["-S", this.socketPath, ...args], {
        cwd: options.cwd,
        env: process.env,
      });
    } catch (error) {
      throw this.mapExecError(error);
    }
  }

  private mapExecError(error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === TMUX_NOT_FOUND_CODE
    ) {
      return new Error(
        "tmux is not installed or not available on PATH. Install tmux and restart clisbot.",
      );
    }

    return error instanceof Error ? error : new Error(String(error));
  }

  private async execOrThrow(args: string[], options: { cwd?: string } = {}) {
    const result = await this.exec(args, options);
    if (result.exitCode !== 0) {
      throw new Error(
        `tmux ${args.join(" ")} failed with code ${result.exitCode}: ${result.stderr || result.stdout}`,
      );
    }
    return result.stdout;
  }

  private target(sessionName: string) {
    return `${sessionName}:${MAIN_WINDOW_NAME}`;
  }

  private rawTarget(target: string) {
    return target;
  }

  async hasSession(sessionName: string) {
    const result = await this.exec(["has-session", "-t", sessionName]);
    return result.exitCode === 0;
  }

  async listSessions() {
    const result = await this.exec(["list-sessions", "-F", "#{session_name}"]);
    if (result.exitCode !== 0) {
      return [];
    }

    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async isServerRunning() {
    const result = await this.exec(["list-sessions", "-F", "#{session_name}"]);
    if (result.exitCode === 0) {
      return true;
    }

    const output = `${result.stderr}\n${result.stdout}`.trim();
    return !output.includes("no server running");
  }

  async ensureServerDefaults() {
    if (!(await this.isServerRunning())) {
      return;
    }

    for (const [name, value] of TMUX_SERVER_DEFAULTS) {
      await this.execOrThrow(["set-option", "-g", name, value]);
    }
  }

  async newSession(params: {
    sessionName: string;
    cwd: string;
    command: string;
  }) {
    await this.execOrThrow([
      "new-session",
      "-d",
      "-s",
      params.sessionName,
      "-n",
      MAIN_WINDOW_NAME,
      "-c",
      params.cwd,
      params.command,
    ]);
    await this.ensureServerDefaults();
    await this.freezeWindowName(`${params.sessionName}:${MAIN_WINDOW_NAME}`);
  }

  async newWindow(params: {
    sessionName: string;
    cwd: string;
    name: string;
    command: string;
  }) {
    const paneId = await this.execOrThrow([
      "new-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      params.sessionName,
      "-n",
      params.name,
      "-c",
      params.cwd,
      params.command,
    ]);

    await this.freezeWindowName(`${params.sessionName}:${params.name}`);

    return paneId.trim();
  }

  private async freezeWindowName(target: string) {
    await this.execOrThrow(["set-window-option", "-t", target, "automatic-rename", "off"]);
    await this.execOrThrow(["set-window-option", "-t", target, "allow-rename", "off"]);
  }

  async findPaneByWindowName(sessionName: string, windowName: string) {
    const output = await this.execOrThrow([
      "list-windows",
      "-t",
      sessionName,
      "-F",
      "#{window_name}\t#{pane_id}",
    ]);

    for (const line of output.split("\n")) {
      const [name, paneId] = line.split("\t");
      if (name === windowName && paneId) {
        return paneId.trim();
      }
    }

    return null;
  }

  async sendLiteral(sessionName: string, text: string) {
    await this.pasteLiteralTarget(this.target(sessionName), text);
  }

  async sendLiteralTarget(target: string, text: string) {
    await this.pasteLiteralTarget(this.rawTarget(target), text);
  }

  async sendKey(sessionName: string, key: string) {
    await this.execOrThrow(["send-keys", "-t", this.target(sessionName), key]);
  }

  async sendKeyTarget(target: string, key: string) {
    await this.execOrThrow(["send-keys", "-t", this.rawTarget(target), key]);
  }

  async capturePane(sessionName: string, lines: number) {
    return this.execOrThrow([
      "capture-pane",
      "-p",
      "-J",
      "-t",
      this.target(sessionName),
      "-S",
      `-${lines}`,
    ]);
  }

  async captureTarget(target: string, lines: number) {
    return this.execOrThrow([
      "capture-pane",
      "-p",
      "-J",
      "-t",
      this.rawTarget(target),
      "-S",
      `-${lines}`,
    ]);
  }

  async getPaneState(sessionName: string): Promise<TmuxPaneState> {
    return this.getPaneStateTarget(this.target(sessionName));
  }

  async getPaneStateTarget(target: string): Promise<TmuxPaneState> {
    const output = await this.execOrThrow([
      "display-message",
      "-p",
      "-t",
      this.rawTarget(target),
      "#{cursor_x}\t#{cursor_y}\t#{history_size}",
    ]);
    const [cursorXRaw, cursorYRaw, historySizeRaw] = output.trim().split("\t");
    const cursorX = Number.parseInt(cursorXRaw ?? "", 10);
    const cursorY = Number.parseInt(cursorYRaw ?? "", 10);
    const historySize = Number.parseInt(historySizeRaw ?? "", 10);
    if (
      !Number.isFinite(cursorX) ||
      !Number.isFinite(cursorY) ||
      !Number.isFinite(historySize)
    ) {
      throw new Error(`tmux pane state parse failed for ${target}: ${output.trim()}`);
    }
    return {
      cursorX,
      cursorY,
      historySize,
    };
  }

  async killSession(sessionName: string) {
    await this.exec(["kill-session", "-t", sessionName]);
  }

  async killPane(target: string) {
    await this.exec(["kill-pane", "-t", this.rawTarget(target)]);
  }

  async killServer() {
    await this.exec(["kill-server"]);
  }

  private async pasteLiteralTarget(target: string, text: string) {
    const bufferName = `clisbot-submit-${randomUUID()}`;
    await this.execOrThrow([
      "set-buffer",
      "-b",
      bufferName,
      "--",
      text,
      ";",
      "paste-buffer",
      "-b",
      bufferName,
      "-d",
      "-p",
      "-t",
      this.rawTarget(target),
    ]);
  }
}
