import { afterEach, expect, test, vi } from "vitest";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { __setAttachmentStoreForTests } from "@/attachments/store";
import type { AttachmentMetadata, AttachmentStore } from "@/attachments/types";
import {
  collectReferencedAttachmentIdsFromState,
  UserComposerAttachmentSchema,
} from "@/stores/draft-store/state";
import { queueItemAttachments, uploadLocalQueueCopies } from "./host-queue-content";

afterEach(() => __setAttachmentStoreForTests(null));
test("local editor file survives original deletion and draft reload; retries reuse upload", async () => {
  const bytes = new TextEncoder().encode("file held by the local draft");
  let stored: Uint8Array | undefined;
  const metadata: AttachmentMetadata = {
    id: "local-file",
    mimeType: "text/plain",
    storageType: "web-indexeddb",
    storageKey: "local-file",
    createdAt: 1,
  };
  __setAttachmentStoreForTests({
    save: vi.fn(async (input) => {
      if (input.source.kind !== "bytes") throw new Error("Expected bytes");
      stored = input.source.bytes;
      return metadata;
    }),
    encodeBase64: vi.fn(async () => btoa(String.fromCharCode(...stored!))),
  } as unknown as AttachmentStore);
  const readFile = vi.fn(async () => bytes);
  const attachments = await queueItemAttachments(
    {
      id: "original",
      state: "queued",
      createdAt: "now",
      text: "",
      attachments: [
        {
          type: "uploaded_file",
          id: "remote",
          fileName: "note.txt",
          mimeType: "text/plain",
          size: bytes.length,
          path: "/old/note.txt",
        },
      ],
    },
    vi.fn(),
    readFile,
  );
  readFile.mockRejectedValue(new Error("Original deleted and Host cleanup ran"));
  const restored = attachments.map((value) =>
    UserComposerAttachmentSchema.parse(JSON.parse(JSON.stringify(value))),
  );
  expect(
    collectReferencedAttachmentIdsFromState({
      drafts: {
        draft: {
          input: { text: "", attachments: restored },
          lifecycle: "active",
          updatedAt: 1,
          version: 1,
        },
      },
      createModalDraft: null,
    }),
  ).toEqual(new Set(["local-file"]));
  const uploadFile = vi.fn(async (input) => {
    expect(input.bytes).toEqual(bytes);
    return {
      error: null,
      file: {
        ...(attachments[0].kind === "file" ? attachments[0].attachment : {}),
        id: "new-upload",
        path: "/new/note.txt",
      },
    };
  });
  const client = { uploadFile } as unknown as DaemonClient;
  const first = await uploadLocalQueueCopies(client, restored);
  const retry = await uploadLocalQueueCopies(client, restored);
  expect(first).toEqual(retry);
  expect(uploadFile).toHaveBeenCalledTimes(1);
  expect(readFile).toHaveBeenCalledTimes(1);
  // A queued Chat admission may outlive its original Host upload and cache entry.
  await uploadLocalQueueCopies(client, restored, true);
  expect(uploadFile).toHaveBeenCalledTimes(2);
  expect(readFile).toHaveBeenCalledTimes(1);
});

test("editor copies bounded chunks and rejects incomplete reads", async () => {
  const { readQueueAttachment } = await import("./read-queue-attachment");
  const data = new Uint8Array(70_000).fill(65);
  const execute = vi.fn(
    async (command: import("@clisbot/protocol/input-queue").InputQueueCommand) => {
      if (command.action !== "read_file") throw new Error("Expected read");
      const chunk = data.slice(command.offset, command.offset + 65_536);
      return {
        requestId: "read",
        agentId: "agent",
        queue: null,
        error: null,
        fileChunk: {
          data: btoa(String.fromCharCode(...chunk)),
          done: command.offset + chunk.length === data.length,
        },
      };
    },
  );
  expect(await readQueueAttachment(execute, "item", "file", data.length)).toEqual(data);
  expect(
    execute.mock.calls.map(([command]) => command.action === "read_file" && command.offset),
  ).toEqual([0, 65_536]);
  await expect(
    readQueueAttachment(
      async () => ({
        requestId: "read",
        agentId: "agent",
        queue: null,
        error: null,
        fileChunk: { data: "", done: true },
      }),
      "item",
      "file",
      3,
    ),
  ).rejects.toThrow("incomplete");
});
