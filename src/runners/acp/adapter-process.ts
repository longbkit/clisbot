// ACP adapter process lifecycle: one adapter child process per active ACP
// session, exposing web streams for the JSON-RPC connection, a bounded stderr
// tail for truthful failure evidence, and exit tracking.

import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";

const STDERR_TAIL_MAX_CHARS = 4_000;

export class AcpAdapterProcessError extends Error {
  constructor(
    readonly sessionName: string,
    detail: string,
    readonly stderrTail = "",
  ) {
    super(`ACP adapter for "${sessionName}" ${detail}`);
    this.name = "AcpAdapterProcessError";
  }
}

export type AcpAdapterExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
  at: number;
};

export class AcpAdapterProcess {
  private readonly child: ChildProcess;
  private stderrTail = "";
  private exitState: AcpAdapterExit | null = null;
  private readonly exitListeners = new Set<(exit: AcpAdapterExit) => void>();

  constructor(
    readonly sessionName: string,
    params: {
      command: string;
      args: string[];
      cwd: string;
      env: Record<string, string>;
    },
  ) {
    this.child = spawn(params.command, params.args, {
      cwd: params.cwd,
      env: { ...process.env, ...params.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr?.setEncoding("utf8");
    this.child.stderr?.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_MAX_CHARS);
    });
    this.child.on("exit", (code, signal) => {
      this.exitState = { code, signal, at: Date.now() };
      for (const listener of this.exitListeners) {
        listener(this.exitState);
      }
    });
    this.child.on("error", (error) => {
      this.stderrTail = (
        this.stderrTail + `\n[spawn error] ${error.message}`
      ).slice(-STDERR_TAIL_MAX_CHARS);
      if (!this.exitState) {
        this.exitState = { code: null, signal: null, at: Date.now() };
        for (const listener of this.exitListeners) {
          listener(this.exitState);
        }
      }
    });
  }

  get pid() {
    return this.child.pid;
  }

  get alive() {
    return this.exitState === null && this.child.pid !== undefined;
  }

  get exit() {
    return this.exitState;
  }

  get stderrEvidence() {
    return this.stderrTail.trim();
  }

  onExit(listener: (exit: AcpAdapterExit) => void) {
    if (this.exitState) {
      listener(this.exitState);
      return;
    }
    this.exitListeners.add(listener);
  }

  /** Web streams for the SDK's ndJsonStream(output, input). */
  openStdioStreams() {
    if (!this.child.stdin || !this.child.stdout) {
      throw new AcpAdapterProcessError(
        this.sessionName,
        "started without stdio pipes",
        this.stderrEvidence,
      );
    }
    return {
      output: Writable.toWeb(this.child.stdin) as WritableStream<Uint8Array>,
      input: Readable.toWeb(this.child.stdout) as ReadableStream<Uint8Array>,
    };
  }

  kill() {
    if (this.alive) {
      this.child.kill("SIGTERM");
    }
  }
}
