import { retainAttachmentForGarbageCollection } from "@/attachments/gc-retention";
import { useEffect, useState } from "react";
import { persistAttachmentFromDataUrl } from "@/attachments/service";
import { createPreviewAttachmentId } from "@/attachments/utils";
import type { AttachmentMetadata } from "@/attachments/types";
import type { ChatMessage } from "../data/contracts";
/** Reuse the regular message image preview/lightbox for canonical chat images. */
export function useChatMessageImages(serverId: string, line: ChatMessage) {
  const [images, setImages] = useState<AttachmentMetadata[]>([]);
  useEffect(() => {
    let active = true;
    // Preview IDs also become native/Electron filenames; raw chat keys contain
    // separators that desktop-managed attachment storage deliberately rejects.
    const entries = (line.images ?? []).map((image, index) => ({
      image,
      id: createPreviewAttachmentId({
        mimeType: image.mimeType,
        path: JSON.stringify([serverId, line.id, index]),
        contentKey: image.data,
      }),
    }));
    const releases = entries.map(({ id }) => retainAttachmentForGarbageCollection(id));
    const load = async () => {
      try {
        const next = await Promise.all(
          entries.map(({ image, id }) =>
            persistAttachmentFromDataUrl({
              id,
              dataUrl: `data:${image.mimeType};base64,${image.data}`,
              mimeType: image.mimeType,
            }),
          ),
        );
        if (active) setImages(next);
      } catch {
        if (active) setImages([]);
      }
    };
    void load();
    return () => {
      active = false;
      for (const release of releases) release();
    };
  }, [serverId, line.id, line.images]);
  return images;
}
