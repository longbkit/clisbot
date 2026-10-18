import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  attachSessionFiles,
  resolveLinkedSessionFile,
  type SessionFileReference,
} from "../file-upload/session-files.js";
import type { ChatMessageFiles } from "../chats/chat-engine.js";

import type { StoredQueueContent } from "./content.js";

function filePath(directory: string, file: SessionFileReference): string {
  if (
    !file.id ||
    !file.fileName ||
    /[\\/]/.test(file.id + file.fileName) ||
    (file.id + file.fileName).includes("\0") ||
    file.id === "." ||
    file.id === ".." ||
    file.fileName === "." ||
    file.fileName === ".." ||
    file.relativePath !== path.join("uploads", file.id, file.fileName)
  )
    throw new Error("Invalid queued file reference");
  return path.join(directory, file.relativePath);
}
export async function validateQueueFiles(
  directory: string,
  content: StoredQueueContent,
): Promise<void> {
  for (const file of content.files) {
    const info = await fs.lstat(filePath(directory, file));
    if (!info.isFile() || info.isSymbolicLink() || info.size !== file.size)
      throw new Error("Queued attachment is missing or incomplete");
  }
}
export async function hydrateQueueContent(
  directory: string,
  content: StoredQueueContent,
): Promise<ChatMessageFiles & { text: string }> {
  await validateQueueFiles(directory, content);
  return {
    text: content.text,
    attachments: content.attachments,
    images: await Promise.all(
      content.images.map(async (file) => ({
        data: (await fs.readFile(filePath(directory, file))).toString("base64"),
        mimeType: file.mimeType,
      })),
    ),
  };
}

interface PrepareQueueFilesOptions {
  directory: string;
  text: string;
  files: ChatMessageFiles;
  ownsUpload: Parameters<typeof attachSessionFiles>[0]["ownsUpload"];
  resolveForkSource?: Parameters<typeof attachSessionFiles>[0]["resolveForkSource"];
  previous?: StoredQueueContent;
  retainedFiles?: SessionFileReference[];
  identity: StoredQueueContent["identity"];
  fingerprint: string;
}

function uploadKey(file: {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  path: string;
}): string {
  return JSON.stringify([
    file.id,
    file.fileName,
    file.mimeType,
    file.size,
    path.resolve(file.path),
  ]);
}

function previousUpload(
  input: PrepareQueueFilesOptions,
  file: { id: string; fileName: string; mimeType: string; size: number; path: string },
): boolean {
  return Boolean(
    [...(input.previous?.files ?? []), ...(input.retainedFiles ?? [])].some(
      (old) =>
        old.id === file.id &&
        old.fileName === file.fileName &&
        old.mimeType === file.mimeType &&
        old.size === file.size &&
        filePath(input.directory, old) === path.resolve(file.path),
    ),
  );
}

async function retainedUploads(input: PrepareQueueFilesOptions): Promise<Set<string>> {
  const retained = new Set<string>();
  for (const file of input.files.attachments ?? []) {
    if (file.type !== "uploaded_file" || input.ownsUpload(file) || previousUpload(input, file))
      continue;
    try {
      const linked = await resolveLinkedSessionFile(input.directory, file.path);
      if (
        linked.id === file.id &&
        linked.fileName === file.fileName &&
        linked.mimeType === file.mimeType &&
        linked.size === file.size
      )
        retained.add(uploadKey(file));
    } catch {
      /* Unlinked drafts remain connection-owned. */
    }
  }
  return retained;
}

/** Existing upload ownership and storage; no queue-specific blob store. */
export async function prepareQueueFiles(
  input: PrepareQueueFilesOptions,
): Promise<StoredQueueContent> {
  const retained = await retainedUploads(input);
  const result = await attachSessionFiles({
    directory: input.directory,
    messageId: `queue_${randomUUID()}`,
    attachments: input.files.attachments,
    images: input.files.images,
    queueOnly: true,
    resolveForkSource: input.resolveForkSource,
    ownsUpload: (file) =>
      input.ownsUpload(file) || retained.has(uploadKey(file)) || previousUpload(input, file),
  });
  const imageCount = input.files.images?.length ?? 0;
  // attachSessionFiles adds uploaded files, then images, then fork context files.
  const uploadedCount =
    input.files.attachments?.filter((file) => file.type === "uploaded_file").length ?? 0;
  return {
    text: input.text,
    attachments: result.attachments,
    files: result.links.files,
    images: result.links.files.slice(uploadedCount, uploadedCount + imageCount),
    fingerprint: input.fingerprint,
    identity: input.identity,
  };
}

/** A bounded read of a file still held by this target, for a local editor copy. */
export async function readQueueFileChunk(
  directory: string,
  content: StoredQueueContent,
  fileId: string,
  offset: number,
) {
  const file = content.files.find((value) => value.id === fileId);
  if (!file || offset > file.size) throw new Error("Queued file is unavailable");
  await validateQueueFiles(directory, content);
  const handle = await fs.open(filePath(directory, file), "r");
  try {
    const bytes = Buffer.alloc(Math.min(64 * 1024, file.size - offset));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, offset);
    if (bytesRead !== bytes.length) throw new Error("Queued file is incomplete");
    return { data: bytes.toString("base64"), done: offset + bytesRead === file.size };
  } finally {
    await handle.close();
  }
}
