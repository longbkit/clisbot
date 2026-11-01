import { useEffect, useRef } from "react";
import type { ComposerTextSource } from "./text-source";

/**
 * A send error describes the draft that was sent. Once that draft changes, by removing the
 * attachment that caused it or editing the text, the error no longer applies. The draft is read
 * when the error appears, after a failed send has put its text and attachments back.
 */
export function useSendErrorDraftReset(input: {
  sendError: string | null;
  clearSendError: () => void;
  attachmentCount: number;
  textSource: ComposerTextSource;
}): void {
  const { sendError, clearSendError, attachmentCount, textSource } = input;
  const hasError = sendError !== null;
  const countAtError = useRef(attachmentCount);
  useEffect(() => {
    if (hasError) countAtError.current = attachmentCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once, when the error appears
  }, [hasError, sendError]);
  useEffect(() => {
    if (hasError && attachmentCount !== countAtError.current) clearSendError();
  }, [attachmentCount, clearSendError, hasError]);
  useEffect(() => {
    if (!hasError) return undefined;
    const textAtError = textSource.getSnapshot();
    return textSource.subscribe(() => {
      if (textSource.getSnapshot() !== textAtError) clearSendError();
    });
  }, [clearSendError, hasError, sendError, textSource]);
}
