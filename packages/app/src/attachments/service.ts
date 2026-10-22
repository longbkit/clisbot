import { prepareImagesForSend, MAX_PREPARED_IMAGE_CHARACTERS } from "./image-send-preparation";
import { collectRetainedAttachmentIds } from "@/attachments/gc-retention";
import { getAttachmentStore } from "@/attachments/store";
import type { AttachmentMetadata, SaveAttachmentInput } from "@/attachments/types";

const activePersistence = new Set<Promise<AttachmentMetadata>>();
/** Bound client-side encoding before base64 expands data in memory. */
export const MAX_SEND_ATTACHMENT_COUNT = 32;
export const MAX_SEND_ATTACHMENT_BYTES = 32 * 1024 * 1024;
const persistedDuringGarbageCollection = new Set<string>();
let pendingGarbageCollections = 0;
let garbageCollectionTail: Promise<void> = Promise.resolve();
let persistenceBarrier: Promise<void> | null = null;
let releasePersistenceBarrier: (() => void) | null = null;

async function waitForPersistenceBarrier(): Promise<void> {
  const barrier = persistenceBarrier;
  if (!barrier) {
    return;
  }
  await barrier;
  await waitForPersistenceBarrier();
}

async function persistAttachment(input: SaveAttachmentInput): Promise<AttachmentMetadata> {
  await waitForPersistenceBarrier();
  const pending = (async () => {
    const store = await getAttachmentStore();
    const attachment = await store.save(input);
    if (pendingGarbageCollections > 0) {
      persistedDuringGarbageCollection.add(attachment.id);
    }
    return attachment;
  })();
  activePersistence.add(pending);
  try {
    return await pending;
  } finally {
    activePersistence.delete(pending);
  }
}

export async function persistAttachmentFromBlob(input: {
  blob: Blob;
  mimeType?: string;
  fileName?: string | null;
  id?: string;
}): Promise<AttachmentMetadata> {
  return await persistAttachment({
    id: input.id,
    mimeType: input.mimeType,
    fileName: input.fileName,
    source: { kind: "blob", blob: input.blob },
  });
}

export async function persistAttachmentFromDataUrl(input: {
  dataUrl: string;
  mimeType?: string;
  fileName?: string | null;
  id?: string;
}): Promise<AttachmentMetadata> {
  return await persistAttachment({
    id: input.id,
    mimeType: input.mimeType,
    fileName: input.fileName,
    source: { kind: "data_url", dataUrl: input.dataUrl },
  });
}

export async function persistAttachmentFromBytes(input: {
  bytes: Uint8Array;
  mimeType?: string;
  fileName?: string | null;
  id?: string;
}): Promise<AttachmentMetadata> {
  return await persistAttachment({
    id: input.id,
    mimeType: input.mimeType,
    fileName: input.fileName,
    source: { kind: "bytes", bytes: input.bytes },
  });
}

export async function persistAttachmentFromFileUri(input: {
  uri: string;
  mimeType?: string;
  fileName?: string | null;
  id?: string;
}): Promise<AttachmentMetadata> {
  return await persistAttachment({
    id: input.id,
    mimeType: input.mimeType,
    fileName: input.fileName,
    source: { kind: "file_uri", uri: input.uri },
  });
}

