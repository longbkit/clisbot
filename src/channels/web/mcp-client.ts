import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export interface McpClient {
  callTool(tool: string, args: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

export function createMcpClient(config: McpServerConfig): McpClient {
  const proc = spawn(config.command, config.args, {
    env: { ...process.env, ...(config.env ?? {}) },
    stdio: ["pipe", "pipe", "inherit"],
  });

  const pending = new Map<number, Pending>();
  let msgId = 1;
  let initResolve: (() => void) | null = null;
  const initPromise = new Promise<void>((r) => { initResolve = r; });
  let initialized = false;

  const send = (msg: object) => {
    proc.stdin.write(JSON.stringify(msg) + "\n");
  };

  const rl = createInterface({ input: proc.stdout! });
  rl.on("line", (line) => {
    let msg: { id?: number; result?: unknown; error?: { message: string } };
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      }
      if (!initialized) {
        initialized = true;
        initResolve?.();
      }
    }
  });

  proc.on("exit", () => {
    for (const p of pending.values()) p.reject(new Error("MCP process exited"));
    pending.clear();
  });

  // Perform initialize handshake
  const initId = msgId++;
  send({
    jsonrpc: "2.0", id: initId,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "clisbot-web", version: "1.0.0" },
    },
  });
  initPromise.then(() => {
    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  });

  return {
    async callTool(tool, args) {
      await initPromise;
      const id = msgId++;
      const result = await new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ jsonrpc: "2.0", id, method: "tools/call", params: { name: tool, arguments: args } });
      });
      // Unwrap MCP content envelope: { content: [{ type: "text", text: "..." }] }
      const content = (result as { content?: Array<{ type: string; text: string }> }).content;
      if (content?.[0]?.type === "text") {
        try { return JSON.parse(content[0].text); } catch { return content[0].text; }
      }
      return result;
    },
    close() {
      try { proc.stdin.end(); proc.kill(); } catch { /* already dead */ }
    },
  };
}
