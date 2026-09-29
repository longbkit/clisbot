import { appendFile, mkdir, rm, writeFile, open } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createDurableDirectory, writeDurableJson } from "../agent/session-storage/durable-file.js";
import { registerSessionUpload } from "./session-files.js";
import { basename, dirname, extname, join } from "node:path";

import { FileTransferOpcode, type FileTransferFrame } from "@clisbot/protocol/binary-frames/index";
import { getErrorMessage } from "@clisbot/protocol/error-utils";
import type { AgentAttachment, FileUploadRequest, FileUploadResponse } from "../messages.js";

type UploadedFileAttachment = Extract<AgentAttachment, { type: "uploaded_file" }>;

interface FileUploadStoreOptions {
  clisbotHome: string;
  staleUploadTimeoutMs?: number;
  sessionStorageEnabled?: () => boolean;
  resolveAgentDirectory?: (agentId: string) => Promise<string>;
}

interface PendingUpload {
  requestId: string;
  id: string;
  source: object;
  completed: boolean;
  finished(response: FileUploadResponse | null): void;
  fileName: string;
  mimeType: string;
  size: number;
  path: string;
  receivedBytes: number;
  started: boolean;
  staleTimeout: ReturnType<typeof setTimeout>;
  queue: Promise<void>;
  destination?: Promise<string>;
  unregister?: () => void;
  sessionDirectory?: string;
  durable: boolean;
  queuedFrames: number;
  cleanup?: Promise<void>;
}

let globalQueuedUploadBytes = 0;
let globalQueuedUploadFrames = 0;
const MAX_QUEUED_UPLOAD_BYTES = 16 * 1024 * 1024;
const MAX_PENDING_UPLOADS = 16;
const MAX_COMPLETED_UPLOADS = 256;

export class FileUploadStore {
  private static readonly defaultStaleUploadTimeoutMs = 10 * 60 * 1000;

  private readonly clisbotHome: string;
  private readonly staleUploadTimeoutMs: number;
  private readonly defaultSource = {};
  private readonly pending = new Map<object, Map<string, PendingUpload>>();
  private readonly completed = new Map<string, UploadedFileAttachment>();

  constructor(private readonly options: FileUploadStoreOptions) {
    this.clisbotHome = options.clisbotHome;
    this.staleUploadTimeoutMs =
      options.staleUploadTimeoutMs ?? FileUploadStore.defaultStaleUploadTimeoutMs;
  }

  beginUpload(
    request: FileUploadRequest,
    source: object = this.defaultSource,
    finished: (response: FileUploadResponse | null) => void = () => {},
  ): () => Promise<void> {
    const count = [...this.pending.values()].reduce((total, uploads) => total + uploads.size, 0);
    if (count >= MAX_PENDING_UPLOADS || this.completed.size >= MAX_COMPLETED_UPLOADS)
      throw new Error("Upload storage overloaded: too many unfinished drafts");
    const existingUpload = this.pending.get(source)?.get(request.requestId);
    if (existingUpload) void this.cancel(existingUpload).catch(() => {});
    const fileName = sanitizeFileName(request.fileName);
    const durable = this.options.sessionStorageEnabled?.() === true;
    const id = `upload_${randomUUID()}`;
    const uploadDir = join(this.clisbotHome, "uploads", id);
    const upload: PendingUpload = {
      requestId: request.requestId,
      id,
      source,
      completed: false,
      finished,
      fileName,
      mimeType: request.mimeType,
      size: request.size,
      path: join(uploadDir, fileName),
      receivedBytes: 0,
      started: false,
      staleTimeout: this.createStaleUploadTimeout(source, request.requestId),
      queue: Promise.resolve(),
      durable,
      queuedFrames: 0,
      ...(durable && request.agentId && this.options.resolveAgentDirectory
        ? { destination: this.options.resolveAgentDirectory(request.agentId) }
        : {}),
    };
    // Reserve synchronously; the binary stream may immediately follow this request.
    upload.destination?.catch(() => undefined);
    const uploads = this.pending.get(source) ?? new Map<string, PendingUpload>();
    uploads.set(request.requestId, upload);
    this.pending.set(source, uploads);
    return () => this.cancel(upload);
  }

