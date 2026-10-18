import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  copyAttachmentFileToManagedStorage,
  deleteManagedAttachmentFile,
  garbageCollectManagedAttachmentFiles,
  readManagedFileBase64,
  writeAttachmentBase64,
  writeAttachmentBytes,
} from "../../../desktop/src/features/attachments";
import { createDesktopAttachmentStore } from "@/desktop/attachments/desktop-attachment-store";
import { __setAttachmentStoreForTests } from "@/attachments/store";
import { collectRetainedAttachmentIds } from "@/attachments/gc-retention";
import {
  encodeAttachmentsForSend,
  garbageCollectAttachments,
  persistAttachmentFromDataUrl,
  resolveAttachmentPreviewUrl,
} from "@/attachments/service";
import type { ComposerAttachment } from "@/attachments/types";
import { composerAttachmentIds } from "./attachment-references";
import { submitAgentInput } from "./submit";
// Keep real Desktop file storage; this app test must not require a built server.
vi.mock("@clisbot/server/daemon-control", () => ({
  resolveClisbotHome: () => {
    if (!process.env.CLISBOT_HOME) throw new Error("Isolated attachment home required");
    return process.env.CLISBOT_HOME;
  },
}));
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==";
let home: string;
beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "clisbot-paste-send-"));
  vi.stubEnv("CLISBOT_HOME", home);
  __setAttachmentStoreForTests(
    createDesktopAttachmentStore({
      copyFile: copyAttachmentFileToManagedStorage,
      writeBase64: writeAttachmentBase64,
      writeBytes: writeAttachmentBytes,
      deleteFile: deleteManagedAttachmentFile,
      garbageCollect: garbageCollectManagedAttachmentFiles,
      readFileBase64: (file) => readManagedFileBase64({ path: file }),
      resolvePreviewUrl: async (attachment) =>
        `data:image/png;base64,${await readManagedFileBase64({ path: attachment.storageKey })}`,
      releasePreviewUrl: async () => undefined,
    }),
  );
});
afterEach(async () => {
  __setAttachmentStoreForTests(null);
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});
describe("paste → immediate send attachment lifetime", () => {
  it.each([false, true])(
    "keeps actual desktop bytes across draft clear; rejection=%s",
    async (reject) => {
      const image = await persistAttachmentFromDataUrl({
        dataUrl: `data:image/png;base64,${png}`,
        fileName: "image.png",
      });
      expect(image.storageKey.startsWith(home + path.sep)).toBe(true);
      expect(await resolveAttachmentPreviewUrl(image)).toBe(`data:image/png;base64,${png}`);
      const original: ComposerAttachment[] = [{ kind: "image", metadata: image }];
      let draft = original;
      let collection: Promise<void> = Promise.resolve();
      let sent: unknown;
      const result = await submitAgentInput({
        message: "pasted image",
        attachments: original,
        isAgentRunning: false,
        canSubmit: true,
        queueMessage: async () => {
          throw new Error("unexpected queue");
        },
        submitMessage: async () => {
          // Draft clearing schedules GC before asynchronous upload/encoding.
          await collection;
          sent = await encodeAttachmentsForSend([image]);
          if (reject) throw new Error("synthetic send rejection");
        },
        clearDraft: () => {
          draft = [];
        },
        setUserInput: () => undefined,
        setAttachments: (attachments) => {
          draft = attachments;
          if (!attachments.length)
            collection = garbageCollectAttachments({ referencedIds: new Set() });
        },
        setSendError: () => undefined,
        setIsProcessing: () => undefined,
      });
      expect(sent).toEqual([{ data: png, mimeType: "image/png" }]);
      expect(result).toBe(reject ? "failed" : "submitted");
      expect(collectRetainedAttachmentIds().has(image.id)).toBe(false);
      await garbageCollectAttachments({ referencedIds: composerAttachmentIds(draft) });
      if (reject) {
        expect(draft).toEqual(original);
        expect((await readFile(image.storageKey)).toString("base64")).toBe(png);
      } else await expect(readFile(image.storageKey)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
});
