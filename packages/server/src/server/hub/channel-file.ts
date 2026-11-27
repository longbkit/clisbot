import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, stat as statPath, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CHANNEL_FILE_WRITE_CHUNK_BYTES,
  CHANNEL_FILE_WRITE_MAX_BYTES,
} from "@clisbot/protocol/channel-files";
import type { AgentSessionConfig } from "../agent/agent-sdk-types.js";
import { sanitizeFileName } from "../file-upload/index.js";

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

/** One chunk of an inbound channel attachment, as the Hub sends it. */
export interface ChannelFileWriteChunk {
  fileId: string;
  fileName: string;
  size: number;
  offset: number;
  data: string;
}

/**
 * Write one chunk of an inbound channel attachment the Hub downloaded. The Hub
 * and this Host need not share a filesystem, so the Agent is pointed at this
 * copy, never at the Hub's. A file lives at
 * `<clisbotHome>/uploads/channel/<fileId>/<name>`, beside the app's uploads;
 * `fileId` is fixed per file, so a retried prompt names the same path and a
 * finished file is not written twice. Chunks arrive in order from offset 0
 * into a `.part` file, renamed once complete.
 */
export async function writeChannelFileChunk(
  clisbotHome: string,
  chunk: ChannelFileWriteChunk,
): Promise<{ receivedBytes: number; path: string | null }> {
  if (chunk.size > CHANNEL_FILE_WRITE_MAX_BYTES)
    throw new Error(`File exceeds the channel file limit of ${CHANNEL_FILE_WRITE_MAX_BYTES} bytes`);
  const bytes = Buffer.from(chunk.data, "base64");
  if (bytes.length > CHANNEL_FILE_WRITE_CHUNK_BYTES)
    throw new Error("Channel file chunk is too large");
  if (chunk.offset + bytes.length > chunk.size) throw new Error("Channel file chunk past its end");
  const directory = path.join(clisbotHome, "uploads", "channel", chunk.fileId);
  const finalPath = path.join(directory, sanitizeFileName(chunk.fileName));
  const finished = await sizeOf(finalPath);
  if (finished === chunk.size) return { receivedBytes: chunk.size, path: finalPath };
  const partPath = `${finalPath}.part`;
  if (chunk.offset === 0) await mkdir(directory, { recursive: true });
  else if ((await sizeOf(partPath)) !== chunk.offset)
    throw new Error("Channel file chunk out of order; send the file again from the start");
  await writeFile(partPath, bytes, { flag: chunk.offset === 0 ? "w" : "a" });
  const receivedBytes = chunk.offset + bytes.length;
  if (receivedBytes < chunk.size) return { receivedBytes, path: null };
  await rename(partPath, finalPath);
  return { receivedBytes, path: finalPath };
}

async function sizeOf(file: string): Promise<number | undefined> {
  const found = await statPath(file).catch(() => undefined);
  return found?.isFile() ? found.size : undefined;
}
