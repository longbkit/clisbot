import type { ComposerAttachment } from "@/attachments/types";
import { retainAttachmentForGarbageCollection } from "@/attachments/gc-retention";
import { composerAttachmentIds } from "./attachment-references";
import { i18n } from "@/i18n/i18next";

export type AgentInputSubmitResult = "noop" | "queued" | "submitted" | "failed";

export interface AgentInputSubmitActionInput<TAttachment> {
  message: string;
  attachments: TAttachment[];
  hasExternalContent?: boolean;
  allowEmptySubmit?: boolean;
  submitBehavior?: "clear" | "preserve-and-lock";
  forceSend?: boolean;
  isAgentRunning: boolean;
  canSubmit: boolean;
  queueMessage: (input: { message: string; attachments: TAttachment[] }) => void | Promise<void>;
  submitMessage: (input: { message: string; attachments: TAttachment[] }) => Promise<void>;
  clearDraft: (lifecycle: "sent" | "abandoned") => void;
  setUserInput: (text: string) => void;
  setAttachments: (attachments: TAttachment[]) => void;
  setSendError: (message: string | null) => void;
  setIsProcessing: (isProcessing: boolean) => void;
  onSubmitError?: (error: unknown) => void;
  failedToSendMessage?: string;
}

export async function submitAgentInput<TAttachment extends ComposerAttachment>(
  input: AgentInputSubmitActionInput<TAttachment>,
): Promise<AgentInputSubmitResult> {
  const trimmedMessage = input.message.trim();
  const attachments = input.attachments;
  const shouldClearOnSubmit = input.submitBehavior !== "preserve-and-lock";

  if (
    !trimmedMessage &&
    attachments.length === 0 &&
    !input.hasExternalContent &&
    !input.allowEmptySubmit
  ) {
    return "noop";
  }

  if (!input.canSubmit) {
    return "noop";
  }

  if (input.isAgentRunning && !input.forceSend) {
    input.setIsProcessing(true);
    try {
      await input.queueMessage({ message: trimmedMessage, attachments });
      if (shouldClearOnSubmit) {
        input.setUserInput("");
        input.setAttachments([]);
      }
      input.setIsProcessing(false);
      return "queued";
    } catch (error) {
      input.setSendError(
        error instanceof Error ? error.message : (input.failedToSendMessage ?? "Queue failed"),
      );
      input.setIsProcessing(false);
      return "failed";
    }
  }

  // Retain bytes before draft clearing can schedule GC; release after handoff or restoration.
  const releaseAttachments = Array.from(
    composerAttachmentIds(attachments),
    retainAttachmentForGarbageCollection,
  );

  // Clear immediately so the submitted timeline row and composer state stay in sync.
  if (shouldClearOnSubmit) {
    input.setUserInput("");
    input.setAttachments([]);
  }
  input.setSendError(null);
  input.setIsProcessing(true);

  try {
    await input.submitMessage({ message: trimmedMessage, attachments });
    input.clearDraft("sent");
    input.setIsProcessing(false);
    return "submitted";
  } catch (error) {
    input.onSubmitError?.(error);
    if (shouldClearOnSubmit) {
      input.setUserInput(trimmedMessage);
      input.setAttachments(attachments);
    }
    input.setSendError(
      error instanceof Error
        ? error.message
        : (input.failedToSendMessage ?? i18n.t("composer.errors.failedToSend")),
    );
    input.setIsProcessing(false);
    return "failed";
  } finally {
    for (const release of releaseAttachments) release();
  }
}

/** Explicit actions bypass the default resolver; an editor never dispatches a turn. */
export async function submitOneOffInput<T>(input: {
  action: "queue" | "steer";
  editing: boolean;
  message: string;
  attachments: T[];
  hasExternalContent?: boolean;
  queue(): Promise<unknown>;
  steer(): Promise<unknown>;
}): Promise<"noop" | "queued" | "submitted"> {
  if (
    input.editing ||
    (!input.message.trim() && input.attachments.length === 0 && !input.hasExternalContent)
  )
    return "noop";
  await (input.action === "queue" ? input.queue() : input.steer());
  return input.action === "queue" ? "queued" : "submitted";
}
