import { useEffect, useRef, type RefObject } from "react";
import type { ComposerTextSource } from "./text-source";

/** What a send took from the composer, which a failed send puts back. */
export interface SentDraft {
  text: string;
  attachmentCount: number;
}

/**
 * A send error describes the draft that was sent. Once that draft changes, by removing the
 * attachment that caused it or editing the text, the error no longer applies. A failed send may
 * put the text and the attachments back after the error appears, each in its own time, so reaching
 * the sent value is never a change: it becomes the value the error is about.
 */
export function useSendErrorDraftReset(input: {
  sendError: string | null;
  clearSendError: () => void;
  attachmentCount: number;
  textSource: ComposerTextSource;
  sentDraft: RefObject<SentDraft | null>;
}): void {
  const { sendError, clearSendError, attachmentCount, textSource, sentDraft } = input;
  const hasError = sendError !== null;
  const count = useRef(attachmentCount);
  count.current = attachmentCount;
  const errorDraft = useRef<SentDraft | null>(null);
  const check = useRef(() => {});
  check.current = () => {
    const draft = errorDraft.current;
    if (!draft) return;
    const text = textSource.getSnapshot();
    const sent = sentDraft.current;
    if (text === sent?.text) draft.text = text;
    if (count.current === sent?.attachmentCount) draft.attachmentCount = count.current;
    if (text !== draft.text || count.current !== draft.attachmentCount) clearSendError();
  };
  useEffect(() => {
    if (!hasError) {
      errorDraft.current = null;
      return undefined;
    }
    errorDraft.current = { text: textSource.getSnapshot(), attachmentCount: count.current };
    return textSource.subscribe(() => check.current());
  }, [hasError, sendError, textSource]);
  useEffect(() => {
    check.current();
  }, [attachmentCount]);
}