export async function encodeAttachmentsForSend(
  attachments: readonly AttachmentMetadata[] | undefined,
): Promise<Array<{ data: string; mimeType: string }> | undefined> {
  if (!attachments || attachments.length === 0) {
    return undefined;
  }

  if (attachments.length > MAX_SEND_ATTACHMENT_COUNT) {
    throw new Error(`Too many attachments (maximum ${MAX_SEND_ATTACHMENT_COUNT}).`);
  }
  // Store metadata rejects known oversized originals before loading. The actual
  // encoded size below also bounds inputs with missing/understated metadata.
  const store = await getAttachmentStore();
  const prepared: Array<{ data: string; mimeType: string }> = [];
  let remaining = MAX_PREPARED_IMAGE_CHARACTERS;
  for (let index = 0; index < attachments.length; index++) {
    const attachment = attachments[index];
    if (
      typeof attachment.byteSize === "number" &&
      attachment.byteSize > MAX_SEND_ATTACHMENT_BYTES
    ) {
      throw new Error(
        "This image is too large to prepare. Your draft is kept; choose an image under 32 MiB.",
      );
    }
    let data: string;
    try {
      data = await store.encodeBase64({ attachment });
    } catch (error) {
      throw new Error(
        `Unable to read image ${attachment.fileName ?? attachment.id}. Your draft is kept; try choosing it again.`,
        { cause: error },
      );
    }
    if (data.length > Math.ceil(MAX_SEND_ATTACHMENT_BYTES / 3) * 4) {
      throw new Error(
        "This image is too large to prepare. Your draft is kept; choose an image under 32 MiB.",
      );
    }
    // Equal shares avoid starving an image when stored metadata is stale.
    // Unused space from earlier small images remains available to later ones.
    const allowance = Math.floor(remaining / (attachments.length - index));
    try {
      const image = { data, mimeType: attachment.mimeType };
      if (data.length <= allowance) {
        prepared.push(image);
      } else {
        const { createSendImageEncoder } = await import("./image-send-encoder");
        const [copy] = await prepareImagesForSend([image], createSendImageEncoder, allowance);
        prepared.push(copy);
      }
      remaining -= prepared[index].data.length;
    } catch (error) {
      throw new Error(
        "Could not prepare these images. Your draft is kept; try choosing the images again.",
        { cause: error },
      );
    }
    // Only bounded send copies survive this iteration, never all originals.
  }
  return prepared;
}

export async function resolveAttachmentPreviewUrl(attachment: AttachmentMetadata): Promise<string> {
  const store = await getAttachmentStore();
  return await store.resolvePreviewUrl({ attachment });
}

export async function releaseAttachmentPreviewUrl(input: {
  attachment: AttachmentMetadata;
  url: string;
}): Promise<void> {
  const store = await getAttachmentStore();
  if (!store.releasePreviewUrl) {
    return;
  }
  await store.releasePreviewUrl({ attachment: input.attachment, url: input.url });
}

export async function deleteAttachments(
  attachments: readonly AttachmentMetadata[] | undefined,
): Promise<void> {
  if (!attachments || attachments.length === 0) {
    return;
  }
  const store = await getAttachmentStore();
  await Promise.all(
    attachments.map(async (attachment) => {
      try {
        await store.delete({ attachment });
      } catch (error) {
        console.warn("[attachments] Failed to delete attachment", {
          id: attachment.id,
          error,
        });
      }
    }),
  );
}

export async function garbageCollectAttachments(input: {
  referencedIds: ReadonlySet<string>;
}): Promise<void> {
  pendingGarbageCollections += 1;
  if (!persistenceBarrier) {
    persistenceBarrier = new Promise<void>((resolve) => {
      releasePersistenceBarrier = resolve;
    });
  }

  const previousGarbageCollection = garbageCollectionTail;
  const currentGarbageCollection = (async () => {
    await previousGarbageCollection;
    while (activePersistence.size > 0) {
      await Promise.allSettled(activePersistence);
    }
    const referencedIds = new Set(input.referencedIds);
    for (const id of collectRetainedAttachmentIds()) {
      referencedIds.add(id);
    }
    for (const id of persistedDuringGarbageCollection) {
      referencedIds.add(id);
    }
    const store = await getAttachmentStore();
    await store.garbageCollect({ referencedIds });
  })();
  garbageCollectionTail = currentGarbageCollection.catch(() => undefined);

  try {
    await currentGarbageCollection;
  } finally {
    pendingGarbageCollections -= 1;
    if (pendingGarbageCollections === 0) {
      persistedDuringGarbageCollection.clear();
      const release = releasePersistenceBarrier;
      releasePersistenceBarrier = null;
      persistenceBarrier = null;
      release?.();
    }
  }
}
