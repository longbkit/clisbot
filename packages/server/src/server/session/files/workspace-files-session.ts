import { retrySessionFileAdmission } from "../../file-upload/session-file-activity.js";
import type pino from "pino";
import type { SessionDelivery } from "../owned-subscriptions/index.js";
import type { FileVersion } from "@clisbot/protocol/messages";
import { getErrorMessage } from "@clisbot/protocol/error-utils";
import {
  encodeFileTransferFrame,
  FileTransferOpcode,
  type FileTransferFrame,
} from "@clisbot/protocol/binary-frames/index";
import type {
  AgentAttachment,
  FileDownloadTokenRequest,
  FileEntryCreateRequest,
  FileEntryDeleteRequest,
  FileEntryDuplicateRequest,
  FileEntryRenameRequest,
  FileExplorerRequest,
  FileUploadRequest,
  FileSubscribeRequest,
  FileUnsubscribeRequest,
  FileWriteRequest,
  SessionInboundMessage,
  SessionOutboundMessage,
} from "../../messages.js";
import { FileUploadStore } from "../../file-upload/index.js";
import {
  attachSessionFiles,
  resolveLinkedSessionFile,
  type ResolveForkSource,
} from "../../file-upload/session-files.js";
import type { DownloadTokenStore } from "../../file-download/token-store.js";
import {
  createExplorerEntry,
  deleteExplorerEntry,
  duplicateExplorerEntry,
  getDownloadableFileInfo,
  listDirectoryEntries,
  readExplorerFile,
  renameExplorerEntry,
  streamExplorerFile,
  writeExplorerFile,
} from "../../file-explorer/service.js";
import { workspaceFileObserver, type FileObserver } from "../../file-explorer/observer.js";
import { getProjectIcon } from "../../../utils/project-icon.js";

/**
 * What a workspace file-access request reaches outside its own domain: the
 * outbound message channel (text + binary). `hasBinaryChannel` gates the
 * binary file-explorer transfer path the same way the terminal subsystem does
 * — old clients without a binary channel fall back to inline JSON file content.
 */
export interface WorkspaceFilesSessionHost {
  emit(msg: SessionOutboundMessage, source?: object): void;
  emitBinary(frame: Uint8Array, source?: object): Promise<void>;
  hasBinaryChannel(): boolean;
}

// A held upload may be the whole file: the app allows 50 MiB, sent in 128 KiB chunks.
const MAX_HELD_UPLOAD_BYTES = 64 * 1024 * 1024;
const MAX_HELD_UPLOAD_FRAMES = 1024;
// Bounds memory across every session while their upload requests are authorized.
const MAX_HELD_UPLOAD_BYTES_TOTAL = 128 * 1024 * 1024;
const UPLOAD_OVERLOADED = "Upload storage overloaded: pending frame/byte limit exceeded";
const UPLOAD_NOT_PERMITTED =
  "You do not have permission to perform this action. Ask your administrator for access.";
let heldUploadBytesTotal = 0;

interface HeldUploadFrames {
  queue: Array<{ frame: FileTransferFrame; bytes: number; allowed: () => boolean }>;
  /** Declared size, capped: more than this cannot be a valid upload. */
  limit: number;
  bytes: number;
  released: boolean;
  draining: boolean;
  failure: string | null;
}

export interface WorkspaceFilesSessionOptions {
  host: WorkspaceFilesSessionHost;
  downloadTokenStore: DownloadTokenStore;
  clisbotHome: string;
  logger: pino.Logger;
  fileObserver?: FileObserver;
  sessionStorageEnabled?: () => boolean;
  resolveAgentDirectory?: (agentId: string) => Promise<string>;
  resolveAgentReadDirectory?: (agentId: string) => Promise<string>;
  resolveForkSource?: ResolveForkSource;
}

/**
 * A client's workspace file-access surface: browsing directories, reading file
 * contents (inline JSON or binary frames), receiving uploads, issuing download
 * tokens, and reading project icons. It owns the upload store and reaches no
 * workspace-git, registry, or subscription state — file I/O scoped to a cwd is
 * the whole concern.
 */
export class WorkspaceFilesSession {
  private readonly host: WorkspaceFilesSessionHost;
  private readonly downloadTokenStore: DownloadTokenStore;
  private readonly logger: pino.Logger;
  private readonly fileUploads: FileUploadStore;
  private readonly fileObserver: FileObserver;
  private readonly heldUploadFrames = new WeakMap<object, Map<string, HeldUploadFrames>>();

