import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileTransferOpcode } from "@getpaseo/protocol/binary-frames/index";
import { FileUploadStore } from "./index.js";
import { attachSessionFiles, deleteSessionDirectory, pruneSessionDrafts } from "./session-files.js";

const roots: string[] = [];
async function root(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "session-files-"));
  roots.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function upload(store: FileUploadStore, requestId: string, agentId?: string) {
  store.beginUpload({
    type: "file.upload.request",
    requestId,
    agentId,
    fileName: "note.txt",
    mimeType: "text/plain",
    size: 5,
    modifiedAt: new Date().toISOString(),
  });
  await store.receiveFrame({
    opcode: FileTransferOpcode.FileBegin,
    requestId,
    metadata: {
      mime: "text/plain",
      size: 5,
      encoding: "binary",
      modifiedAt: new Date().toISOString(),
      fileName: "note.txt",
    },
  });
  await store.receiveFrame({
    opcode: FileTransferOpcode.FileChunk,
    requestId,
    payload: Buffer.from("hello"),
  });
  const response = await store.receiveFrame({
    opcode: FileTransferOpcode.FileEnd,
    requestId,
  });
  if (!response?.payload.file) throw new Error(response?.payload.error ?? "Missing upload");
  return response.payload.file;
}

describe("session-owned files", () => {
  it("binds temporary uploads and images durably; retry reuses accepted files and rejects conflicts", async () => {
    const directory = path.join(await root(), ".paseo");
    await fs.mkdir(directory);
    const session = path.join(directory, "agents", "a");
    const store = new FileUploadStore({
      paseoHome: directory,
      sessionStorageEnabled: () => true,
    });
    const file = await upload(store, "draft");
    const images = [
      {
        data: Buffer.from("image bytes").toString("base64"),
        mimeType: "image/png",
      },
    ];
    const result = await attachSessionFiles({
      directory: session,
      messageId: "m1",
      attachments: [file],
      images,
      ownsUpload: (candidateFile) => store.ownsUploadedFile(candidateFile),
    });
    expect(result.links.files).toHaveLength(2);
    expect(
      result.links.files.every((linkedFile) => !path.isAbsolute(linkedFile.relativePath)),
    ).toBe(true);
    expect(await fs.readFile(path.join(session, result.links.files[0].relativePath), "utf8")).toBe(
      "hello",
    );
    await store.releaseLinkedUploads([file]);
    expect(
      await attachSessionFiles({
        directory: session,
        messageId: "m1",
        attachments: [file],
        images,
        ownsUpload: () => false,
      }),
    ).toEqual(result);
    await expect(
      attachSessionFiles({
        directory: session,
        messageId: "m1",
        attachments: [{ ...file, size: 6 }],
        images,
        ownsUpload: () => false,
      }),
    ).rejects.toThrow("conflicts");
    const target = path.join(directory, "agents", "b");
    const copied = (
      await attachSessionFiles({
        directory: target,
        messageId: "fork-m1",
        ownsUpload: () => false,
        attachments: [
          {
            type: "text",
            mimeType: "text/plain",
            contextKind: "chat_history",
            text: path.join(session, result.links.files[0].relativePath),
            sourceSession: { agentId: "a", epoch: "observed", seq: 1 },
          },
        ],
        resolveForkSource: async () => ({
          directory: session,
          messageIds: (async function* () {
            yield "m1";
          })(),
        }),
      })
    ).links;
    expect(await fs.readFile(path.join(target, copied.files[1].relativePath), "utf8")).toBe(
      "image bytes",
    );
    await deleteSessionDirectory(session);
    expect(await fs.readFile(path.join(target, copied.files[0].relativePath), "utf8")).toBe(
      "hello",
    );
  });
  it("uploads directly into a known session; retains linked files when pruning drafts", async () => {
    const directory = await root();
    const session = path.join(directory, "agents", "a");
    const store = new FileUploadStore({
      paseoHome: directory,
      sessionStorageEnabled: () => true,
      resolveAgentDirectory: async () => session,
    });
    const file = await upload(store, "direct", "a");
    expect(file.path.startsWith(path.join(session, "uploads"))).toBe(true);
    await attachSessionFiles({
      directory: session,
      messageId: "m",
      attachments: [file],
      ownsUpload: (candidateFile) => store.ownsUploadedFile(candidateFile),
    });
    const draft = await upload(store, "unused", "a");
    expect(await pruneSessionDrafts(session, Date.now() + 48 * 60 * 60 * 1000)).toBe(1);
    expect(await fs.readFile(file.path, "utf8")).toBe("hello");
    await expect(fs.stat(draft.path)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("does not accept a forged path or metadata and rejects zero-byte FileEnd without Begin", async () => {
    const directory = await root();
    const store = new FileUploadStore({
      paseoHome: directory,
      sessionStorageEnabled: () => true,
    });
    const file = await upload(store, "owned");
    await expect(
      attachSessionFiles({
        directory: path.join(directory, "session"),
        messageId: "m",
        attachments: [{ ...file, path: "/etc/passwd" }],
        ownsUpload: (candidateFile) => store.ownsUploadedFile(candidateFile),
      }),
    ).rejects.toThrow("does not belong");
    store.beginUpload({
      type: "file.upload.request",
      requestId: "zero",
      fileName: "zero",
      mimeType: "text/plain",
      size: 0,
      modifiedAt: new Date().toISOString(),
    });
    expect(
      (
        await store.receiveFrame({
          opcode: FileTransferOpcode.FileEnd,
          requestId: "zero",
        })
      )?.payload.error,
    ).toContain("before file begin");
  });
  it("rejects an independent multi-principal upload retry instead of overwriting the accepted owner", async () => {
    const directory = await root();
    const session = path.join(directory, "agents", "a");
    // Two independent connections = two principals; each owns its own upload store.
    const principalA = new FileUploadStore({
      paseoHome: directory,
      sessionStorageEnabled: () => true,
      resolveAgentDirectory: async () => session,
    });
    const principalB = new FileUploadStore({
      paseoHome: directory,
      sessionStorageEnabled: () => true,
      resolveAgentDirectory: async () => session,
    });
    const fileA = await upload(principalA, "a-upload", "a");
    const linked = await attachSessionFiles({
      directory: session,
      messageId: "m1",
      attachments: [fileA],
      ownsUpload: (candidateFile) => principalA.ownsUploadedFile(candidateFile),
    });
    // Principal B uploads its own file and retries the same logical message m1: the
    // accepted file set differs, so the retry must conflict, not overwrite A's owner.
    const fileB = await upload(principalB, "b-upload", "a");
    await expect(
      attachSessionFiles({
        directory: session,
        messageId: "m1",
        attachments: [fileB],
        ownsUpload: (candidateFile) => principalB.ownsUploadedFile(candidateFile),
      }),
    ).rejects.toThrow("conflicts");
    // Principal B referencing A's upload it does not own is rejected at the connection
    // boundary; it cannot attach another principal's file into the session.
    await expect(
      attachSessionFiles({
        directory: session,
        messageId: "m2",
        attachments: [fileA],
        ownsUpload: (candidateFile) => principalB.ownsUploadedFile(candidateFile),
      }),
    ).rejects.toThrow("does not belong");
    // The original owner and its accepted link are untouched.
    expect(await fs.readFile(path.join(session, linked.links.files[0].relativePath), "utf8")).toBe(
      "hello",
    );
  });
  it("delete cancels admitted uploads and rejects late frames without recreating files", async () => {
    const directory = await root();
    const session = path.join(directory, "agents", "a");
    const store = new FileUploadStore({
      paseoHome: directory,
      sessionStorageEnabled: () => true,
      resolveAgentDirectory: async () => session,
    });
    store.beginUpload({
      type: "file.upload.request",
      requestId: "slow",
      agentId: "a",
      fileName: "slow",
      mimeType: "text/plain",
      size: 5,
      modifiedAt: new Date().toISOString(),
    });
    await store.receiveFrame({
      opcode: FileTransferOpcode.FileBegin,
      requestId: "slow",
      metadata: {
        mime: "text/plain",
        size: 5,
        encoding: "binary",
        modifiedAt: new Date().toISOString(),
        fileName: "slow",
      },
    });
    const write = store.receiveFrame({
      opcode: FileTransferOpcode.FileChunk,
      requestId: "slow",
      payload: Buffer.from("hello"),
    });
    await Promise.all([write, deleteSessionDirectory(session)]);
    expect(
      await store.receiveFrame({
        opcode: FileTransferOpcode.FileEnd,
        requestId: "slow",
      }),
    ).toBeNull();
    await expect(fs.stat(session)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

it("forks only files from the authorized anchored messages and reuses the target copy after source deletion", async () => {
  const directory = await root();
  const source = path.join(directory, "source");
  const target = path.join(directory, "target");
  const store = new FileUploadStore({ paseoHome: directory, sessionStorageEnabled: () => true });
  const uploaded = await upload(store, "source-file");
  const linked = await attachSessionFiles({
    directory: source,
    messageId: "original",
    attachments: [uploaded],
    ownsUpload: (candidateFile) => store.ownsUploadedFile(candidateFile),
  });
  const sourcePath = path.join(source, linked.links.files[0].relativePath);
  const history = {
    type: "text" as const,
    mimeType: "text/plain" as const,
    contextKind: "chat_history",
    text: `Known file: ${sourcePath}; unrelated /etc/passwd`,
    sourceSession: { agentId: "source", epoch: "source-epoch", seq: 5 },
  };
  const result = await attachSessionFiles({
    directory: target,
    messageId: "fork",
    attachments: [history],
    ownsUpload: () => false,
    resolveForkSource: async (anchor) => {
      expect(anchor).toEqual(history.sourceSession);
      return {
        directory: source,
        messageIds: (async function* () {
          yield "no-files";
          yield "original";
        })(),
      };
    },
  });
  expect(result.links.files).toHaveLength(1);
  const targetPath = path.join(target, result.links.files[0].relativePath);
  expect(result.attachments?.[0]).toMatchObject({
    text: `Known file: ${targetPath}; unrelated /etc/passwd`,
  });
  expect(await fs.readFile(sourcePath, "utf8")).toBe("hello");
  await deleteSessionDirectory(source);
  expect(
    await attachSessionFiles({
      directory: target,
      messageId: "fork",
      attachments: [history],
      ownsUpload: () => false,
      resolveForkSource: async () => {
        throw new Error("Source must not be consulted for accepted retry");
      },
    }),
  ).toEqual(result);
  expect(await fs.readFile(targetPath, "utf8")).toBe("hello");
});

it("rejects a fork when its authorized linked file is missing instead of forwarding a broken path", async () => {
  const directory = await root();
  const source = path.join(directory, "source");
  const store = new FileUploadStore({ paseoHome: directory, sessionStorageEnabled: () => true });
  const file = await upload(store, "missing-source");
  const linked = await attachSessionFiles({
    directory: source,
    messageId: "original",
    attachments: [file],
    ownsUpload: (candidateFile) => store.ownsUploadedFile(candidateFile),
  });
  await fs.unlink(path.join(source, linked.links.files[0].relativePath));
  await expect(
    attachSessionFiles({
      directory: path.join(directory, "target"),
      messageId: "fork",
      attachments: [
        {
          type: "text",
          mimeType: "text/plain",
          contextKind: "chat_history",
          text: "history",
          sourceSession: { agentId: "source", epoch: "e", seq: 3 },
        },
      ],
      ownsUpload: () => false,
      resolveForkSource: async () => ({
        directory: source,
        messageIds: (async function* () {
          yield "original";
        })(),
      }),
    }),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
