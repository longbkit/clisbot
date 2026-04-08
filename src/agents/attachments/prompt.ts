export function prependAttachmentMentions(text: string, attachmentPaths: string[]) {
  const normalizedText = text.trim();
  if (attachmentPaths.length === 0) {
    return normalizedText;
  }

  if (normalizedText.startsWith("/") || normalizedText.startsWith("!")) {
    return normalizedText;
  }

  const mentions = attachmentPaths.map((value) => `@${value}`).join(" ");
  return normalizedText ? `${mentions} ${normalizedText}` : mentions;
}