  constructor(private readonly options: WorkspaceFilesSessionOptions) {
    this.host = options.host;
    this.downloadTokenStore = options.downloadTokenStore;
    this.logger = options.logger;
    this.fileUploads = new FileUploadStore({
      clisbotHome: options.clisbotHome,
      sessionStorageEnabled: options.sessionStorageEnabled,
      resolveAgentDirectory: options.resolveAgentDirectory,
    });
    this.fileObserver = options.fileObserver ?? workspaceFileObserver;
  }

  async handleFileSubscribeRequest(
    request: FileSubscribeRequest,
    ownership: SessionDelivery,
  ): Promise<void> {
    let bootstrap: ReturnType<FileObserver["subscribe"]> | undefined;
    const owner = ownership.begin(
      "files",
      request.subscriptionId,
      async () => {
        await bootstrap?.then(
          (subscription) => subscription.unsubscribe(),
          () => undefined,
        );
      },
      `file:${request.subscriptionId}`,
    );
    let ready = false;
    let pending: FileVersion | null = null;
    const emitVersion = (version: FileVersion) =>
      owner.emit({
        type: "fs.file.update",
        payload: { subscriptionId: owner.responseId, version },
      });
    try {
      bootstrap = this.fileObserver.subscribe(
        { cwd: request.cwd, path: request.path },
        (version) => {
          if (owner.signal.aborted) return;
          if (ready) emitVersion(version);
          else pending = version;
        },
      );
      const subscription = await bootstrap;
      if (owner.signal.aborted) {
        subscription.unsubscribe();
        return;
      }
      this.host.emit({
        type: "fs.file.subscribe.response",
        payload: {
          subscriptionId: owner.responseId,
          initial: subscription.initial,
          requestId: request.requestId,
        },
      });
      ready = true;
      if (pending) emitVersion(pending);
    } catch (error) {
      await owner.release();
      this.host.emit({
        type: "fs.file.subscribe.response",
        payload: {
          subscriptionId: owner.responseId,
          initial: {
            status: "error",
            cwd: request.cwd,
            path: request.path,
            error: getErrorMessage(error),
          },
          requestId: request.requestId,
        },
      });
    }
  }

  async handleFileUnsubscribeRequest(
    request: FileUnsubscribeRequest,
    ownership: SessionDelivery,
  ): Promise<void> {
    await ownership.release(request.subscriptionId);
    this.host.emit({
      type: "fs.file.unsubscribe.response",
      payload: {
        subscriptionId: request.subscriptionId,
        requestId: request.requestId,
      },
    });
  }

  async handleFileWriteRequest(request: FileWriteRequest): Promise<void> {
    const result = await writeExplorerFile({
      root: request.cwd,
      relativePath: request.path,
      content: request.content,
      contentEncoding: request.contentEncoding,
      expectedModifiedAt: request.expectedModifiedAt,
      expectedRevision: request.expectedRevision,
    });
    this.host.emit({
      type: "fs.file.write.response",
      payload: { result, requestId: request.requestId },
    });
  }

  async handleFileEntryCreateRequest(request: FileEntryCreateRequest): Promise<void> {
    const result = await createExplorerEntry({
      root: request.cwd,
      parentPath: request.parentPath,
      name: request.name,
      kind: request.kind,
    });
    this.host.emit({
      type: "fs.entry.create.response",
      payload: {
        cwd: request.cwd,
        parentPath: request.parentPath,
        path: result.status === "ok" ? result.path : null,
        success: result.status === "ok",
        error: result.status === "ok" ? null : result.error,
        requestId: request.requestId,
      },
    });
  }

  async handleFileEntryRenameRequest(request: FileEntryRenameRequest): Promise<void> {
    const result = await renameExplorerEntry({
      root: request.cwd,
      relativePath: request.path,
      name: request.name,
    });
    this.host.emit({
      type: "fs.entry.rename.response",
      payload: {
        cwd: request.cwd,
        path: request.path,
        renamedPath: result.status === "ok" ? result.path : null,
        success: result.status === "ok",
        error: result.status === "ok" ? null : result.error,
        requestId: request.requestId,
      },
    });
  }

  async handleFileEntryDuplicateRequest(request: FileEntryDuplicateRequest): Promise<void> {
    const result = await duplicateExplorerEntry({
      root: request.cwd,
      relativePath: request.path,
    });
    this.host.emit({
      type: "fs.entry.duplicate.response",
      payload: {
        cwd: request.cwd,
        path: request.path,
        duplicatedPath: result.status === "ok" ? result.path : null,
        success: result.status === "ok",
        error: result.status === "ok" ? null : result.error,
        requestId: request.requestId,
      },
    });
  }

