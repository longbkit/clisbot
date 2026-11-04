import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { expect, test } from "vitest";
import {
  decodeFileTransferFrame,
  encodeFileTransferFrame,
  FileTransferOpcode,
  type FileTransferFrame,
} from "@clisbot/protocol/binary-frames/index";
import { CreationService } from "../creation/index.js";
import { MessageReceipts } from "../message-receipts/index.js";
import { Session, type SessionOptions } from "../session.js";
import type { SessionOutboundMessage } from "../messages.js";
import { FileBackedProjectRegistry, FileBackedWorkspaceRegistry } from "../workspace-registry.js";
import { WorkspaceGitServiceImpl } from "../workspace-git-service.js";
import { createTestClisbotDaemon } from "../test-utils/clisbot-daemon.js";
import { createStub } from "../test-utils/class-mocks.js";
import { createProviderSnapshotManagerStub } from "../test-utils/session-stubs.js";

function frame(input: Parameters<typeof encodeFileTransferFrame>[0]): FileTransferFrame {
  const decoded = decodeFileTransferFrame(encodeFileTransferFrame(input));
  if (!decoded) throw new Error("Invalid file transfer frame");
  return decoded;
}

// A Project-scoped (Hub Member) session authorizes the JSON request asynchronously, while
// the socket hands the binary frames that follow it to the session at once.
for (const order of ["after the request settles", "before the request is authorized"] as const)
  test(`a Project-scoped session stores file frames sent ${order}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "managed-upload-order-"));
    const repo = path.join(root, "repo");
    await mkdir(repo);
    const daemon = await createTestClisbotDaemon();
    const logger = pino({ level: "silent" });
    const projects = new FileBackedProjectRegistry(path.join(root, "projects.json"), logger);
    const workspaces = new FileBackedWorkspaceRegistry(path.join(root, "workspaces.json"), logger);
    await Promise.all([projects.initialize(), workspaces.initialize()]);
    const project = await projects.getOrCreateActiveByRoot({
      rootPath: repo,
      kind: "non_git",
      displayName: "Repo",
      timestamp: new Date().toISOString(),
    });
    const messages: SessionOutboundMessage[] = [];
    const snapshot = createProviderSnapshotManagerStub();
    const session = new Session({
      clientId: "managed-upload-client",
      permissions: ["daemon.read", "workspace.read", "workspace.write"],
      resourceAuthorization: {
        resourceMode: "projects",
        leaseId: "managed-lease",
        leaseExpiresAt: Date.now() + 60_000,
        projects: new Map([
          [
            project.projectId,
            {
              privileges: new Set(["project.use", "agent.interact"] as const),
              agentConfigurations: [],
            },
          ],
        ]),
      },
      logger,
      clisbotHome: daemon.clisbotHome,
      creationService: new CreationService(path.join(root, "creation-receipts"), logger),
      messageReceipts: new MessageReceipts(path.join(root, "message-receipts")),
      onMessage: (message) => messages.push(message),
      downloadTokenStore: createStub<SessionOptions["downloadTokenStore"]>({}),
      pushNotifications: createStub<SessionOptions["pushNotifications"]>({}),
      agentManager: daemon.daemon.agentManager,
      agentStorage: daemon.daemon.agentStorage,
      projectRegistry: projects,
      workspaceRegistry: workspaces,
      workspaceGitService: new WorkspaceGitServiceImpl({ logger, clisbotHome: daemon.clisbotHome }),
      terminalManager: null,
      scheduleService: createStub<SessionOptions["scheduleService"]>({}),
      checkoutDiffManager: createStub<SessionOptions["checkoutDiffManager"]>({
        scheduleRefreshForCwd: () => {},
        onWorkspaceStateMayHaveChanged: () => {},
      }),
      workspaceAutoName: createStub<SessionOptions["workspaceAutoName"]>({
        scheduleForWorktree: () => {},
        scheduleForDirectory: () => {},
      }),
      daemonConfigStore: createStub<SessionOptions["daemonConfigStore"]>({
        get: () => ({ mcp: { injectIntoAgents: false }, providers: {} }),
        onChange: () => () => {},
      }),
      providerSnapshotManager: snapshot.manager,
      stt: null,
      tts: null,
    });
    const source = {};
    session.updateClientCapabilities({}, source);
    const bytes = new TextEncoder().encode('{"tokens":true}');
    try {
      // The websocket server neither awaits nor orders these against each other.
      const request = session.handleMessage(
        {
          type: "file.upload.request",
          requestId: "upload-1",
          fileName: "Light.tokens.json",
          mimeType: "application/json",
          size: bytes.byteLength,
          modifiedAt: "2026-11-04T00:00:00.000Z",
        },
        source,
      );
      if (order === "after the request settles") await request;
      const frames = [
        session.handleBinaryFrame(
          {
            kind: "file_transfer",
            frame: frame({
              opcode: FileTransferOpcode.FileBegin,
              requestId: "upload-1",
              metadata: {
                mime: "application/json",
                size: bytes.byteLength,
                encoding: "binary",
                modifiedAt: "2026-11-04T00:00:00.000Z",
                fileName: "Light.tokens.json",
              },
            }),
          },
          source,
        ),
        session.handleBinaryFrame(
          {
            kind: "file_transfer",
            frame: frame({
              opcode: FileTransferOpcode.FileChunk,
              requestId: "upload-1",
              payload: bytes,
            }),
          },
          source,
        ),
        session.handleBinaryFrame(
          {
            kind: "file_transfer",
            frame: frame({ opcode: FileTransferOpcode.FileEnd, requestId: "upload-1" }),
          },
          source,
        ),
      ];
      await Promise.all([request, ...frames]);
      await expect
        .poll(() => messages.find((message) => message.type === "file.upload.response"), {
          timeout: 5_000,
        })
        .toBeTruthy();
      const response = messages.find((message) => message.type === "file.upload.response");
      if (response?.type !== "file.upload.response") throw new Error(JSON.stringify(messages));
      expect(response.payload.error).toBeNull();
      expect(await readFile(response.payload.file!.path, "utf8")).toBe('{"tokens":true}');
    } finally {
      await daemon.close();
      await rm(root, { recursive: true, force: true });
    }
  });
