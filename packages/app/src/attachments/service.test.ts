import { afterEach, describe, expect, it } from "vitest";
import type { AttachmentMetadata, AttachmentStore, SaveAttachmentInput } from "@/attachments/types";
import { __setAttachmentStoreForTests } from "./store";
import {
  encodeAttachmentsForSend,
  encodeImageMessagesForSend,
  garbageCollectAttachments,
  persistAttachmentFromBytes,
} from "./service";
import {
  MAX_PREPARED_IMAGE_CHARACTERS,
  type SendImage,
  type SendImageEncoder,
} from "./image-send-preparation";

function createAttachment(input: Partial<AttachmentMetadata> = {}): AttachmentMetadata {
  return {
    id: input.id ?? "att_1",
    mimeType: input.mimeType ?? "image/png",
    storageType: input.storageType ?? "web-indexeddb",
    storageKey: input.storageKey ?? "att_1",
    fileName: input.fileName,
    byteSize: input.byteSize,
    createdAt: input.createdAt ?? 1700000000000,
  };
}

function createRecordingStore(): AttachmentStore & {
  savedSources: SaveAttachmentInput[];
  releasedUrls: string[];
} {
  const savedSources: SaveAttachmentInput[] = [];
  const releasedUrls: string[] = [];

  return {
    storageType: "web-indexeddb",
    savedSources,
    releasedUrls,
    async save(input) {
      savedSources.push(input);
      return createAttachment({
        id: input.id,
        mimeType: input.mimeType,
        fileName: input.fileName,
        byteSize: 4,
      });
    },
    async encodeBase64({ attachment }) {
      return `${attachment.id}:base64`;
    },
    async resolvePreviewUrl({ attachment }) {
      return `blob:${attachment.id}`;
    },
    async releasePreviewUrl({ url }) {
      releasedUrls.push(url);
    },
    async delete() {},
    async garbageCollect() {},
  };
}

describe("attachment service", () => {
  afterEach(() => {
    __setAttachmentStoreForTests(null);
  });

  it("persists raw bytes without requiring a base64 wrapper", async () => {
    const store = createRecordingStore();
    __setAttachmentStoreForTests(store);
    const bytes = new Uint8Array([0, 1, 2, 3]);

    const attachment = await persistAttachmentFromBytes({
      id: "att_bytes",
      bytes,
      mimeType: "image/png",
      fileName: "image.png",
    });

    expect(attachment).toEqual({
      id: "att_bytes",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "att_1",
      fileName: "image.png",
      byteSize: 4,
      createdAt: 1700000000000,
    });
    expect(store.savedSources).toEqual([
      {
        id: "att_bytes",
        mimeType: "image/png",
        fileName: "image.png",
        source: { kind: "bytes", bytes },
      },
    ]);
  });

  it("keeps provider send output byte-compatible", async () => {
    const store = createRecordingStore();
    __setAttachmentStoreForTests(store);
    const attachment = createAttachment({ id: "att_send", mimeType: "image/jpeg" });

    await expect(encodeAttachmentsForSend([attachment])).resolves.toEqual([
      { data: "att_send:base64", mimeType: "image/jpeg" },
    ]);
  });

  it("does not collect an attachment persisted while garbage collection is starting", async () => {
    let releaseSave: () => void = () => undefined;
    let reportSaveStarted: () => void = () => undefined;
    const saveStarted = new Promise<void>((resolve) => {
      reportSaveStarted = resolve;
    });
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const garbageCollections: string[][] = [];
    const store: AttachmentStore = {
      ...createRecordingStore(),
      async save(input) {
        reportSaveStarted();
        await saveGate;
        return createAttachment({ id: input.id });
      },
      async garbageCollect({ referencedIds }) {
        garbageCollections.push([...referencedIds]);
      },
    };
    __setAttachmentStoreForTests(store);

    const persist = persistAttachmentFromBytes({
      id: "assistant-preview",
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
    });
    await saveStarted;
    const collect = garbageCollectAttachments({ referencedIds: new Set() });

    try {
      await Promise.resolve();
      expect(garbageCollections).toEqual([]);
    } finally {
      releaseSave();
      await Promise.all([persist, collect]);
    }

    expect(garbageCollections).toEqual([["assistant-preview"]]);
  });
});

/** Stored originals of the given base64 length; "unreadable" cannot be read. */
function sizedStore(sizes: Record<string, number>): AttachmentStore {
  return {
    ...createRecordingStore(),
    async encodeBase64({ attachment }) {
      if (attachment.id === "unreadable") throw new Error("disk busy");
      return attachment.id.padEnd(sizes[attachment.id] ?? 16, "=");
    },
  };
}