  async handleFileEntryDeleteRequest(request: FileEntryDeleteRequest): Promise<void> {
    const result = await deleteExplorerEntry({
      root: request.cwd,
      relativePath: request.path,
    });
    this.host.emit({
      type: "fs.entry.delete.response",
      payload: {
        cwd: request.cwd,
        path: request.path,
        success: result.status === "ok",
        error: result.status === "ok" ? null : result.error,
        requestId: request.requestId,
      },
    });
  }

  dispose(): void {
    void this.fileUploads
      .dispose()
      .catch((error) =>
        this.logger.error({ err: error }, "Failed to clean up disconnected uploads"),
      );
  }

  async handleFileExplorerRequest(request: FileExplorerRequest, source?: object): Promise<void> {
    const { cwd: workspaceCwd, path: requestedPath = ".", mode, requestId } = request;
    const cwd = workspaceCwd.trim();
    if (!cwd) {
      this.host.emit(
        {
          type: "file_explorer_response",
          payload: {
            cwd: workspaceCwd,
            path: requestedPath,
            mode,
            directory: null,
            file: null,
            error: "cwd is required",
            requestId,
          },
        },
        source,
      );
      return;
    }

    try {
      if (mode === "list") {
        const directory = await listDirectoryEntries({
          root: cwd,
          relativePath: requestedPath,
        });

        this.host.emit(
          {
            type: "file_explorer_response",
            payload: {
              cwd,
              path: directory.path,
              mode,
              directory,
              file: null,
              error: null,
              requestId,
            },
          },
          source,
        );
      } else {
        if (request.maxBytes) {
          const file = await getDownloadableFileInfo({
            root: cwd,
            relativePath: requestedPath,
          });
          if (file.size > request.maxBytes) {
            throw new Error("File is too large to display");
          }
        }
        if (request.acceptBinary && this.host.hasBinaryChannel()) {
          await streamExplorerFile({ root: cwd, relativePath: requestedPath }, async (file) => {
            await this.host.emitBinary(
              encodeFileTransferFrame({
                opcode: FileTransferOpcode.FileBegin,
                requestId,
                metadata: {
                  mime: file.mimeType,
                  size: file.size,
                  encoding: file.encoding,
                  modifiedAt: file.modifiedAt,
                  revision: file.revision,
                },
              }),
              source,
            );
            for await (const chunk of file.chunks) {
              await this.host.emitBinary(
                encodeFileTransferFrame({
                  opcode: FileTransferOpcode.FileChunk,
                  requestId,
                  payload: chunk,
                }),
                source,
              );
            }
            await this.host.emitBinary(
              encodeFileTransferFrame({
                opcode: FileTransferOpcode.FileEnd,
                requestId,
              }),
              source,
            );
          });
        } else {
          const file = await readExplorerFile({
            root: cwd,
            relativePath: requestedPath,
          });

          this.host.emit(
            {
              type: "file_explorer_response",
              payload: {
                cwd,
                path: file.path,
                mode,
                directory: null,
                file,
                error: null,
                requestId,
              },
            },
            source,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        { err: error, cwd, path: requestedPath },
        `Failed to fulfill file explorer request for workspace ${cwd}`,
      );
      this.host.emit(
        {
          type: "file_explorer_response",
          payload: {
            cwd,
            path: requestedPath,
            mode,
            directory: null,
            file: null,
            error: getErrorMessage(error),
            requestId,
          },
        },
        source,
      );
    }
  }

  handleFileUploadRequest(request: FileUploadRequest, ownership: SessionDelivery): void {
    let cancel: (() => Promise<void>) | undefined;
    const operation = ownership.operation(
      (message) =>
        message.type === "file.upload.response" && message.payload.requestId === request.requestId,
      () => cancel?.(),
    );
    cancel = this.fileUploads.beginUpload(request, operation.source, (response) => {
      if (response) operation.emit(response);
      void operation
        .release()
        .catch((error) => this.logger.error({ err: error }, "Upload cleanup failed"));
    });
  }

  queueFileAuthority() {
    return {
      ownsUpload: (file: Extract<AgentAttachment, { type: "uploaded_file" }>) =>
        this.fileUploads.ownsUploadedFile(file),
      resolveForkSource: this.options.resolveForkSource,
    };
  }

  async attachMessageFiles(
    agentId: string,
    messageId: string,
    attachments?: AgentAttachment[],
    images?: { data: string; mimeType: string }[],
  ): Promise<{
    attachments?: AgentAttachment[];
    images?: { data: string; mimeType: string }[];
  }> {
    if (
      !this.options.sessionStorageEnabled?.() ||
      (!images?.length &&
        !attachments?.some(
          (item) =>
            item.type === "uploaded_file" ||
            (item.type === "text" && item.contextKind === "chat_history" && item.sourceSession),
        ))
    )
      return { attachments, images };
    if (!this.options.resolveAgentDirectory) throw new Error("Session file storage is unavailable");
    const directory = await this.options.resolveAgentDirectory(agentId);
    const result = await retrySessionFileAdmission(() =>
      attachSessionFiles({
        directory,
        messageId,
        attachments,
        images,
        ownsUpload: (file) => this.fileUploads.ownsUploadedFile(file),
        resolveForkSource: this.options.resolveForkSource,
      }),
    );
    await this.fileUploads.releaseLinkedUploads(attachments ?? []);
    return result;
  }

  async attachChatMessageFiles(
    directory: string,
    messageId: string,
    files: { attachments?: AgentAttachment[]; images?: { data: string; mimeType: string }[] },
  ) {
    if (
      !files.images?.length &&
      !files.attachments?.some(
        (file) => file.type === "uploaded_file" || (file.type === "text" && file.sourceSession),
      )
    )
      return files;
    const result = await attachSessionFiles({
      directory,
      messageId,
      ...files,
      ownsUpload: (file) => this.fileUploads.ownsUploadedFile(file),
      resolveForkSource: this.options.resolveForkSource,
    });
    return {
      attachments: result.attachments,
      images: result.images,
      release: () => this.fileUploads.releaseLinkedUploads(files.attachments ?? []),
    };
  }

  ownsUploadedFileAttachments(attachments: readonly AgentAttachment[]): boolean {
    return attachments.every(
      (attachment) =>
        attachment.type !== "uploaded_file" || this.fileUploads.ownsUploadedFile(attachment),
    );
  }

  /**
   * A client sends the begin frame right behind its upload request, and the socket hands binary
   * frames over at once while a Project-scoped request is still being authorized. Without this
   * hold the begin frame found no upload and was dropped, so every chunk then failed with
   * "Upload chunks arrived before file begin". Frames wait, in arrival order, until the request
   * has been admitted or refused, then reach the store one at a time. A hold that outgrows its
   * budget, or whose sender loses authority, ends the upload with an error instead of a hang.
   */
  holdUploadFrames(
    request: { requestId: string; size: number },
    source: object | undefined,
  ): () => void {
    if (!source) return () => {};
    const holds = this.heldUploadFrames.get(source) ?? new Map<string, HeldUploadFrames>();
    if (holds.has(request.requestId)) return () => {};
    const hold: HeldUploadFrames = {
      queue: [],
      limit: Math.min(Math.max(request.size, 0), MAX_HELD_UPLOAD_BYTES),
      bytes: 0,
      released: false,
      draining: false,
      failure: null,
    };
    holds.set(request.requestId, hold);
    this.heldUploadFrames.set(source, holds);
    return () => {
      hold.released = true;
      void this.drainHeldUploadFrames(request.requestId, source, hold);
    };
  }

  /** `allowed` is read when the frame is applied, after any hold: authority can change meanwhile. */
  async handleFileTransferFrame(
    frame: FileTransferFrame,
    source: object,
    allowed: () => boolean,
  ): Promise<void> {
    const hold = this.heldUploadFrames.get(source)?.get(frame.requestId);
    if (!hold) {
      if (allowed()) await this.fileUploads.receiveFrame(frame, source);
      return;
    }
    if (hold.failure) return;
    const bytes = frame.opcode === FileTransferOpcode.FileChunk ? frame.payload.byteLength : 0;
    if (
      hold.bytes + bytes > hold.limit ||
      hold.queue.length >= MAX_HELD_UPLOAD_FRAMES ||
      heldUploadBytesTotal + bytes > MAX_HELD_UPLOAD_BYTES_TOTAL
    ) {
      await this.failHeldUpload(frame.requestId, source, hold, UPLOAD_OVERLOADED);
      return;
    }
    hold.bytes += bytes;
    heldUploadBytesTotal += bytes;
    hold.queue.push({ frame, bytes, allowed });
    if (hold.released) await this.drainHeldUploadFrames(frame.requestId, source, hold);
  }

  private async drainHeldUploadFrames(
    requestId: string,
    source: object,
    hold: HeldUploadFrames,
  ): Promise<void> {
    if (hold.draining) return;
    hold.draining = true;
    try {
      if (hold.failure) return await this.failHeldUpload(requestId, source, hold, hold.failure);
      // A refused request registered nothing; its frames are discarded unread.
      if (!this.fileUploads.hasPendingUpload(requestId, source)) {
        this.discardHeldFrames(hold);
        return;
      }
      for (let next = hold.queue.shift(); next; next = hold.queue.shift()) {
        hold.bytes -= next.bytes;
        heldUploadBytesTotal -= next.bytes;
        if (!next.allowed())
          return await this.failHeldUpload(requestId, source, hold, UPLOAD_NOT_PERMITTED);
        await this.fileUploads.receiveFrame(next.frame, source).catch(() => null);
      }
    } finally {
      hold.draining = false;
      // No await separates the empty check from the removal, so a later frame goes straight
      // to the store behind every frame drained here.
      if (hold.queue.length === 0 || hold.failure) this.forgetHold(requestId, source, hold);
    }
  }

  private async failHeldUpload(
    requestId: string,
    source: object,
    hold: HeldUploadFrames,
    failure: string,
  ): Promise<void> {
    hold.failure = failure;
    this.discardHeldFrames(hold);
    // Before admission the request may still be refused; the drain at release reports then.
    if (!hold.released) return;
    this.forgetHold(requestId, source, hold);
    await this.fileUploads.failUpload(requestId, source, failure);
    // Without workspace.write the upload response is no longer delivered; rpc_error always is.
    if (failure === UPLOAD_NOT_PERMITTED)
      this.host.emit(
        {
          type: "rpc_error",
          payload: {
            requestId,
            requestType: "file.upload.request",
            error: failure,
            code: "access_denied",
          },
        },
        source,
      );
  }

  private discardHeldFrames(hold: HeldUploadFrames): void {
    heldUploadBytesTotal -= hold.bytes;
    hold.bytes = 0;
    hold.queue = [];
  }

  private forgetHold(requestId: string, source: object, hold: HeldUploadFrames): void {
    const holds = this.heldUploadFrames.get(source);
    if (holds?.get(requestId) === hold) holds.delete(requestId);
  }

  async handleProjectIconRequest(
    request: Extract<SessionInboundMessage, { type: "project_icon_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = request;

    try {
      const icon = await getProjectIcon(cwd);
      this.host.emit({
        type: "project_icon_response",
        payload: {
          cwd,
          icon,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "project_icon_response",
        payload: {
          cwd,
          icon: null,
          error: getErrorMessage(error),
          requestId,
        },
      });
    }
  }

  async handleFileDownloadTokenRequest(
    request: FileDownloadTokenRequest,
    source?: object,
    supportsSessionFiles = false,
  ): Promise<void> {
    const { cwd: workspaceCwd, path: requestedPath, requestId } = request;
    const cwd = workspaceCwd.trim();
    if (!cwd) {
      this.host.emit(
        {
          type: "file_download_token_response",
          payload: {
            cwd: workspaceCwd,
            path: requestedPath,
            token: null,
            fileName: null,
            mimeType: null,
            size: null,
            error: "cwd is required",
            requestId,
          },
        },
        source,
      );
      return;
    }

    this.logger.debug(
      { cwd, path: requestedPath },
      `Handling file download token request for workspace ${cwd} (${requestedPath})`,
    );

    try {
      let root = cwd;
      let relativePath = requestedPath;
      if (request.agentId) {
        if (!supportsSessionFiles || !this.options.resolveAgentReadDirectory)
          throw new Error("Session file downloads are unavailable");
        root = await this.options.resolveAgentReadDirectory(request.agentId);
        relativePath = (await resolveLinkedSessionFile(root, requestedPath)).relativePath;
      }
      const info = await getDownloadableFileInfo({ root, relativePath });

      const entry = this.downloadTokenStore.issueToken({
        path: info.path,
        absolutePath: info.absolutePath,
        fileName: info.fileName,
        mimeType: info.mimeType,
        size: info.size,
      });

      this.host.emit(
        {
          type: "file_download_token_response",
          payload: {
            cwd,
            path: info.path,
            token: entry.token,
            fileName: entry.fileName,
            mimeType: entry.mimeType,
            size: entry.size,
            error: null,
            requestId,
          },
        },
        source,
      );
    } catch (error) {
      this.logger.error(
        { err: error, cwd, path: requestedPath },
        `Failed to issue download token for workspace ${cwd}`,
      );
      this.host.emit(
        {
          type: "file_download_token_response",
          payload: {
            cwd,
            path: requestedPath,
            token: null,
            fileName: null,
            mimeType: null,
            size: null,
            error: getErrorMessage(error),
            requestId,
          },
        },
        source,
      );
    }
  }
}
