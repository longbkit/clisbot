import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { randomBytes } from "node:crypto";
import { afterEach, expect, test } from "vitest";
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

const MiB = 1024 * 1024;
const CHUNK = 128 * 1024;
const PERMISSION_DENIED =
  "You do not have permission to perform this action. Ask your administrator for access.";
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

// A Project-scoped (Hub Member) session, the way the Hub admits a Member's app.
async function scopedSession(options: { granted?: boolean } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "managed-upload-order-"));
  const repo = path.join(root, "repo");
  await mkdir(repo);
  const daemon = await createTestClisbotDaemon();
  cleanups.push(async () => {
    await daemon.close();
    await rm(root, { recursive: true, force: true });
  });
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
  const grant = {
    privileges: new Set(["project.use", "agent.interact"] as const),
    agentConfigurations: [],
  };
  const messages: SessionOutboundMessage[] = [];
  const session = new Session({
    clientId: "managed-upload-client",
    permissions: ["daemon.read", "workspace.read", "workspace.write"],
    resourceAuthorization: {
      resourceMode: "projects",
      leaseId: "managed-lease",
      leaseExpiresAt: Date.now() + 60_000,
      projects: new Map(options.granted === false ? [] : [[project.projectId, grant]]),
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
    providerSnapshotManager: createProviderSnapshotManagerStub().manager,
    stt: null,
    tts: null,
  });
  const connect = () => {
    const source = {};
    session.updateClientCapabilities({}, source);
    return source;
  };
  return { session, messages, connect, clisbotHome: daemon.clisbotHome };
}

type Scoped = Awaited<ReturnType<typeof scopedSession>>;

function request(scoped: Scoped, source: object, requestId: string, size: number) {
  return scoped.session.handleMessage(
    {
      type: "file.upload.request",
      requestId,
      fileName: "clip.mp4",
      mimeType: "video/mp4",
      size,
      modifiedAt: "2026-11-04T00:00:00.000Z",
    },
    source,
  );
}

/** The client's frames for `bytes`: begin, 128 KiB chunks, end. */
function uploadFrames(requestId: string, bytes: Uint8Array): FileTransferFrame[] {
  const frames = [
    frame({
      opcode: FileTransferOpcode.FileBegin,
      requestId,
      metadata: {
        mime: "video/mp4",
        size: bytes.byteLength,
        encoding: "binary",
        modifiedAt: "2026-11-04T00:00:00.000Z",
        fileName: "clip.mp4",
      },
    }),
  ];
  for (let offset = 0; offset < bytes.byteLength; offset += CHUNK)
    frames.push(
      frame({
        opcode: FileTransferOpcode.FileChunk,
        requestId,
        payload: bytes.subarray(offset, offset + CHUNK),
      }),
    );
  frames.push(frame({ opcode: FileTransferOpcode.FileEnd, requestId }));
  return frames;
}

/** Delivered the way the websocket server does: neither awaited nor ordered against JSON. */
function deliver(scoped: Scoped, source: object, frames: FileTransferFrame[]) {
  return frames.map((next) =>
    scoped.session.handleBinaryFrame({ kind: "file_transfer", frame: next }, source),
  );
}

async function outcome(scoped: Scoped, requestId: string) {
  await expect.poll(() => findOutcome(scoped, requestId), { timeout: 20_000 }).toBeTruthy();
  return findOutcome(scoped, requestId)!;
}

function findOutcome(scoped: Scoped, requestId: string) {
  for (const message of scoped.messages) {
    if (message.type === "file.upload.response" && message.payload.requestId === requestId)
      return { error: message.payload.error, path: message.payload.file?.path ?? null };
    if (message.type === "rpc_error" && message.payload.requestId === requestId)
      return { error: message.payload.error, path: null };
  }
  return undefined;
}

async function uploadedFiles(clisbotHome: string): Promise<string[]> {
  return await readdir(path.join(clisbotHome, "uploads")).catch(() => []);
}

