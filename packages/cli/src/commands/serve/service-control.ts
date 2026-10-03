import { createServer, createConnection, type Server } from "node:net";
import { readFile, unlink } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { writeServiceFile } from "../../utils/service-files.js";

interface ControlRecord {
  pid: number;
  port: number;
  token: string;
}

export async function startServiceControl(
  file: string,
  shutdown: () => void,
): Promise<{ close(): Promise<void> }> {
  const token = randomBytes(32).toString("base64url");
  const server = createServer((socket) => {
    socket.setTimeout(2_000, () => socket.destroy());
    let body = "";
    socket.on("error", () => undefined);
    socket.on("data", (data) => {
      body += data.toString();
      if (body.length > 2048) {
        socket.destroy();
        return;
      }
      if (!body.endsWith("\n")) return;
      try {
        const input = JSON.parse(body) as { token?: string; action?: string };
        if (input.action !== "stop" || !matches(token, input.token)) {
          socket.destroy();
          return;
        }
        socket.end(`${JSON.stringify({ pid: process.pid, ok: true })}\n`, shutdown);
      } catch {
        socket.destroy();
      }
    });
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Service control listener unavailable");
  writeServiceFile(file, { pid: process.pid, port: address.port, token });
  server.unref();
  return {
    async close() {
      server.close();
      const current = await readControl(file).catch(() => undefined);
      if (current?.token === token) await unlink(file).catch(() => undefined);
    },
  };
}

export async function requestServiceShutdown(file: string, pid: number): Promise<void> {
  const control = await readControl(file);
  if (control.pid !== pid) throw new Error("Service ownership changed; the process was preserved");
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: control.port });
    const timeout = setTimeout(() => socket.destroy(new Error("Service control timed out")), 3_000);
    let body = "";
    socket.once("connect", () =>
      socket.write(`${JSON.stringify({ action: "stop", token: control.token })}\n`),
    );
    socket.on("data", (data) => {
      body += data.toString();
      if (body.length > 2048) socket.destroy(new Error("Invalid service response"));
    });
    socket.once("error", reject);
    socket.once("close", () => {
      clearTimeout(timeout);
      try {
        const value = JSON.parse(body);
        if (value.pid !== pid || value.ok !== true)
          throw new Error("Service ownership could not be verified");
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function readControl(file: string): Promise<ControlRecord> {
  const result = JSON.parse(await readFile(file, "utf8")) as ControlRecord;
  if (
    !Number.isInteger(result.pid) ||
    result.pid < 1 ||
    !Number.isInteger(result.port) ||
    result.port < 1 ||
    result.port > 65535 ||
    !/^[a-zA-Z0-9_-]{43}$/.test(result.token)
  )
    throw new Error("Invalid service control record");
  return result;
}

function matches(expected: string, candidate?: string): boolean {
  if (typeof candidate !== "string") return false;
  const bytes = Buffer.from(candidate);
  return bytes.length === expected.length && timingSafeEqual(Buffer.from(expected), bytes);
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}
