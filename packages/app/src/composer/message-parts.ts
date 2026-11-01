import type { SendImage } from "@/attachments/image-send-preparation";

export interface MessagePart<TAttachment> {
  text: string;
  images: SendImage[];
  attachments: TAttachment[];
}

/**
 * One draft as ordered messages when its images exceed one message's limits. The user's text
 * and other attachments ride with the last part, so the agent answers once it has every image;
 * each earlier part says that more follows.
 */
export function splitIntoMessageParts<TAttachment>(input: {
  text: string;
  attachments: TAttachment[];
  imageMessages: SendImage[][];
}): MessagePart<TAttachment>[] {
  const { text, attachments, imageMessages } = input;
  if (imageMessages.length <= 1) return [{ text, images: imageMessages[0] ?? [], attachments }];
  const total = imageMessages.reduce((sum, images) => sum + images.length, 0);
  let first = 1;
  return imageMessages.map((images, index) => {
    const last = first + images.length - 1;
    const part =
      index === imageMessages.length - 1
        ? { text, images, attachments }
        : { text: continuationNote(first, last, total), images, attachments: [] };
    first = last + 1;
    return part;
  });
}

function continuationNote(first: number, last: number, total: number): string {
  return `[Images ${first}–${last} of ${total}. The message continues in the next part; wait for it before you answer.]`;
}
