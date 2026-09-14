import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import type { AgentAttachment } from "../messages.js";
import {
  createDurableDirectory,
  writeDurableFile,
  writeDurableJson,
  syncDirectory,
} from "../agent/session-storage/durable-file.js";

import { PagedJournal } from "../agent/session-storage/paged-journal.js";

type UploadedFile = Extract<AgentAttachment, { type: "uploaded_file" }>;
export interface SessionFileReference {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  relativePath: string;
}
export interface ForkSessionSource {
  agentId: string;
  epoch: string;
  seq: number;
}
export type ResolveForkSource = (
  source: ForkSessionSource,
) => Promise<{ directory: string; messageIds: AsyncIterable<string> }>;
export interface SessionMessageFiles {
  version: 1;
  clientMessageId: string;
  files: SessionFileReference[];
  imageDigests: string[];
  forkSources?: ForkSessionSource[];
  forkPaths?: { attachmentIndex: number; sourceRelativePath: string; targetRelativePath: string }[];
}

export {
  registerSessionUpload,
  withSessionFileOperation,
  beginSessionFileDelete,
  deleteSessionDirectory,
} from "./session-file-activity.js";
import {
  withSessionFileOperation,
  withSessionFileLease,
  hasSessionUploads,
} from "./session-file-activity.js";

