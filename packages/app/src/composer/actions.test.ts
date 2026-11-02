import { describe, expect, it, vi } from "vitest";
import type { AgentAttachment, ForgeSearchItem } from "@clisbot/protocol/messages";
import type {
  AttachmentMetadata,
  ComposerAttachment,
  UserComposerAttachment,
  WorkspaceComposerAttachment,
} from "@/attachments/types";
import {
  uploadFileAttachments,
  cancelComposerAgent,
  editQueuedComposerMessage,
  findForgeItemByOption,
  isAttachmentSelectedForForgeItem,
  openComposerAttachment,
  pickAndPersistImages,
  queueComposerMessage,
  removeComposerAttachmentAtIndex,
  sendQueuedComposerMessageNow,
  toggleForgeAttachment,
  toggleForgeAttachmentFromPicker,
  type AttachmentPersister,
  type ComposerCancelClient,
  type ComposerSendClient,
  type QueueWriter,
  type QueuedComposerMessage,
} from "./actions";

const imageMetadata: AttachmentMetadata = {
  id: "img-1",
  mimeType: "image/png",
  storageType: "web-indexeddb",
  storageKey: "img-1",
  fileName: "img-1.png",
  byteSize: 42,
  createdAt: 1,
};

const issueItem: ForgeSearchItem = {
  kind: "issue",
  number: 101,
  title: "Fix composer attachments",
  url: "https://github.com/acme/clisbot/issues/101",
  state: "open",
  body: "Issue body",
  labels: ["composer"],
  baseRefName: null,
  headRefName: null,
};

const prItem: ForgeSearchItem = {
  kind: "change_request",
  number: 202,
  title: "Refactor composer attachments",
  url: "https://github.com/acme/clisbot/pull/202",
  state: "open",
  body: "PR body",
  labels: ["composer"],
  baseRefName: "main",
  headRefName: "composer-attachments",
};

function imageWithId(id: string): AttachmentMetadata {
  return { ...imageMetadata, id, storageKey: id, fileName: `${id}.png` };
}

function reviewWorkspaceAttachment(
  body: string,
): Extract<WorkspaceComposerAttachment, { kind: "review" }> {
  const attachment: Extract<AgentAttachment, { type: "review" }> = {
    type: "review",
    mimeType: "application/clisbot-review",
    cwd: "/repo",
    mode: "uncommitted",
    baseRef: null,
    comments: [
      {
        filePath: "src/example.ts",
        side: "new",
        lineNumber: 41,
        body,
        context: {
          hunkHeader: "@@ -40,2 +40,2 @@",
          targetLine: {
            oldLineNumber: null,
            newLineNumber: 41,
            type: "add",
            content: "const value = newValue;",
          },
          lines: [
            {
              oldLineNumber: null,
              newLineNumber: 41,
              type: "add",
              content: "const value = newValue;",
            },
          ],
        },
      },
    ],
  };
  return {
    kind: "review",
    reviewDraftKey: `review:${body}`,
    commentCount: 1,
    attachment,
  };
}

function createFakePersister(): AttachmentPersister & {
  blobCalls: Array<{ blob: Blob; mimeType: string; fileName: string | null }>;
  dataUrlCalls: Array<{ dataUrl: string; mimeType: string; fileName: string | null }>;
  fileUriCalls: Array<{ uri: string; mimeType: string; fileName: string | null }>;
  deletedBatches: AttachmentMetadata[][];
} {
  const blobCalls: Array<{ blob: Blob; mimeType: string; fileName: string | null }> = [];
  const dataUrlCalls: Array<{ dataUrl: string; mimeType: string; fileName: string | null }> = [];
  const fileUriCalls: Array<{ uri: string; mimeType: string; fileName: string | null }> = [];
  const deletedBatches: AttachmentMetadata[][] = [];
  return {
    blobCalls,
    dataUrlCalls,
    fileUriCalls,
    deletedBatches,
    persistFromBlob: async ({ blob, mimeType, fileName }) => {
      blobCalls.push({ blob, mimeType, fileName });
      return { ...imageMetadata, id: `blob-${blobCalls.length}` };
    },
    persistFromDataUrl: async ({ dataUrl, mimeType, fileName }) => {
      dataUrlCalls.push({ dataUrl, mimeType, fileName });
      return { ...imageMetadata, id: `data-url-${dataUrlCalls.length}` };
    },
    persistFromFileUri: async ({ uri, mimeType, fileName }) => {
      fileUriCalls.push({ uri, mimeType, fileName });
      return { ...imageMetadata, id: `uri-${fileUriCalls.length}` };
    },
    deleteAttachments: (metadata) => {
      deletedBatches.push(metadata);
    },
  };
}