  async receiveFrame(
    frame: FileTransferFrame,
    source: object = this.defaultSource,
  ): Promise<FileUploadResponse | null> {
    const upload = this.pending.get(source)?.get(frame.requestId);
    if (!upload) {
      return null;
    }
    this.refreshStaleUploadTimeout(upload);

    const bytes = frame.opcode === FileTransferOpcode.FileChunk ? frame.payload.byteLength : 0;
    if (
      globalQueuedUploadBytes + bytes > MAX_QUEUED_UPLOAD_BYTES ||
      globalQueuedUploadFrames >= 512 ||
      upload.queuedFrames >= 64
    ) {
      const response = buildUploadResponse(
        upload,
        "Upload storage overloaded: pending frame/byte limit exceeded",
      );
      await this.cancel(upload, response);
      return response;
    }
    globalQueuedUploadBytes += bytes;
    globalQueuedUploadFrames += 1;
    upload.queuedFrames += 1;
    const operation = upload.queue
      .then(() => this.applyFrame(upload, frame))
      .finally(() => {
        globalQueuedUploadBytes -= bytes;
        globalQueuedUploadFrames -= 1;
        upload.queuedFrames -= 1;
      });
    void operation.then(
      (response) => {
        if (response) upload.finished(response);
        return undefined;
      },
      () => {
        upload.finished(null);
        return undefined;
      },
    );
    upload.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  ownsUploadedFile(attachment: UploadedFileAttachment): boolean {
    const completed = this.completed.get(attachment.id);
    return (
      completed !== undefined &&
      completed.fileName === attachment.fileName &&
      completed.mimeType === attachment.mimeType &&
      completed.size === attachment.size &&
      completed.path === attachment.path
    );
  }

  async releaseLinkedUploads(attachments: readonly AgentAttachment[]): Promise<void> {
    for (const attachment of attachments) {
      if (attachment.type !== "uploaded_file" || !this.ownsUploadedFile(attachment)) continue;
      this.completed.delete(attachment.id);
      const temporaryDirectory = join(this.clisbotHome, "uploads", attachment.id);
      if (dirname(attachment.path) === temporaryDirectory)
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async dispose(): Promise<void> {
    const pending: PendingUpload[] = [];
    for (const uploads of this.pending.values()) pending.push(...uploads.values());
    for (const upload of pending) this.clearPendingUpload(upload);
    await Promise.all(
      pending.map(async (upload) => {
        await upload.queue;
        await this.removeUploadDirectory(upload);
      }),
    );
    this.completed.clear();
  }

  private async applyFrame(
    upload: PendingUpload,
    frame: FileTransferFrame,
  ): Promise<FileUploadResponse | null> {
    if (this.pending.get(upload.source)?.get(upload.requestId) !== upload) {
      return null;
    }

    try {
      if (frame.opcode === FileTransferOpcode.FileBegin) {
        await this.startWriting(upload);
        return null;
      }
      if (frame.opcode === FileTransferOpcode.FileChunk) {
        await this.writeChunk(upload, frame.payload);
        return null;
      }
      return await this.completeUpload(upload);
    } catch (error) {
      await this.removeFailedUpload(upload);
      return buildUploadResponse(upload, getErrorMessage(error));
    }
  }

  private async startWriting(upload: PendingUpload): Promise<void> {
    if (upload.destination) {
      const directory = await upload.destination;
      upload.sessionDirectory = directory;
      upload.path = join(directory, "uploads", upload.id, upload.fileName);
    }
    if (upload.durable) {
      upload.unregister = await registerSessionUpload(
        upload.sessionDirectory ?? this.clisbotHome,
        async () => {
          this.clearPendingUpload(upload);
          await upload.queue;
          await this.removeUploadDirectory(upload);
        },
      );
      if (this.pending.get(upload.source)?.get(upload.requestId) !== upload) {
        upload.unregister();
        upload.unregister = undefined;
        throw new Error("Upload was canceled before writing began");
      }
    }
    if (upload.durable) await createDurableDirectory(dirname(upload.path));
    else await mkdir(dirname(upload.path), { recursive: true });
    await writeFile(upload.path, new Uint8Array());
    upload.started = true;
  }

  private async writeChunk(upload: PendingUpload, bytes: Uint8Array): Promise<void> {
    if (!upload.started) {
      throw new Error("Upload chunks arrived before file begin.");
    }
    const nextReceivedBytes = upload.receivedBytes + bytes.byteLength;
    if (nextReceivedBytes > upload.size) {
      throw new Error(
        `Upload exceeded declared size: expected ${upload.size}, received ${nextReceivedBytes}.`,
      );
    }
    await appendFile(upload.path, bytes);
    upload.receivedBytes += bytes.byteLength;
  }

  private async completeUpload(upload: PendingUpload): Promise<FileUploadResponse> {
    if (!upload.started) throw new Error("Upload ended before file begin.");
    if (upload.receivedBytes !== upload.size) {
      this.clearPendingUpload(upload);
      await this.removeUploadDirectory(upload);
      return buildUploadResponse(
        upload,
        `Upload size mismatch: expected ${upload.size}, received ${upload.receivedBytes}.`,
      );
    }
    if (upload.durable) {
      const handle = await open(upload.path, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await writeDurableJson(join(dirname(upload.path), "upload.json"), {
        version: 1,
        status: "draft",
        createdAt: new Date().toISOString(),
        id: upload.id,
        fileName: upload.fileName,
        size: upload.size,
        mimeType: upload.mimeType,
      });
    }
    upload.completed = true;
    this.clearPendingUpload(upload);
    const response = buildUploadResponse(upload, null);
    if (response.payload.file) this.completed.set(upload.id, response.payload.file);
    return response;
  }

  private createStaleUploadTimeout(
    source: object,
    requestId: string,
  ): ReturnType<typeof setTimeout> {
    const timeout = setTimeout(() => {
      const upload = this.pending.get(source)?.get(requestId);
      if (upload) void this.cancel(upload).catch(() => {});
    }, this.staleUploadTimeoutMs);
    timeout.unref?.();
    return timeout;
  }

  private refreshStaleUploadTimeout(upload: PendingUpload): void {
    clearTimeout(upload.staleTimeout);
    upload.staleTimeout = this.createStaleUploadTimeout(upload.source, upload.requestId);
  }

  private cancel(upload: PendingUpload, response: FileUploadResponse | null = null): Promise<void> {
    if (upload.cleanup) return upload.cleanup;
    this.clearPendingUpload(upload);
    upload.cleanup = upload.queue.then(async () => {
      if (!upload.completed) await this.removeUploadDirectory(upload);
      return undefined;
    });
    upload.finished(response);
    return upload.cleanup;
  }

  private clearPendingUpload(upload: PendingUpload): void {
    clearTimeout(upload.staleTimeout);
    const unregister = upload.unregister;
    upload.unregister = undefined;
    if (unregister) void upload.queue.then(unregister, unregister);
    const uploads = this.pending.get(upload.source);
    if (uploads?.get(upload.requestId) === upload) uploads.delete(upload.requestId);
    if (uploads?.size === 0) this.pending.delete(upload.source);
  }

  private async removeFailedUpload(upload: PendingUpload): Promise<void> {
    this.clearPendingUpload(upload);
    await this.removeUploadDirectory(upload);
  }

  private async removeUploadDirectory(upload: PendingUpload): Promise<void> {
    await rm(dirname(upload.path), { recursive: true, force: true }).catch(() => undefined);
  }
}

function buildUploadResponse(upload: PendingUpload, error: string | null): FileUploadResponse {
  return {
    type: "file.upload.response",
    payload: {
      requestId: upload.requestId,
      file: error
        ? null
        : {
            type: "uploaded_file",
            id: upload.id,
            fileName: upload.fileName,
            mimeType: upload.mimeType,
            size: upload.size,
            path: upload.path,
          },
      error,
    },
  };
}

// Most file systems cap a single file name at 255 bytes.
const MAX_FILE_NAME_BYTES = 255;

// Keeps the client's file name, replacing only what cannot appear in a single
// file name on Linux, macOS, or Windows.
function sanitizeFileName(value: string): string {
  const name = basename(value)
    .replace(/[\p{Cc}\\/:*?"<>|]/gu, "_")
    .trim();
  return fitFileNameLength(name.length > 0 && name !== "." && name !== ".." ? name : "upload");
}

function fitFileNameLength(name: string): string {
  if (Buffer.byteLength(name) <= MAX_FILE_NAME_BYTES) return name;
  const extension = extname(name);
  const keptExtension = Buffer.byteLength(extension) < MAX_FILE_NAME_BYTES ? extension : "";
  let stem = "";
  for (const char of name.slice(0, name.length - keptExtension.length)) {
    if (Buffer.byteLength(stem + char + keptExtension) > MAX_FILE_NAME_BYTES) break;
    stem += char;
  }
  return stem + keptExtension;
}
