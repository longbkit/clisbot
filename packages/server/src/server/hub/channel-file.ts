import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import type { AgentSessionConfig } from "../agent/agent-sdk-types.js";

/** Channel tools run as the agent's Host user. Do not impose a second,
 * Project-root filesystem policy on files the agent sends. The Hub must prove
 * that this is the session carrying the calling channel capability. */
export async function readChannelFileChunk(
  config: Pick<AgentSessionConfig, "mcpServers"> | undefined,
  request: {
    capabilityHash: string;
    path: string;
    offset: number;
    maxBytes: number;
    version?: string;
  },
): Promise<{ data: string; size: number; version: string }> {
  const server = config?.mcpServers?.channel_reply;
  const url = server && "url" in server ? new URL(server.url) : undefined;
  const token = url?.pathname.match(/^\/mcp\/channel\/([^/]+)$/)?.[1];
  if (!token || createHash("sha256").update(token).digest("hex") !== request.capabilityHash) {
    throw new Error("Channel file access does not belong to this agent session");
  }
  if (!path.isAbsolute(request.path)) throw new Error("File path must be absolute");
  // Nonblocking open prevents a FIFO/device path from hanging the Host.
  const file = await open(request.path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error("Not a regular file");
    if (stat.size > request.maxBytes) throw new Error("File exceeds the channel upload limit");
    const version = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    if (request.version !== undefined && request.version !== version) {
      throw new Error("File changed while sending; retry after it finishes writing");
    }
    if (request.offset > stat.size) throw new Error("Invalid file offset");
    const bytes = Buffer.alloc(Math.min(512 * 1024, stat.size - request.offset));
    const { bytesRead } = await file.read(bytes, 0, bytes.length, request.offset);
    const after = await file.stat();
    if (
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs
    ) {
      throw new Error("File changed while sending; retry after it finishes writing");
    }
    return { data: bytes.subarray(0, bytesRead).toString("base64"), size: stat.size, version };
  } finally {
    await file.close();
  }
}