function safePart(value: string): string {
  if (!value || value === "." || value === ".." || /[\\/]/.test(value) || value.includes("\0"))
    throw new Error("Invalid session file identity");
  return value;
}
function messagePath(directory: string, messageId: string): string {
  return path.join(
    directory,
    "uploads",
    ".messages",
    `${createHash("sha256").update(messageId).digest("hex")}.json`,
  );
}
function imageFileName(mimeType: string): string {
  if (mimeType === "image/png") return "image.png";
  if (mimeType === "image/jpeg") return "image.jpg";
  return "image.bin";
}
function imageDigest(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function digestFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}
async function copyDurable(source: string, destination: string): Promise<void> {
  await createDurableDirectory(path.dirname(destination));
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await fs.copyFile(source, temporary, fs.constants.COPYFILE_EXCL);
    const handle = await fs.open(temporary, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.link(temporary, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if ((await digestFile(temporary)) !== (await digestFile(destination)))
        throw new Error("Session file destination conflicts with existing content", {
          cause: error,
        });
    }
    await syncDirectory(path.dirname(destination));
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
async function readMessageFiles(
  directory: string,
  messageId: string,
): Promise<SessionMessageFiles | null> {
  try {
    const filePath = messagePath(directory, messageId);
    if ((await fs.stat(filePath)).size > MAX_FILE_LINK_BYTES)
      throw new Error("Session file links exceed byte limit");
    return JSON.parse(await fs.readFile(filePath, "utf8")) as SessionMessageFiles;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const journal = new PagedJournal<SessionMessageFiles>(path.join(directory, "uploads", ".links"));
  const journalState = await journal.state();
  for (let start = journalState.minSeq; start > 0 && start <= journalState.maxSeq; start += 1) {
    const matchedEntry = (await journal.read(start, start)).find(
      (entry) => entry.value.clientMessageId === messageId,
    );
    if (matchedEntry) return matchedEntry.value;
  }
  return null;
}
const MAX_FILE_LINK_BYTES = 1024 * 1024;
const MAX_MESSAGE_FILES = 256;
function checkLinkBudget(
  files: SessionFileReference[],
  paths: NonNullable<SessionMessageFiles["forkPaths"]> = [],
): void {
  if (
    files.length > MAX_MESSAGE_FILES ||
    paths.length > MAX_MESSAGE_FILES ||
    Buffer.byteLength(JSON.stringify({ files, paths })) > MAX_FILE_LINK_BYTES
  )
    throw new Error("Session file storage overloaded: attachment metadata budget exceeded");
}
async function recordMessageFiles(directory: string, links: SessionMessageFiles): Promise<void> {
  checkLinkBudget(links.files, links.forkPaths);
  const journal = new PagedJournal<SessionMessageFiles>(path.join(directory, "uploads", ".links"));
  await journal.append([{ seq: (await journal.state()).maxSeq + 1, value: links }]);
  await writeDurableJson(messagePath(directory, links.clientMessageId), links);
}

async function addUploadedFiles(
  input: Parameters<typeof attachSessionFiles>[0],
  uploaded: UploadedFile[],
  files: SessionFileReference[],
): Promise<void> {
  for (const upload of uploaded) {
    if (!input.ownsUpload(upload))
      throw new Error("Uploaded file does not belong to this connection");
    const relativePath = path.join("uploads", safePart(upload.id), safePart(upload.fileName));
    const destination = path.join(input.directory, relativePath);
    const source = await fs.lstat(upload.path);
    if (!source.isFile() || source.isSymbolicLink() || source.size !== upload.size)
      throw new Error("Uploaded file is incomplete or invalid");
    if (path.resolve(upload.path) !== path.resolve(destination)) {
      await copyDurable(upload.path, destination);
    }
    const handle = await fs.open(destination, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory(path.dirname(destination));
    files.push({
      id: upload.id,
      fileName: upload.fileName,
      mimeType: upload.mimeType,
      size: upload.size,
      relativePath,
    });
  }
}

async function addForkFiles(
  input: Parameters<typeof attachSessionFiles>[0],
  files: SessionFileReference[],
): Promise<NonNullable<SessionMessageFiles["forkPaths"]>> {
  const forkPaths: NonNullable<SessionMessageFiles["forkPaths"]> = [];
  for (const [attachmentIndex, attachment] of (input.attachments ?? []).entries()) {
    if (
      attachment.type !== "text" ||
      attachment.contextKind !== "chat_history" ||
      !attachment.sourceSession
    )
      continue;
    if (!input.resolveForkSource) throw new Error("Fork file source resolution is unavailable");
    const sourceAnchor = attachment.sourceSession;
    const source = await input.resolveForkSource(sourceAnchor);
    await withSessionFileLease(source.directory, async () => {
      for await (const sourceMessageId of source.messageIds) {
        const sourceLinks = await readMessageFiles(source.directory, sourceMessageId);
        if (!sourceLinks) continue;
        for (const file of sourceLinks.files) {
          if (
            file.relativePath !== path.join("uploads", safePart(file.id), safePart(file.fileName))
          )
            throw new Error("Invalid stored fork file reference");
          const sourcePath = path.join(source.directory, file.relativePath);
          const id = `fork_${createHash("sha256").update(input.messageId).update(sourceAnchor.agentId).update(file.id).digest("hex")}`;
          const relativePath = path.join("uploads", id, file.fileName);
          await writeDurableJson(path.join(input.directory, "uploads", id, "upload.json"), {
            version: 1,
            status: "draft",
            createdAt: new Date().toISOString(),
            id,
            fileName: file.fileName,
            mimeType: file.mimeType,
            size: file.size,
          });
          await copyDurable(sourcePath, path.join(input.directory, relativePath));
          if (!files.some((storedFile) => storedFile.id === id))
            files.push({ ...file, id, relativePath });
          if (forkPaths.length >= MAX_MESSAGE_FILES || files.length > MAX_MESSAGE_FILES)
            throw new Error("Session file storage overloaded: fork attachment budget exceeded");
          forkPaths.push({
            attachmentIndex,
            sourceRelativePath: path.relative(input.directory, sourcePath),
            targetRelativePath: relativePath,
          });
          checkLinkBudget(files, forkPaths);
        }
      }
    });
  }
  return forkPaths;
}

function retainedMetadataBytes(value: unknown, depth = 0): number {
  if (depth > 16)
    throw new Error("Session file storage overloaded: attachment nesting budget exceeded");
  if (typeof value === "string") return value.length * 4;
  if (!value || typeof value !== "object") return 16;
  let bytes = 128;
  if (Array.isArray(value)) {
    bytes += value.length * 32;
    if (bytes > 16 * 1024 * 1024)
      throw new Error("Session file storage overloaded: attachment metadata budget exceeded");
    for (const child of value) {
      bytes += retainedMetadataBytes(child, depth + 1);
      if (bytes > 16 * 1024 * 1024)
        throw new Error("Session file storage overloaded: attachment metadata budget exceeded");
    }
  } else {
    for (const [key, child] of Object.entries(value)) {
      bytes += key.length * 4 + retainedMetadataBytes(child, depth + 1);
      if (bytes > 16 * 1024 * 1024)
        throw new Error("Session file storage overloaded: attachment metadata budget exceeded");
    }
  }
  return bytes;
}
function attachmentInputBytes(input: {
  attachments?: AgentAttachment[];
  images?: { data: string; mimeType: string }[];
}): number {
  if ((input.attachments?.length ?? 0) + (input.images?.length ?? 0) > 64)
    throw new Error("Session file storage overloaded: too many attachments");
  let bytes = MAX_FILE_LINK_BYTES * 4 + retainedMetadataBytes(input.attachments);
  // Reserve caller data, its immutable snapshot and decoded image buffers before allocating copies.
  for (const image of input.images ?? [])
    bytes += image.data.length * 5 + image.mimeType.length * 4;
  return bytes;
}

/** Files cross into session ownership only here, before a prompt is sent to a provider. */
export async function attachSessionFiles(input: {
  directory: string;
  messageId: string;
  attachments?: AgentAttachment[];
  images?: { data: string; mimeType: string }[];
  ownsUpload: (attachment: UploadedFile) => boolean;
  resolveForkSource?: ResolveForkSource;
}): Promise<{
  attachments?: AgentAttachment[];
  images?: { data: string; mimeType: string }[];
  links: SessionMessageFiles;
}> {
  return withSessionFileOperation(
    input.directory,
    async () => {
      const uploaded = (input.attachments ?? []).filter(
        (item): item is UploadedFile => item.type === "uploaded_file",
      );
      const imageData = (input.images ?? []).map((image) => Buffer.from(image.data, "base64"));
      const digests = imageData.map(imageDigest);
      const forkSources = (input.attachments ?? []).flatMap((item) =>
        item.type === "text" && item.contextKind === "chat_history" && item.sourceSession
          ? [item.sourceSession]
          : [],
      );
      const rewriteForkText = (
        attachments: AgentAttachment[] | undefined,
        links: SessionMessageFiles,
      ) =>
        attachments?.map((item, index) => {
          if (item.type !== "text" || item.contextKind !== "chat_history") return item;
          let text = item.text;
          for (const mapping of links.forkPaths ?? []) {
            if (mapping.attachmentIndex === index)
              text = text.replaceAll(
                path.resolve(input.directory, mapping.sourceRelativePath),
                path.resolve(input.directory, mapping.targetRelativePath),
              );
          }
          return { ...item, text };
        });
      const existing = await readMessageFiles(input.directory, input.messageId);
      if (existing) {
        if (
          existing.clientMessageId !== input.messageId ||
          JSON.stringify(
            existing.files
              .filter((file) => !file.id.startsWith("image_") && !file.id.startsWith("fork_"))
              .map((file) => [file.id, file.fileName, file.mimeType, file.size]),
          ) !==
            JSON.stringify(
              uploaded.map((file) => [file.id, file.fileName, file.mimeType, file.size]),
            ) ||
          JSON.stringify(existing.imageDigests) !== JSON.stringify(digests) ||
          JSON.stringify(existing.forkSources ?? []) !== JSON.stringify(forkSources)
        )
          throw new Error("Message attachment retry conflicts with the accepted files");
        const byId = new Map(existing.files.map((file) => [file.id, file]));
        return {
          attachments: rewriteForkText(input.attachments, existing)?.map((item) =>
            item.type === "uploaded_file"
              ? Object.assign({}, item, {
                  path: path.join(input.directory, byId.get(item.id)!.relativePath),
                })
              : item,
          ),
          images: input.images,
          links: existing,
        };
      }
      const files: SessionFileReference[] = [];
      await addUploadedFiles(input, uploaded, files);
      for (let index = 0; index < imageData.length; index += 1) {
        const id = `image_${createHash("sha256").update(input.messageId).update(String(index)).digest("hex")}`;
        const mimeType = input.images![index].mimeType;
        const fileName = imageFileName(mimeType);
        const relativePath = path.join("uploads", id, fileName);
        await writeDurableJson(path.join(input.directory, "uploads", id, "upload.json"), {
          version: 1,
          status: "draft",
          createdAt: new Date().toISOString(),
          id,
          fileName,
          mimeType,
          size: imageData[index].length,
        });
        await writeDurableFile(path.join(input.directory, relativePath), imageData[index]);
        files.push({
          id,
          fileName,
          mimeType,
          size: imageData[index].length,
          relativePath,
        });
      }
      const forkPaths = await addForkFiles(input, files);
      const links: SessionMessageFiles = {
        version: 1,
        clientMessageId: input.messageId,
        files,
        imageDigests: digests,
        ...(forkSources.length ? { forkSources, forkPaths } : {}),
      };
      await recordMessageFiles(input.directory, links);
      // The message link is authoritative. A stale draft marker cannot cause deletion of linked files.
      for (const file of files)
        await writeDurableJson(path.join(input.directory, "uploads", file.id, "upload.json"), {
          version: 1,
          status: "attached",
          clientMessageId: input.messageId,
          file,
        });
      const byId = new Map(files.map((file) => [file.id, file]));
      return {
        attachments: rewriteForkText(input.attachments, links)?.map((item) =>
          item.type === "uploaded_file"
            ? Object.assign({}, item, {
                path: path.join(input.directory, byId.get(item.id)!.relativePath),
              })
            : item,
        ),
        images: input.images,
        links,
      };
    },
    attachmentInputBytes(input),
    () => {
      input = {
        ...input,
        attachments: structuredClone(input.attachments),
        images: structuredClone(input.images),
      };
    },
  );
}

export const SESSION_DRAFT_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Crash-left draft markers require canonical link confirmation before any bytes are removed. */
async function isFileLinked(directory: string, fileId: string): Promise<boolean> {
  const journal = new PagedJournal<SessionMessageFiles>(path.join(directory, "uploads", ".links"));
  const journalState = await journal.state();
  for (let start = journalState.minSeq; start > 0 && start <= journalState.maxSeq; start += 1)
    for (const entry of await journal.read(start, start))
      if (entry.value.files.some((file) => file.id === fileId)) return true;
  return false;
}

/** Unknown/legacy files and in-progress transfers are retained; traversal keeps no global ID set. */
export async function pruneSessionDrafts(directory: string, now = Date.now()): Promise<number> {
  return withSessionFileOperation(
    directory,
    async () => {
      if (hasSessionUploads(directory)) return 0;
      let entries;
      try {
        entries = await fs.opendir(path.join(directory, "uploads"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
        throw error;
      }
      let removed = 0;
      for await (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const metadataPath = path.join(directory, "uploads", entry.name, "upload.json");
        let metadata: { status?: string; createdAt?: string };
        try {
          if ((await fs.stat(metadataPath)).size > MAX_FILE_LINK_BYTES) continue;
          metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError)
            continue;
          throw error;
        }
        if (
          metadata.status !== "draft" ||
          !metadata.createdAt ||
          !Number.isFinite(Date.parse(metadata.createdAt)) ||
          now - Date.parse(metadata.createdAt) <= SESSION_DRAFT_RETENTION_MS
        )
          continue;
        if (await isFileLinked(directory, entry.name)) {
          // Repair the nonauthoritative marker once; subsequent maintenance avoids a history scan.
          await writeDurableJson(metadataPath, { ...metadata, status: "attached" });
          continue;
        }
        await fs.rm(path.join(directory, "uploads", entry.name), { recursive: true, force: true });
        removed += 1;
      }
      if (removed) await syncDirectory(path.join(directory, "uploads"));
      return removed;
    },
    MAX_FILE_LINK_BYTES * 4,
  );
}

/** Only canonical message links grant session-read access; unsent drafts remain connection-owned. */
export async function resolveLinkedSessionFile(
  directory: string,
  requestedPath: string,
): Promise<SessionFileReference> {
  return withSessionFileLease(
    directory,
    async () => {
      const relativePath = path.isAbsolute(requestedPath)
        ? path.relative(directory, requestedPath)
        : requestedPath;
      const parts = relativePath.split(path.sep);
      if (parts.length !== 3 || parts[0] !== "uploads" || parts[1].startsWith("."))
        throw new Error("Session file not found");
      safePart(parts[1]);
      safePart(parts[2]);
      const journal = new PagedJournal<SessionMessageFiles>(
        path.join(directory, "uploads", ".links"),
      );
      const journalState = await journal.state();
      for (let seq = journalState.minSeq; seq > 0 && seq <= journalState.maxSeq; seq++) {
        const entries = await journal.read(seq, seq);
        for (const entry of entries) {
          const file = entry.value.files.find(
            (candidate) =>
              candidate.id === parts[1] &&
              candidate.fileName === parts[2] &&
              candidate.relativePath === relativePath,
          );
          if (file) return { ...file };
        }
      }
      throw new Error("Session file not found");
    },
    MAX_FILE_LINK_BYTES * 4,
  );
}