function createFakeQueue(
  initial: Map<string, QueuedComposerMessage[]> = new Map(),
): QueueWriter & { state: Map<string, QueuedComposerMessage[]> } {
  const fake: QueueWriter & { state: Map<string, QueuedComposerMessage[]> } = {
    state: new Map(initial),
    read: (agentId) => fake.state.get(agentId) ?? [],
    write: (updater) => {
      fake.state = updater(fake.state);
    },
  };
  return fake;
}

describe("cancelComposerAgent", () => {
  function baseInput(): {
    client: ComposerCancelClient & { canceledIds: string[] };
    agentId: string;
    isAgentRunning: boolean;
    isCancellingAgent: boolean;
    isConnected: boolean;
  } {
    const canceledIds: string[] = [];
    return {
      client: {
        canceledIds,
        cancelAgent: async (id) => {
          canceledIds.push(id);
        },
      },
      agentId: "agent",
      isAgentRunning: true,
      isCancellingAgent: false,
      isConnected: true,
    };
  }

  it("returns the cancel request when the agent is running, connected, and not already canceling", async () => {
    const input = baseInput();
    const result = cancelComposerAgent(input);
    expect(result).not.toBeNull();
    await result;
    expect(input.client.canceledIds).toEqual(["agent"]);
  });

  it("returns a rejected cancel request to the composer", async () => {
    const cancellationError = new Error("Provider rejected the interrupt");
    const input = baseInput();
    input.client.cancelAgent = async () => {
      throw cancellationError;
    };

    await expect(cancelComposerAgent(input)).rejects.toBe(cancellationError);
  });

  it("does nothing when the agent is not running", () => {
    const input = baseInput();
    const result = cancelComposerAgent({ ...input, isAgentRunning: false });
    expect(result).toBeNull();
    expect(input.client.canceledIds).toEqual([]);
  });

  it("does nothing when the agent is already being canceled", () => {
    const input = baseInput();
    const result = cancelComposerAgent({ ...input, isCancellingAgent: true });
    expect(result).toBeNull();
    expect(input.client.canceledIds).toEqual([]);
  });

  it("does nothing when disconnected or the client is null", () => {
    const input = baseInput();
    expect(cancelComposerAgent({ ...input, isConnected: false })).toBeNull();
    expect(cancelComposerAgent({ ...input, client: null })).toBeNull();
    expect(input.client.canceledIds).toEqual([]);
  });
});

describe("pickAndPersistImages", () => {
  it("returns [] when the picker yields nothing", async () => {
    const persister = createFakePersister();
    const result = await pickAndPersistImages({
      pickImages: async () => null,
      persister,
    });
    expect(result).toEqual([]);
    expect(persister.blobCalls).toEqual([]);
    expect(persister.fileUriCalls).toEqual([]);
  });

  it("persists blob sources via persistFromBlob with the picked mime type and file name", async () => {
    const persister = createFakePersister();
    const blob = new Blob(["image"]);
    const result = await pickAndPersistImages({
      pickImages: async () => [
        { source: { kind: "blob", blob }, mimeType: "image/png", fileName: "img-1.png" },
      ],
      persister,
    });
    expect(persister.blobCalls).toEqual([{ blob, mimeType: "image/png", fileName: "img-1.png" }]);
    expect(result.map((m) => m.id)).toEqual(["blob-1"]);
  });

  it("persists file_uri sources via persistFromFileUri", async () => {
    const persister = createFakePersister();
    const result = await pickAndPersistImages({
      pickImages: async () => [
        {
          source: { kind: "file_uri", uri: "/tmp/x.jpg" },
          mimeType: "image/jpeg",
          fileName: null,
        },
      ],
      persister,
    });
    expect(persister.fileUriCalls).toEqual([
      { uri: "/tmp/x.jpg", mimeType: "image/jpeg", fileName: null },
    ]);
    expect(result).toHaveLength(1);
  });

  it("persists data_url sources via persistFromDataUrl", async () => {
    const persister = createFakePersister();
    const dataUrl = "data:image/png;base64,AAEC";
    const result = await pickAndPersistImages({
      pickImages: async () => [
        {
          source: { kind: "data_url", dataUrl },
          mimeType: "image/png",
          fileName: "clipboard.png",
        },
      ],
      persister,
    });
    expect(persister.dataUrlCalls).toEqual([
      { dataUrl, mimeType: "image/png", fileName: "clipboard.png" },
    ]);
    expect(result).toHaveLength(1);
  });
});

