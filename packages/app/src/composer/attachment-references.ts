import type { ComposerAttachment } from "@/attachments/types";

export function composerAttachmentIds(attachments: readonly ComposerAttachment[]): Set<string> {
  const ids = new Set<string>();
  for (const value of attachments) {
    if (value.kind === "image") ids.add(value.metadata.id);
    if (value.kind === "file" && value.localCopy) ids.add(value.localCopy.id);
    if (value.kind === "browser_element" && value.attachment.screenshot)
      ids.add(value.attachment.screenshot.id);
  }
  return ids;
}