for (const order of ["after the request settles", "before the request is authorized"] as const)
  test(`a Project-scoped session stores a small file whose frames arrive ${order}`, async () => {
    const scoped = await scopedSession();
    const source = scoped.connect();
    const bytes = new TextEncoder().encode('{"tokens":true}');
    const pending = request(scoped, source, "small", bytes.byteLength);
    if (order === "after the request settles") await pending;
    await Promise.all([pending, ...deliver(scoped, source, uploadFrames("small", bytes))]);
    const result = await outcome(scoped, "small");
    expect(result.error).toBeNull();
    expect(await readFile(result.path!, "utf8")).toBe('{"tokens":true}');
  });

test("a 49 MiB file whose every frame arrives before authorization is stored whole", async () => {
  const scoped = await scopedSession();
  const source = scoped.connect();
  const bytes = randomBytes(49 * MiB);
  const pending = request(scoped, source, "whole", bytes.byteLength);
  const frames = uploadFrames("whole", bytes);
  expect(frames.length).toBeGreaterThan(64);
  await Promise.all([pending, ...deliver(scoped, source, frames)]);
  const result = await outcome(scoped, "whole");
  expect(result.error).toBeNull();
  expect((await readFile(result.path!)).equals(bytes)).toBe(true);
}, 60_000);

test("a 12 MiB file split across authorization keeps its frame order", async () => {
  const scoped = await scopedSession();
  const source = scoped.connect();
  const bytes = randomBytes(12 * MiB);
  const frames = uploadFrames("split", bytes);
  const pending = request(scoped, source, "split", bytes.byteLength);
  const early = deliver(scoped, source, frames.slice(0, 80));
  await pending;
  // The rest lands while the held frames are still being written.
  await Promise.all([...early, ...deliver(scoped, source, frames.slice(80))]);
  const result = await outcome(scoped, "split");
  expect(result.error).toBeNull();
  expect((await readFile(result.path!)).equals(bytes)).toBe(true);
}, 60_000);

test("held bytes beyond the declared size end the upload with an error, not a hang", async () => {
  const scoped = await scopedSession();
  const source = scoped.connect();
  const pending = request(scoped, source, "oversize", 10);
  await Promise.all([
    pending,
    ...deliver(scoped, source, uploadFrames("oversize", randomBytes(MiB))),
  ]);
  expect((await outcome(scoped, "oversize")).error).toMatch(/overloaded/);
  expect(await uploadedFiles(scoped.clisbotHome)).toEqual([]);
});

test("a refused upload request discards its held frames and writes nothing", async () => {
  const scoped = await scopedSession({ granted: false });
  const source = scoped.connect();
  const bytes = randomBytes(MiB);
  const pending = request(scoped, source, "refused", bytes.byteLength);
  await Promise.all([pending, ...deliver(scoped, source, uploadFrames("refused", bytes))]);
  // The request is answered by the ordinary refusal; its frames reach nothing.
  expect((await outcome(scoped, "refused")).error).toBeTruthy();
  expect(await uploadedFiles(scoped.clisbotHome)).toEqual([]);
});

test("losing workspace.write while frames are held ends the upload and stores nothing", async () => {
  const scoped = await scopedSession();
  const source = scoped.connect();
  const bytes = randomBytes(MiB);
  const pending = request(scoped, source, "revoked", bytes.byteLength);
  const frames = deliver(scoped, source, uploadFrames("revoked", bytes));
  scoped.session.setPermissions(["daemon.read", "workspace.read"]);
  await Promise.all([pending, ...frames]);
  expect((await outcome(scoped, "revoked")).error).toBe(PERMISSION_DENIED);
  expect(await uploadedFiles(scoped.clisbotHome)).toEqual([]);
});

test("frames from another connection with the same request id do not join a held upload", async () => {
  const scoped = await scopedSession();
  const source = scoped.connect();
  const other = scoped.connect();
  const bytes = randomBytes(2 * MiB);
  const pending = request(scoped, source, "shared-id", bytes.byteLength);
  const intruder = deliver(scoped, other, uploadFrames("shared-id", randomBytes(2 * MiB)));
  await Promise.all([
    pending,
    ...intruder,
    ...deliver(scoped, source, uploadFrames("shared-id", bytes)),
  ]);
  const result = await outcome(scoped, "shared-id");
  expect(result.error).toBeNull();
  expect((await readFile(result.path!)).equals(bytes)).toBe(true);
});
