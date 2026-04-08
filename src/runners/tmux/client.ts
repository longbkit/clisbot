type TmuxExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export class TmuxClient {
  constructor(private readonly socketPath: string) {}

  private async exec(args: string[], options: { cwd?: string } = {}): Promise<TmuxExecResult> {
    const proc = Bun.spawn(["tmux", "-S", this.socketPath, ...args], {
      cwd: options.cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return {
      stdout,
      stderr,
      exitCode,
    };
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
    return `${sessionName}:0.0`;
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
      "-c",
      params.cwd,
      params.command,
    ]);
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

    return paneId.trim();
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
    await this.execOrThrow(["send-keys", "-t", this.target(sessionName), "-l", "--", text]);
  }

  async sendLiteralTarget(target: string, text: string) {
    await this.execOrThrow(["send-keys", "-t", this.rawTarget(target), "-l", "--", text]);
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

  async killSession(sessionName: string) {
    await this.exec(["kill-session", "-t", sessionName]);
  }

  async killPane(target: string) {
    await this.exec(["kill-pane", "-t", this.rawTarget(target)]);
  }

  async killServer() {
    await this.exec(["kill-server"]);
  }
}