describe("queueComposerMessage", () => {
  it("queues a trimmed message under the agent id and returns the new entry", () => {
    const queue = createFakeQueue();
    const result = queueComposerMessage({
      agentId: "agent",
      text: "  draft  ",
      attachments: [],
      queue,
    });

    expect(result.queued?.text).toBe("draft");
    expect(queue.state.get("agent")).toEqual([
      { id: result.queued?.id, text: "draft", attachments: [] },
    ]);
  });

  it("does not queue an empty message with no attachments", () => {
    const queue = createFakeQueue();
    const result = queueComposerMessage({
      agentId: "agent",
      text: "   ",
      attachments: [],
      queue,
    });
    expect(result.queued).toBeNull();
    expect(queue.state.get("agent")).toBeUndefined();
  });

  it("captures workspace review attachments at queue time alongside user attachments", () => {
    const queue = createFakeQueue();
    const review = reviewWorkspaceAttachment("Initial queued review.");
    const image = imageWithId("img-queue");
    queueComposerMessage({
      agentId: "agent",
      text: "queue this",
      attachments: [{ kind: "image", metadata: image }, review],
      queue,
    });

    expect(queue.state.get("agent")?.[0]?.attachments).toEqual([
      { kind: "image", metadata: image },
      review,
    ]);
  });
});

describe("editQueuedComposerMessage", () => {
  it("returns null and leaves the queue untouched when the message id is missing", () => {
    const queue = createFakeQueue(
      new Map([["agent", [{ id: "other", text: "other", attachments: [] }]]]),
    );
    const result = editQueuedComposerMessage({ agentId: "agent", messageId: "missing", queue });
    expect(result).toBeNull();
    expect(queue.state.get("agent")).toHaveLength(1);
  });

  it("returns the text and only user attachments, removing the queued entry", () => {
    const review = reviewWorkspaceAttachment("Queued snapshot.");
    const image = imageWithId("img-queued-edit");
    const queue = createFakeQueue(
      new Map([
        [
          "agent",
          [
            {
              id: "msg-1",
              text: "queued draft",
              attachments: [{ kind: "image", metadata: image }, review],
            },
          ],
        ],
      ]),
    );

    const result = editQueuedComposerMessage({ agentId: "agent", messageId: "msg-1", queue });
    expect(result).toEqual({
      text: "queued draft",
      attachments: [{ kind: "image", metadata: image }],
    });
    expect(queue.state.get("agent")).toEqual([]);
  });
});

describe("sendQueuedComposerMessageNow", () => {
  it("returns missing without submitting when the message id is gone", async () => {
    const queue = createFakeQueue();
    const submitted: Array<{ text: string; attachments: ComposerAttachment[] }> = [];
    const result = await sendQueuedComposerMessageNow({
      agentId: "agent",
      messageId: "msg-1",
      queue,
      submitMessage: async (input) => {
        submitted.push(input);
      },
    });
    expect(result).toEqual({ status: "missing" });
    expect(submitted).toEqual([]);
  });

  it("removes the queued entry and submits its text + attachments", async () => {
    const review = reviewWorkspaceAttachment("Queued for send.");
    const queue = createFakeQueue(
      new Map([["agent", [{ id: "msg-1", text: "send me", attachments: [review] }]]]),
    );
    const submitted: Array<{ text: string; attachments: ComposerAttachment[] }> = [];
    const result = await sendQueuedComposerMessageNow({
      agentId: "agent",
      messageId: "msg-1",
      queue,
      submitMessage: async (input) => {
        submitted.push(input);
      },
    });
    expect(result).toEqual({ status: "submitted" });
    expect(queue.state.get("agent")).toEqual([]);
    expect(submitted).toEqual([{ text: "send me", attachments: [review] }]);
  });

  it("restores the queued entry to the front and surfaces the error message on failure", async () => {
    const queue = createFakeQueue(
      new Map([
        [
          "agent",
          [
            { id: "msg-1", text: "first", attachments: [] },
            { id: "msg-2", text: "second", attachments: [] },
          ],
        ],
      ]),
    );
    const result = await sendQueuedComposerMessageNow({
      agentId: "agent",
      messageId: "msg-1",
      queue,
      submitMessage: async () => {
        throw new Error("network down");
      },
    });
    expect(result).toEqual({ status: "failed", errorMessage: "network down" });
    const state = queue.state.get("agent");
    expect(state?.map((m) => m.id)).toEqual(["msg-1", "msg-2"]);
  });
});

