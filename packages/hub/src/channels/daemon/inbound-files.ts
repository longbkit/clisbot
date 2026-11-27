// Inbound channel attachments on the Agent's own Host. A vertical downloads a
// message's files into the account's downloads dir on the Hub and folds an
// `[Attached files]` manifest into the text, one line per file ending in
// `→ <absolute path>` (`buildAttachedFilesManifest`, `@clisbot/channels-shared`).
// That path exists only on the Hub. The Hub and the Host share a filesystem only
// when both run on one machine, so before a prompt goes out each such file is
// written to the Host (`channel.file.write.request`) and its line names the
// Host's copy. A file that cannot go says why on its line; the Agent is never
// given a Hub path.
import { createHash } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  CHANNEL_FILE_WRITE_CHUNK_BYTES,
  CHANNEL_FILE_WRITE_MAX_BYTES,
} from "@clisbot/protocol/channel-files";

/** One manifest line: `1. name (kind, 123 bytes) → /abs/path`. */
const MANIFEST_ENTRY = /^(\d+\. .+ \([^(),\n]+, \d+ bytes\)) → (\/.+)$/gm;

/** What the Host offers for one file write. */
export interface InboundFileHost {
  /** The Host advertises `channelFileWrite`. */
  canWrite: boolean;
  write(chunk: {
    agentId: string;
    fileId: string;
    fileName: string;
    size: number;
    offset: number;
    data: string;
  }): Promise<{ receivedBytes: number; path: string | null }>;
}

export const NOT_ON_HUB = "not sent: the file is no longer on the Hub";
export const HOST_TOO_OLD =
  "not sent: update Clisbot on the machine that runs this agent so it can receive channel files";

/**
 * The prompt with every manifest line that names a file in `downloadsDir`
 * pointing at the Host's copy instead. Lines naming anything else are left as
 * written: a sender can type a manifest line, and only the account's own
 * downloads are ever read. The Host path is fixed per file, so a retried
 * prompt is the same request.
 */
export async function stageInboundFiles(
  text: string,
  options: { agentId: string; downloadsDir: string | undefined; host: InboundFileHost },
): Promise<string> {
  const { downloadsDir } = options;
  if (downloadsDir === undefined || !text.includes(" → ")) return text;
  const entries = [...text.matchAll(MANIFEST_ENTRY)];
  let staged = text;
  for (const [line, entry, hubPath] of entries) {
    if (line === undefined || entry === undefined || hubPath === undefined) continue;
    const local = await downloadedFile(downloadsDir, hubPath);
    if (local === "outside") continue;
    const target = local === "missing" ? `— ${NOT_ON_HUB}` : await stageOne(local, options);
    staged = staged.replace(line, () => `${entry} ${target}`);
  }
  return staged;
}

interface DownloadedFile {
  path: string;
  name: string;
  size: number;
  modifiedMs: number;
}

/** The file a manifest path names, when it is one of the account's downloads. */
async function downloadedFile(
  downloadsDir: string,
  hubPath: string,
): Promise<DownloadedFile | "outside" | "missing"> {
  const resolved = path.resolve(hubPath);
  if (!isInside(path.resolve(downloadsDir), resolved)) return "outside";
  const [root, real] = await Promise.all([
    realpath(downloadsDir).catch(() => undefined),
    realpath(resolved).catch(() => undefined),
  ]);
  if (root === undefined || real === undefined) return "missing";
  if (!isInside(root, real)) return "outside";
  const found = await stat(real).catch(() => undefined);
  if (!found?.isFile()) return "missing";
  return { path: real, name: path.basename(real), size: found.size, modifiedMs: found.mtimeMs };
}

function isInside(root: string, candidate: string): boolean {
  return candidate.startsWith(root + path.sep);
}

/** `→ <Host path>`, or `— <why it was not sent>`. */
async function stageOne(
  file: DownloadedFile,
  options: { agentId: string; host: InboundFileHost },
): Promise<string> {
  if (file.size > CHANNEL_FILE_WRITE_MAX_BYTES) {
    const limitMb = CHANNEL_FILE_WRITE_MAX_BYTES / 1024 / 1024;
    return `— not sent: larger than the ${limitMb} MB limit for files sent to the agent`;
  }
  if (!options.host.canWrite) return `— ${HOST_TOO_OLD}`;
  const fileId = createHash("sha256")
    .update(JSON.stringify([options.agentId, file.path, file.size, file.modifiedMs]))
    .digest("hex");
  const hostPath = await writeToHost(file, fileId, options);
  return `→ ${hostPath}`;
}

/** Send the file in order from offset 0; the last answer names the Host path. */
async function writeToHost(
  file: DownloadedFile,
  fileId: string,
  options: { agentId: string; host: InboundFileHost },
): Promise<string> {
  const handle = await open(file.path, "r");
  try {
    const buffer = Buffer.alloc(Math.min(CHANNEL_FILE_WRITE_CHUNK_BYTES, file.size));
    let offset = 0;
    do {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (bytesRead === 0 && offset < file.size) throw new Error("Hub file shrank while sending");
      const result = await options.host.write({
        agentId: options.agentId,
        fileId,
        fileName: file.name,
        size: file.size,
        offset,
        data: buffer.subarray(0, bytesRead).toString("base64"),
      });
      if (result.path !== null) return result.path;
      if (result.receivedBytes !== offset + bytesRead)
        throw new Error("Host file write lost its place");
      offset = result.receivedBytes;
    } while (offset < file.size);
    throw new Error("Host did not confirm the file");
  } finally {
    await handle.close();
  }
}
