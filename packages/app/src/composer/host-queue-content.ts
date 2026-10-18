import { persistAttachmentFromBytes } from "@/attachments/service";
import { getAttachmentStore } from "@/attachments/store";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { ComposerAttachment } from "@/attachments/types";
import type { UploadedFileAttachment } from "@clisbot/protocol/messages";
import type { InputQueueView } from "@clisbot/protocol/input-queue";
import type { UserComposerAttachment, AttachmentMetadata } from "@/attachments/types";

/** Restore durable wire context without dropping review/forge/source metadata. */
export async function queueItemAttachments(
  item: InputQueueView["items"][number],
  persistImage: (input: {
    dataUrl: string;
    mimeType: string;
    fileName: string | null;
  }) => Promise<AttachmentMetadata>,
  readFile: (id: string, fileId: string, size: number) => Promise<Uint8Array>,
): Promise<UserComposerAttachment[]> {
  const attachments: UserComposerAttachment[] = [];
  for (const attachment of item.attachments ?? []) {
    if (attachment.type !== "uploaded_file") {
      attachments.push({ kind: "agent_attachment", attachment });
      continue;
    }
    const bytes = await readFile(item.id, attachment.id, attachment.size);
    const localCopy = await persistAttachmentFromBytes({
      bytes,
      mimeType: attachment.mimeType,
      fileName: attachment.fileName,
    });
    attachments.push({ kind: "file", attachment, localCopy });
  }
  for (const image of item.images ?? []) {
    const metadata = await persistImage({
      dataUrl: `data:${image.mimeType};base64,${image.data}`,
      mimeType: image.mimeType,
      fileName: null,
    });
    attachments.push({ kind: "image", metadata });
  }
  return attachments;
}

const uploads = new WeakMap<DaemonClient, WeakMap<AttachmentMetadata, UploadedFileAttachment>>();
/** Reuse ordinary upload transport; local draft bytes survive deletion/cleanup on the Host. */
export async function uploadLocalQueueCopies(
  client: DaemonClient | null,
  attachments: ComposerAttachment[],
): Promise<ComposerAttachment[]> {
  const result: ComposerAttachment[] = [];
  for (const value of attachments) {
    if (value.kind !== "file" || !value.localCopy) {
      result.push(value);
      continue;
    }
    if (!client) throw new Error("Host is disconnected");
    let cache = uploads.get(client);
    if (!cache) {
      cache = new WeakMap();
      uploads.set(client, cache);
    }
    let attachment = cache.get(value.localCopy);
    if (!attachment) {
      const store = await getAttachmentStore();
      const data = atob(await store.encodeBase64({ attachment: value.localCopy }));
      const bytes = Uint8Array.from(data, (character) => character.charCodeAt(0));
      const uploaded = await client.uploadFile({
        bytes,
        fileName: value.attachment.fileName,
        mimeType: value.attachment.mimeType,
      });
      if (uploaded.error || !uploaded.file) throw new Error(uploaded.error ?? "Upload failed");
      attachment = uploaded.file;
      cache.set(value.localCopy, attachment);
    }
    result.push({ ...value, attachment });
  }
  return result;
}