describe("removeComposerAttachmentAtIndex", () => {
  it("removes an image attachment and asks the persister to delete the underlying metadata", () => {
    const image = imageWithId("img-remove");
    const persister = createFakePersister();
    const next = removeComposerAttachmentAtIndex({
      attachments: [{ kind: "image", metadata: image }] satisfies UserComposerAttachment[],
      index: 0,
      deleteAttachments: persister.deleteAttachments,
    });
    expect(next).toEqual([]);
    expect(persister.deletedBatches).toEqual([[image]]);
  });

  it("removes a github attachment without scheduling any storage deletes", () => {
    const persister = createFakePersister();
    const next = removeComposerAttachmentAtIndex({
      attachments: [
        { kind: "github_issue", item: issueItem },
        { kind: "github_pr", item: prItem },
      ] satisfies UserComposerAttachment[],
      index: 0,
      deleteAttachments: persister.deleteAttachments,
    });
    expect(next).toEqual([{ kind: "github_pr", item: prItem }]);
    expect(persister.deletedBatches).toEqual([]);
  });
});

describe("openComposerAttachment", () => {
  it("opens the lightbox for image attachments", () => {
    const image = imageWithId("img-body");
    const lightboxCalls: AttachmentMetadata[] = [];
    const externalUrlCalls: string[] = [];
    openComposerAttachment({
      attachment: { kind: "image", metadata: image },
      setLightboxMetadata: (metadata) => {
        lightboxCalls.push(metadata);
      },
      openWorkspaceAttachment: () => false,
      openExternalUrl: (url) => {
        externalUrlCalls.push(url);
      },
    });
    expect(lightboxCalls).toEqual([image]);
    expect(externalUrlCalls).toEqual([]);
  });

  it("delegates workspace review attachments to the workspace opener", () => {
    const review = reviewWorkspaceAttachment("Open me.");
    const workspaceCalls: ComposerAttachment[] = [];
    openComposerAttachment({
      attachment: review,
      setLightboxMetadata: () => {
        throw new Error("unexpected lightbox call");
      },
      openWorkspaceAttachment: ({ attachment }) => {
        workspaceCalls.push(attachment);
        return true;
      },
      openExternalUrl: () => {
        throw new Error("unexpected external url call");
      },
    });
    expect(workspaceCalls).toEqual([review]);
  });

  it("opens GitHub item URLs through the external url opener", () => {
    const externalUrlCalls: string[] = [];
    openComposerAttachment({
      attachment: { kind: "github_issue", item: issueItem },
      setLightboxMetadata: () => {
        throw new Error("unexpected lightbox call");
      },
      openWorkspaceAttachment: () => false,
      openExternalUrl: (url) => {
        externalUrlCalls.push(url);
      },
    });
    expect(externalUrlCalls).toEqual([issueItem.url]);
  });

  it("opens plugin resource URLs through the external url opener", () => {
    const externalUrlCalls: string[] = [];
    openComposerAttachment({
      attachment: {
        kind: "plugin_resource",
        pluginId: "linear",
        sourceId: "issues",
        sourceTitle: "Linear issue",
        sourceIcon: "CircleDot",
        item: {
          id: "issue-uuid",
          identifier: "ENG-123",
          title: "Plugin attachments",
          url: "https://linear.app/acme/issue/ENG-123/plugin-attachments",
          text: "Linear issue ENG-123: Plugin attachments",
          resourceType: "issue",
        },
      },
      setLightboxMetadata: () => {
        throw new Error("unexpected lightbox call");
      },
      openWorkspaceAttachment: () => false,
      openExternalUrl: (url) => {
        externalUrlCalls.push(url);
      },
    });
    expect(externalUrlCalls).toEqual(["https://linear.app/acme/issue/ENG-123/plugin-attachments"]);
  });
});

describe("toggleForgeAttachment", () => {
  it("appends a GitHub issue when not already attached", () => {
    const next = toggleForgeAttachment([], issueItem);
    expect(next).toEqual([{ kind: "forge_issue", item: issueItem }]);
  });

  it("appends a GitHub PR when not already attached", () => {
    const next = toggleForgeAttachment([], prItem);
    expect(next).toEqual([{ kind: "forge_change_request", item: prItem }]);
  });

  it("removes an existing GitHub item with the same kind+number", () => {
    const next = toggleForgeAttachment([{ kind: "github_issue", item: issueItem }], issueItem);
    expect(next).toEqual([]);
  });

  it("does not affect other items with different kind or number", () => {
    const start: UserComposerAttachment[] = [
      { kind: "github_issue", item: issueItem },
      { kind: "github_pr", item: prItem },
    ];
    const otherIssue: ForgeSearchItem = { ...issueItem, number: 999 };
    const next = toggleForgeAttachment(start, otherIssue);
    expect(next).toEqual([
      { kind: "github_issue", item: issueItem },
      { kind: "github_pr", item: prItem },
      { kind: "forge_issue", item: otherIssue },
    ]);
  });
});

