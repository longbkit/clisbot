import type pino from "pino";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import {
  encodeFileTransferFrame,
  FileTransferOpcode,
  type FileTransferFrame,
} from "@getpaseo/protocol/binary-frames/index";
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

export interface WorkspaceFilesSessionOptions {
  host: WorkspaceFilesSessionHost;
  downloadTokenStore: DownloadTokenStore;
  paseoHome: string;
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
  private readonly fileSubscriptions = new Map<string, () => void>();

  constructor(private readonly options: WorkspaceFilesSessionOptions) {
    this.host = options.host;
    this.downloadTokenStore = options.downloadTokenStore;
    this.logger = options.logger;
    this.fileUploads = new FileUploadStore({
      paseoHome: options.paseoHome,
      sessionStorageEnabled: options.sessionStorageEnabled,
      resolveAgentDirectory: options.resolveAgentDirectory,
    });
    this.fileObserver = options.fileObserver ?? workspaceFileObserver;
  }

  async handleFileSubscribeRequest(request: FileSubscribeRequest): Promise<void> {
    this.fileSubscriptions.get(request.subscriptionId)?.();
    try {
      const subscription = await this.fileObserver.subscribe(
        { cwd: request.cwd, path: request.path },
        (version) => {
          this.host.emit({
            type: "fs.file.update",
            payload: { subscriptionId: request.subscriptionId, version },
          });
        },
      );
      this.fileSubscriptions.set(request.subscriptionId, subscription.unsubscribe);
      this.host.emit({
        type: "fs.file.subscribe.response",
        payload: {
          subscriptionId: request.subscriptionId,
          initial: subscription.initial,
          requestId: request.requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "fs.file.subscribe.response",
        payload: {
          subscriptionId: request.subscriptionId,
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

  handleFileUnsubscribeRequest(request: FileUnsubscribeRequest): void {
    this.fileSubscriptions.get(request.subscriptionId)?.();
    this.fileSubscriptions.delete(request.subscriptionId);
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
    for (const unsubscribe of this.fileSubscriptions.values()) unsubscribe();
    this.fileSubscriptions.clear();
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

  handleFileUploadRequest(request: FileUploadRequest): void {
    this.fileUploads.beginUpload(request);
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
    const result = await attachSessionFiles({
      directory: await this.options.resolveAgentDirectory(agentId),
      messageId,
      attachments,
      images,
      ownsUpload: (file) => this.fileUploads.ownsUploadedFile(file),
      resolveForkSource: this.options.resolveForkSource,
    });
    await this.fileUploads.releaseLinkedUploads(attachments ?? []);
    return result;
  }

  ownsUploadedFileAttachments(attachments: readonly AgentAttachment[]): boolean {
    return attachments.every(
      (attachment) =>
        attachment.type !== "uploaded_file" || this.fileUploads.ownsUploadedFile(attachment),
    );
  }

  async handleFileTransferFrame(frame: FileTransferFrame): Promise<void> {
    const response = await this.fileUploads.receiveFrame(frame);
    if (response) {
      this.host.emit(response);
    }
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
