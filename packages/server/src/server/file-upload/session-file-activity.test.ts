import { afterEach, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { attachSessionFiles, deleteSessionDirectory } from "./session-files.js";
import {
  SESSION_FILE_LIMITS,
  sessionFileActivityUsage,
  withSessionFileLease,
  withSessionFileOperation,
  registerSessionUpload,
} from "./session-file-activity.js";

import { FileUploadStore } from "./index.js";
import { FileTransferOpcode } from "@getpaseo/protocol/binary-frames/index";
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function temporary() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "file-activity-"));
  roots.push(root);
  return root;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it("rejects over-budget images before copying or decoding and releases all admission state", async () => {
  const directory = await temporary();
  await expect(
    attachSessionFiles({
      directory,
      messageId: "too-large",
      images: [{ data: "A".repeat(SESSION_FILE_LIMITS.operationBytes), mimeType: "image/png" }],
      ownsUpload: () => false,
    }),
  ).rejects.toThrow("budget");
  expect(sessionFileActivityUsage()).toEqual({
    owners: 0,
    operations: 0,
    uploads: 0,
    retainedBytes: 0,
  });
  expect(await fs.readdir(directory)).toEqual([]);
});
it("bounds queued operations before capture and drains every admitted operation", async () => {
  const directory = await temporary();
  const gate = deferred();
  let ran = 0;
  const operations = Array.from({ length: SESSION_FILE_LIMITS.sessionOperations }, () =>
    withSessionFileOperation(directory, async () => {
      await gate.promise;
      ran += 1;
    }),
  );
  let captured = false;
  await expect(
    withSessionFileOperation(
      directory,
      async () => {},
      4096,
      () => {
        captured = true;
      },
    ),
  ).rejects.toThrow("budget");
  expect(captured).toBe(false);
  gate.resolve();
  await Promise.all(operations);
  expect(ran).toBe(SESSION_FILE_LIMITS.sessionOperations);
  expect(sessionFileActivityUsage().owners).toBe(0);
});
it("source deletion waits for an admitted read lease and its durable fence survives owner eviction", async () => {
  const parent = await temporary();
  const directory = path.join(parent, "source");
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, "file"), "retained");
  const gate = deferred();
  const entered = deferred();
  const reader = withSessionFileLease(directory, async () => {
    entered.resolve();
    await gate.promise;
    return fs.readFile(path.join(directory, "file"), "utf8");
  });
  await entered.promise;
  const deleting = deleteSessionDirectory(directory);
  await expect(withSessionFileLease(directory, async () => {})).rejects.toThrow("deleted");
  gate.resolve();
  expect(await reader).toBe("retained");
  await deleting;
  expect(sessionFileActivityUsage().owners).toBe(0);
  await expect(
    withSessionFileOperation(directory, async () => {
      await fs.mkdir(directory);
    }),
  ).rejects.toThrow("deleted");
  expect(sessionFileActivityUsage().owners).toBe(0);
  await expect(fs.stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
});
it("captures queued attachment bytes before caller mutation", async () => {
  const directory = await temporary();
  const gate = deferred();
  const blocking = withSessionFileOperation(directory, () => gate.promise);
  const images = [{ data: Buffer.from("original").toString("base64"), mimeType: "image/png" }];
  const attached = attachSessionFiles({
    directory,
    messageId: "snapshot",
    images,
    ownsUpload: () => false,
  });
  images[0].data = Buffer.from("changed").toString("base64");
  gate.resolve();
  await blocking;
  const result = await attached;
  expect(await fs.readFile(path.join(directory, result.links.files[0].relativePath), "utf8")).toBe(
    "original",
  );
});

it.each([false, true])(
  "does not strand an idle deleting owner when cancellation fails (synchronous=%s)",
  async (synchronous) => {
    const directory = await temporary();
    let release!: () => void;
    release = await registerSessionUpload(directory, () => {
      release();
      const error = new Error("injected cancellation failure");
      if (synchronous) throw error;
      return Promise.reject(error);
    });
    await expect(deleteSessionDirectory(directory)).rejects.toThrow(
      "injected cancellation failure",
    );
    expect(sessionFileActivityUsage()).toEqual({
      owners: 0,
      operations: 0,
      uploads: 0,
      retainedBytes: 0,
    });
    // The failed attempt is retryable and does not permanently reject new work.
    await expect(
      withSessionFileOperation(directory, async () => undefined),
    ).resolves.toBeUndefined();
  },
);

it("releases registration when deletion cancels a transfer during asynchronous admission", async () => {
  const parent = await temporary();
  const directory = path.join(parent, "agent");
  const store = new FileUploadStore({
    paseoHome: parent,
    sessionStorageEnabled: () => true,
    resolveAgentDirectory: async () => directory,
  });
  const entered = deferred();
  const gate = deferred();
  const originalAccess = fs.access.bind(fs);
  vi.spyOn(fs, "access").mockImplementation(async (...args) => {
    if (String(args[0]).includes(".deleted-")) {
      entered.resolve();
      await gate.promise;
    }
    return originalAccess(...args);
  });
  store.beginUpload({
    type: "file.upload.request",
    requestId: "race",
    agentId: "agent",
    fileName: "file.txt",
    mimeType: "text/plain",
    size: 1,
    modifiedAt: new Date().toISOString(),
  });
  const writing = store.receiveFrame({
    opcode: FileTransferOpcode.FileBegin,
    requestId: "race",
    metadata: {
      mime: "text/plain",
      size: 1,
      encoding: "binary",
      modifiedAt: new Date().toISOString(),
      fileName: "file.txt",
    },
  });
  await entered.promise;
  const deletion = deleteSessionDirectory(directory);
  gate.resolve();
  await Promise.all([writing, deletion]);
  expect(sessionFileActivityUsage()).toEqual({
    owners: 0,
    operations: 0,
    uploads: 0,
    retainedBytes: 0,
  });
  await expect(fs.stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
});