describe("toggleForgeAttachmentFromPicker", () => {
  it("marks an existing GitHub item as removed when picker toggle removes it", () => {
    const markForgeAttachmentRemoved = vi.fn();
    const attachment: UserComposerAttachment = { kind: "github_pr", item: prItem };

    const next = toggleForgeAttachmentFromPicker({
      current: [attachment],
      item: prItem,
      markForgeAttachmentRemoved,
    });

    expect(next).toEqual([]);
    expect(markForgeAttachmentRemoved).toHaveBeenCalledTimes(1);
    expect(markForgeAttachmentRemoved).toHaveBeenCalledWith(attachment);
  });

  it("does not mark a GitHub item removed when picker toggle adds it", () => {
    const markForgeAttachmentRemoved = vi.fn();

    const next = toggleForgeAttachmentFromPicker({
      current: [],
      item: issueItem,
      markForgeAttachmentRemoved,
    });

    expect(next).toEqual([{ kind: "forge_issue", item: issueItem }]);
    expect(markForgeAttachmentRemoved).not.toHaveBeenCalled();
  });
});

describe("findForgeItemByOption / isAttachmentSelectedForForgeItem", () => {
  it("locates items via their composite kind:number id", () => {
    expect(findForgeItemByOption([issueItem, prItem], "issue:101")).toBe(issueItem);
    expect(findForgeItemByOption([issueItem, prItem], "change_request:202")).toBe(prItem);
    expect(findForgeItemByOption([issueItem], "change_request:404")).toBeUndefined();
  });

  it("recognizes when an attachment list already contains a matching GitHub item", () => {
    const attachments: ComposerAttachment[] = [
      { kind: "image", metadata: imageWithId("img-x") },
      { kind: "github_issue", item: issueItem },
      reviewWorkspaceAttachment("ignored"),
    ];
    expect(isAttachmentSelectedForForgeItem(attachments, issueItem)).toBe(true);
    expect(isAttachmentSelectedForForgeItem(attachments, prItem)).toBe(false);
  });
});

describe("file upload preparation", () => {
  it("waits for file bytes and daemon acknowledgement before returning the attachment", async () => {
    let resolveRead!: (bytes: Uint8Array) => void;
    const read = new Promise<Uint8Array>((resolve) => {
      resolveRead = resolve;
    });
    let acknowledge!: (result: Awaited<ReturnType<ComposerSendClient["uploadFile"]>>) => void;
    const response = new Promise<Awaited<ReturnType<ComposerSendClient["uploadFile"]>>>(
      (resolve) => {
        acknowledge = resolve;
      },
    );
    const sent: string[] = [];
    const upload = uploadFileAttachments({
      client: {
        sendAgentMessage: async () => {},
        uploadFile: async (file) => {
          sent.push(file.fileName);
          expect(file.bytes).toEqual(new Uint8Array([1, 2]));
          return response;
        },
      },
      files: [
        { fileName: "sample.bin", mimeType: "application/octet-stream", readBytes: () => read },
      ],
    });
    let completed = false;
    void upload.then(() => {
      completed = true;
      return undefined;
    });
    expect(sent).toEqual([]);
    resolveRead(new Uint8Array([1, 2]));
    await Promise.resolve();
    expect(sent).toEqual(["sample.bin"]);
    expect(completed).toBe(false);
    const file = {
      type: "uploaded_file" as const,
      id: "file-1",
      fileName: "sample.bin",
      mimeType: "application/octet-stream",
      size: 2,
      path: "/uploads/sample.bin",
    };
    acknowledge({ requestId: "req-1", file, error: null });
    await expect(upload).resolves.toEqual([{ kind: "file", attachment: file }]);
  });

  it.each(["unreadable", "oversized"])(
    "does not upload a batch containing a later %s file",
    async (failure) => {
      let sends = 0;
      await expect(
        uploadFileAttachments({
          client: {
            sendAgentMessage: async () => {},
            uploadFile: async () => {
              sends++;
              throw new Error("unexpected send");
            },
          },
          files: [
            {
              fileName: "valid.bin",
              mimeType: "application/octet-stream",
              readBytes: async () => new Uint8Array([1]),
            },
            {
              fileName: "missing.bin",
              mimeType: "application/octet-stream",
              readBytes: async () => {
                if (failure === "oversized") return new Uint8Array(50 * 1024 * 1024 + 1);
                throw new Error("read failed");
              },
            },
          ],
        }),
      ).rejects.toThrow(failure === "unreadable" ? "read failed" : "too large");
      expect(sends).toBe(0);
    },
  );
});
