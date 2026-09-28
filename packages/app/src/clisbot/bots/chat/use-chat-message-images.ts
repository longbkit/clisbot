import { retainAttachmentForGarbageCollection } from "@/attachments/gc-retention";
import { useEffect, useState } from "react";
import { persistAttachmentFromDataUrl } from "@/attachments/service";
import type { AttachmentMetadata } from "@/attachments/types";
import type { ChatMessage } from "../data/contracts";
/** Reuse the regular message image preview/lightbox for canonical chat images. */
export function useChatMessageImages(serverId: string, line: ChatMessage) {
  const [images, setImages] = useState<AttachmentMetadata[]>([]);
  useEffect(() => {
    let active = true;
    const releases = (line.images ?? []).map((_, index) =>
      retainAttachmentForGarbageCollection(`chat:${serverId}:${line.id}:${index}`),
    );
    const load = async () => {
      try {
        const next = await Promise.all(
          (line.images ?? []).map((image, index) =>
            persistAttachmentFromDataUrl({
              id: `chat:${serverId}:${line.id}:${index}`,
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
