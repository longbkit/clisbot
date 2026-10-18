import pino from "pino";
import { InputQueueRuntime } from "./runtime.js";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { prepareQueueFiles, hydrateQueueContent, attachQueueFiles } from "./files.js";
import { attachSessionFiles, pruneSessionDrafts } from "../file-upload/session-files.js";
import { writeJsonFileAtomic } from "../atomic-file.js";

/** Real isolated filesystem: queue pins draft bytes; existing message links take ownership. */
test("queue image/file bytes survive TTL, transfer to messages, and release only unreferenced drafts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "queue-files-"));
  try {
    const directory = path.join(root, "target");
    await mkdir(directory);
    const source = path.join(root, "source.txt");
    await writeFile(source, "actual durable bytes");
    const uploaded = {
      type: "uploaded_file" as const,
      id: "upload-source",
      fileName: "source.txt",
      mimeType: "text/plain",
      size: 20,
      path: source,
    };
    const content = await prepareQueueFiles({
      directory,
      text: "",
      files: {
        attachments: [
          uploaded,
          {
            type: "text",
            mimeType: "text/plain",
            title: "Context",
            text: "Keep this metadata",
            sourceSession: undefined,
          },
        ],
        images: [{ data: Buffer.from("image").toString("base64"), mimeType: "image/png" }],
      },
      ownsUpload: (file) => file.id === uploaded.id,
      identity: {},
      fingerprint: "fixture",
    });
    await writeJsonFileAtomic(path.join(directory, "queue.json"), {
      version: 1,
      revision: 1,
      items: [
        {
          id: "logical",
          createdAt: new Date().toISOString(),
          senderId: "owner",
          state: "queued",
          payload: content,
        },
      ],
    });
    await rm(source);
    const future = Date.now() + 48 * 60 * 60 * 1000;
    expect(await pruneSessionDrafts(directory, future)).toBe(0);
    expect((await hydrateQueueContent(directory, content)).attachments![1]).toMatchObject({
      type: "text",
      title: "Context",
      text: "Keep this metadata",
    });
    const imagePath = path.join(directory, content.images[0].relativePath);
    expect(await readFile(imagePath, "utf8")).toBe("image");
    const original = await hydrateQueueContent(directory, content);
    const deliberate = await prepareQueueFiles({
      directory,
      text: "Explicit new item while original remains unknown",
      files: { attachments: original.attachments },
      retainedFiles: content.files,
      ownsUpload: () => false,
      identity: {},
      fingerprint: "new-before-handoff",
    });
    expect(deliberate.attachments![0]).toMatchObject({ id: "upload-source" });
    const prepared = await hydrateQueueContent(directory, content);
    const handed = await attachSessionFiles({
      directory,
      messageId: "logical",
      ...prepared,
      ownsUpload: () => true,
    });
    await writeJsonFileAtomic(path.join(directory, "queue.json"), {
      version: 1,
      revision: 3,
      items: [],
    });
    expect(await pruneSessionDrafts(directory, future)).toBe(1); // Superseded queue-only image; message has its own image link.
    for (const file of handed.links.files) await access(path.join(directory, file.relativePath));
    const retained = await prepareQueueFiles({
      directory,
      text: "new deliberate input",
      files: { attachments: prepared.attachments },
      ownsUpload: () => false,
      identity: {},
      fingerprint: "new",
    });
    expect((await hydrateQueueContent(directory, retained)).attachments![0]).toMatchObject({
      id: "upload-source",
    });
    const linkedFile = prepared.attachments!.find(
      (attachment) => attachment.type === "uploaded_file",
    )!;
    if (linkedFile.type !== "uploaded_file") throw new Error("Fixture file missing");
    const forgedPath = path.join(root, "other.txt");
    await writeFile(forgedPath, "actual durable bytes");
    await expect(
      prepareQueueFiles({
        directory,
        text: "forged",
        files: { attachments: [linkedFile, { ...linkedFile, path: forgedPath }] },
        ownsUpload: () => false,
        identity: {},
        fingerprint: "forged",
      }),
    ).rejects.toThrow("does not belong");
    await writeFile(path.join(directory, "queue.json"), '{"version":1,"items":"broken"}');
    await expect(pruneSessionDrafts(directory, future)).rejects.toThrow();
    for (const file of handed.links.files) await access(path.join(directory, file.relativePath));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const { withFile, removeSource } of [
  { withFile: false, removeSource: true },
  { withFile: true, removeSource: true },
  { withFile: true, removeSource: false },
]) {
  test(`authorized queued history handoff retains source provenance after source removal: files=${withFile}, removed=${removeSource}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "queue-history-"));
    try {
      const source = path.join(root, "source");
      const target = path.join(root, "target");
      await mkdir(source);
      await mkdir(target);
      const sourceFile = path.join(source, "original.txt");
      await writeFile(sourceFile, "retained fork bytes");
      if (withFile)
        await attachSessionFiles({
          directory: source,
          messageId: "history-message",
          attachments: [
            {
              type: "uploaded_file",
              id: "source-file",
              fileName: "original.txt",
              mimeType: "text/plain",
              size: 19,
              path: sourceFile,
            },
          ],
          ownsUpload: () => true,
        });
      const anchor = { agentId: "source", epoch: "observed", seq: 1 };
      const content = await prepareQueueFiles({
        directory: target,
        text: "Fork context",
        files: {
          attachments: [
            {
              type: "text",
              mimeType: "text/plain",
              contextKind: "chat_history",
              text: `Known ${path.join(source, "uploads", "source-file", "original.txt")}`,
              sourceSession: anchor,
            },
          ],
        },
        ownsUpload: () => false,
        resolveForkSource: async () => ({
          directory: source,
          messageIds: (async function* () {
            yield "history-message";
          })(),
        }),
        identity: {},
        fingerprint: "fixture",
      });
      if (withFile)
        await writeFile(
          path.join(source, "uploads", "source-file", "original.txt"),
          "changed source bytes",
        );
      if (removeSource) await rm(source, { recursive: true });
      await hydrateQueueContent(target, content);
      const handed = await attachQueueFiles(target, "logical", content);
      expect(handed.links.forkSources).toEqual([anchor]);
      expect(handed.links.files).toHaveLength(withFile ? 1 : 0);
      for (const file of handed.links.files)
        expect(await readFile(path.join(target, file.relativePath), "utf8")).toBe(
          "retained fork bytes",
        );
      expect(handed.attachments?.[0]).toMatchObject({ sourceSession: anchor });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("unauthorized history source fails before durable queue acknowledgement", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "queue-history-denied-"));
  const runtime = new InputQueueRuntime(pino({ level: "silent" }));
  try {
    runtime.register("target", {
      directory,
      ready: async () => false,
      delivered: async () => false,
      handoff: async () => {
        throw new Error("must not dispatch");
      },
    });
    await expect(
      runtime.command(
        "target",
        {
          action: "enqueue",
          id: "denied",
          text: "",
          attachments: [
            {
              type: "text",
              mimeType: "text/plain",
              contextKind: "chat_history",
              text: "Unauthorized",
              sourceSession: { agentId: "forbidden", epoch: "e", seq: 1 },
            },
          ],
        },
        {
          ownsUpload: () => false,
          resolveForkSource: async () => {
            throw new Error("Source session access denied");
          },
        },
      ),
    ).rejects.toThrow("Source session access denied");
    const result = await runtime.command(
      "target",
      { action: "fetch" },
      { ownsUpload: () => false },
    );
    expect(result.queue).toEqual({ revision: 0, items: [] });
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