/** Shrinks with each smaller step; `webp` names how the platform answers a WebP request. */
function scalingEncoder(webp: "works" | "throws" | "returns-png") {
  return async (image: SendImage): Promise<SendImageEncoder> => ({
    async encode(options) {
      if (options.format === "webp" && webp === "throws") throw new Error("no WebP");
      const format = options.format === "webp" && webp === "returns-png" ? "png" : options.format;
      // A PNG stays as large as the original; lossy copies scale with the dimension.
      const size =
        format === "png" ? image.data.length : Math.round(options.maxDimension ** 2 * 0.1);
      return { data: image.data.slice(0, 8).padEnd(size, "x"), mimeType: `image/${format}` };
    },
    dispose() {},
  });
}

/** Never gets an image below 900 KiB, whatever the step. */
async function floorEncoder(image: SendImage): Promise<SendImageEncoder> {
  return {
    async encode(options) {
      return {
        data: image.data.slice(0, 8).padEnd(900 * 1024, "x"),
        mimeType: options.format === "png" ? "image/png" : "image/webp",
      };
    },
    dispose() {},
  };
}

const ids = (count: number, prefix = "image") =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);
const attachments = (names: string[]) => names.map((id) => createAttachment({ id }));
const sizesOf = (names: string[], size: number) =>
  Object.fromEntries(names.map((id) => [id, size]));
const total = (images: SendImage[]) => images.reduce((sum, image) => sum + image.data.length, 0);
const counts = (messages: SendImage[][]) => messages.map((images) => images.length);
const mimeTypes = (images: SendImage[]) => images.map((image) => image.mimeType);
const prefixes = (images: SendImage[]) => images.map((image) => image.data.slice(0, 8));
const storedPrefix = (id: string) => id.padEnd(16, "=").slice(0, 8);

describe("images over one message's limits", () => {
  afterEach(() => {
    __setAttachmentStoreForTests(null);
  });

  it("splits 40 images into two ordered messages instead of refusing them", async () => {
    __setAttachmentStoreForTests(sizedStore({}));
    const messages = await encodeImageMessagesForSend(
      attachments(ids(40)),
      scalingEncoder("works"),
    );
    expect(counts(messages)).toEqual([20, 20]);
    expect(prefixes(messages.flat())).toEqual(ids(40).map(storedPrefix));
  });

  it("splits oversized PNGs that do not fit one message even at the smallest step", async () => {
    // Four 900 KiB copies do not fit one 2 MiB message; two do.
    const names = ids(4, "png");
    __setAttachmentStoreForTests(sizedStore(sizesOf(names, 4 * 1024 * 1024)));
    const messages = await encodeImageMessagesForSend(attachments(names), floorEncoder);
    expect(counts(messages)).toEqual([2, 2]);
    expect(messages.map(total).every((size) => size <= MAX_PREPARED_IMAGE_CHARACTERS)).toBe(true);
  });

  for (const webp of ["throws", "returns-png"] as const) {
    it(`prepares large PNGs as JPEG when WebP ${webp}`, async () => {
      const names = ids(3, "png");
      __setAttachmentStoreForTests(sizedStore(sizesOf(names, 3 * 1024 * 1024)));
      const messages = await encodeImageMessagesForSend(attachments(names), scalingEncoder(webp));
      expect(counts(messages)).toEqual([3]);
      expect(mimeTypes(messages[0])).toEqual(["image/jpeg", "image/jpeg", "image/jpeg"]);
      expect(total(messages[0])).toBeLessThanOrEqual(MAX_PREPARED_IMAGE_CHARACTERS);
    });
  }

  it("keeps every original when preparation fails and says what to do", async () => {
    const store = sizedStore({});
    __setAttachmentStoreForTests(store);
    const draft = attachments(["image-1", "unreadable", "image-3"]);
    await expect(encodeImageMessagesForSend(draft, scalingEncoder("works"))).rejects.toThrow(
      "Could not read image unreadable. Your draft is kept: send again, or remove that image.",
    );
    expect(draft).toEqual(attachments(["image-1", "unreadable", "image-3"]));
    await expect(store.encodeBase64({ attachment: draft[0] })).resolves.toBe("image-1=========");
  });

  it("a single-message caller says how to send more images than one message carries", async () => {
    __setAttachmentStoreForTests(sizedStore({}));
    await expect(encodeAttachmentsForSend(attachments(ids(33)))).rejects.toThrow(
      "One message carries at most 32 images. Your draft is kept: remove some images and send the rest in a second message.",
    );
  });
});
